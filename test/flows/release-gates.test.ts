import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import type { Api } from '@root/test/support/http.ts';
import { bearer } from '@root/test/support/http.ts';
import { releaseExecutions } from '@root/test/support/releases.ts';
import { npmManifest, passChecks, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Schema } from 'effect';
import { streamGates } from '@/contract/views';
import type { ReleaseGate } from '@/domain/release-gates.ts';
import { gatedRelease } from '@/domain/release-gates.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

let world: World;
eachWorld(created => {
	world = created;
});

const auditRows = mutableArray(mutableStruct({ actor: Schema.String, action: Schema.String, target: Schema.String }));

function configuration(approval: 'push' | 'required') {
	return JSON.stringify({
		managers: ['npm', 'workflow'],
		streams: {
			main: {
				packages: ['pkg:npm/widget'],
				required: ['pkg:npm/widget'],
				prepare: { strategy: 'managed' },
				release: { approval, workflow: { file: 'publish.yml', publications: ['pkg:npm/widget'] } },
			},
		},
	});
}

async function enrolled(approval: 'push' | 'required' = 'push'): Promise<{ repository: Repository; api: Api }> {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, { '.github/beepboop.json': configuration(approval) }, 'Configure releases');
	passChecks(repository, world.github.head(repository));
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	return { repository, api };
}

function failStatus(sha: string) {
	world.network.serve('api.github.com', request =>
		new URL(request.url).pathname.endsWith(`/commits/${sha}/status`)
			? Response.json({ state: 'failure', total_count: 1, statuses: [] })
			: world.github.handle(request));
}

async function audit(action: string) {
	const rows = await world.db.prepare('SELECT actor, action, target FROM audit WHERE action=? ORDER BY created_at')
		.bind(action).all();
	return decodeSync(auditRows, rows.results);
}

test.each(
	[
		['check', { kind: 'check', name: 'test' }, 'checks failed: test', 'check test failure'],
		['signature', { kind: 'signature' }, 'signature unverified', 'commit signature unverified'],
		['status', { kind: 'status' }, 'commit status failure', 'commit status failure'],
		[
			'metadata',
			{ kind: 'metadata' },
			'metadata incomplete: widget (package.json) lacks license',
			'package metadata incomplete',
		],
	] as const satisfies readonly (readonly [string, ReleaseGate, string, string])[],
)(
	'a release stopped by the %s gate publishes once the stream switches the gate off',
	async (kind, gate, reason, note) => {
		const { repository, api } = await enrolled();
		const raised = world.github.push(
			repository,
			{ 'package.json': npmManifest('widget', '1.1.0', kind === 'metadata' ? { license: undefined } : {}) },
			'Release widget 1.1.0',
		);
		passChecks(repository, raised.sha);
		if (kind === 'check') {
			repository.checks.set(raised.sha, [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 1 }]);
		}
		const commit = repository.commits.get(raised.sha);
		if (kind === 'signature' && commit) commit.verified = false;
		if (kind === 'status') failStatus(raised.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(16_000);
		const [stopped] = await releaseExecutions(api);
		expect([stopped?.state, stopped?.reason]).toEqual(['awaiting-approval', reason]);
		expect(world.github.dispatches).toEqual([]);

		const skipped = await api('/api/repositories/gates/skip', {
			repositoryId: repository.id,
			stream: 'main',
			gate,
			skip: true,
		});
		expect(skipped.status).toBe(200);
		const [skip] = await audit('stream.gate.skip');
		expect(decodeSync(streamGates, skipped.body).gates.find(entry => entry.gate.kind === kind)?.skipped).toEqual({
			actor: skip?.actor ?? '',
			at: expect.any(Number),
		});
		await world.wait(16_000);
		const [released] = await releaseExecutions(api);
		expect(released?.reason).toBeUndefined();
		expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([released?.id]);
		expect((await audit('release.approve')).map(row => row.target)).toEqual([
			`${released?.id}:${raised.sha}:push skipping: ${note}, skipped by ${skip?.actor}`,
		]);
	},
	60_000,
);

test(
	'the gate list shows each gate of the waiting release once, and a release approval names each ignored gate once',
	async () => {
		const { repository, api } = await enrolled('required');
		const raised = world.github.push(repository, { 'package.json': npmManifest('widget', '1.1.0') }, 'Release 1.1.0');
		repository.checks.set(raised.sha, [
			{ name: 'test', status: 'completed', conclusion: 'success', runId: 1 },
			{ name: 'lint', status: 'completed', conclusion: 'cancelled', runId: 1 },
			{ name: 'lint', status: 'completed', conclusion: 'failure', runId: 2 },
		]);
		failStatus(raised.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(16_000);
		const [waiting] = await releaseExecutions(api);
		if (!waiting) throw new Error('Expected a releaseExecution');

		const listed = await api('/api/repositories/gates', { repositoryId: repository.id, stream: 'main' });
		expect(listed.status).toBe(200);
		expect(decodeSync(streamGates, listed.body)).toEqual({
			stream: 'main',
			commit: raised.sha,
			version: '1.1.0',
			gates: [
				{ gate: { kind: 'signature' }, state: 'passed', fact: 'verified' },
				{ gate: { kind: 'check', name: 'test' }, state: 'passed', fact: 'success' },
				{ gate: { kind: 'check', name: 'lint' }, state: 'failed', fact: 'cancelled' },
				{ gate: { kind: 'status' }, state: 'failed', fact: 'failure' },
				{ gate: { kind: 'metadata' }, state: 'passed', fact: 'complete' },
			],
		});

		for (const gate of [{ kind: 'check', name: 'lint' }, { kind: 'status' }, { kind: 'check', name: 'deploy' }]) {
			const reply = await api('/api/repositories/gates/skip', {
				repositoryId: repository.id,
				stream: 'main',
				gate,
				skip: true,
			});
			expect(reply.status).toBe(200);
		}
		const switched = decodeSync(
			streamGates,
			(await api('/api/repositories/gates', { repositoryId: repository.id, stream: 'main' })).body,
		);
		expect(switched.gates.map(entry => [entry.gate, entry.state, entry.skipped !== undefined])).toEqual([
			[{ kind: 'signature' }, 'passed', false],
			[{ kind: 'check', name: 'test' }, 'passed', false],
			[{ kind: 'check', name: 'lint' }, 'failed', true],
			[{ kind: 'status' }, 'failed', true],
			[{ kind: 'metadata' }, 'passed', false],
			[{ kind: 'check', name: 'deploy' }, 'absent', true],
		]);
		expect(switched.gates.at(-1)?.fact).toBe('not on this commit');
		expect((await api('/api/executions/approval', { id: waiting.id })).body).toEqual({ problems: [], blocked: [] });
		const [skip] = await audit('stream.gate.skip');
		const approved = await api('/api/executions/approve', { id: waiting.id, sourceSha: raised.sha });
		expect(approved.status).toBe(200);
		expect((await audit('release.approve')).map(row => row.target)).toEqual([
			`${waiting.id}:${raised.sha} skipping: check lint cancelled, skipped by ${skip?.actor}; commit status failure, skipped by ${skip?.actor}`,
		]);

		const restored = await api('/api/repositories/gates/skip', {
			repositoryId: repository.id,
			stream: 'main',
			gate: { kind: 'check', name: 'lint' },
			skip: false,
		});
		expect(
			decodeSync(streamGates, restored.body).gates.find(entry =>
				entry.gate.kind === 'check' && entry.gate.name === 'lint'
			),
		)
			.toEqual({ gate: { kind: 'check', name: 'lint' }, state: 'failed', fact: 'cancelled' });
		expect((await audit('stream.gate.restore')).map(row => row.target)).toEqual(['octo/widget:main:check lint']);
		expect((await audit('stream.gate.skip')).map(row => row.target)).toEqual([
			'octo/widget:main:check lint',
			'octo/widget:main:commit status',
			'octo/widget:main:check deploy',
		]);
	},
	60_000,
);

test('a stream without a waiting release lists the gates of the inspected commit', async () => {
	const { repository, api } = await enrolled();
	repository.checks.set(world.github.head(repository), [
		{ name: 'test', status: 'completed', conclusion: 'success', runId: 1 },
		{ name: 'test', status: 'completed', conclusion: 'failure', runId: 2 },
	]);
	const listed = await api('/api/repositories/gates', { repositoryId: repository.id, stream: 'main' });
	expect(decodeSync(streamGates, listed.body)).toEqual({
		stream: 'main',
		commit: world.github.head(repository),
		gates: [
			{ gate: { kind: 'signature' }, state: 'passed', fact: 'verified' },
			{ gate: { kind: 'check', name: 'test' }, state: 'failed', fact: 'failure' },
			{ gate: { kind: 'metadata' }, state: 'passed', fact: 'complete' },
		],
	});
	for (const path of ['/api/repositories/gates', '/api/repositories/gates/skip']) {
		const unknown = await api(path, {
			repositoryId: repository.id,
			stream: 'nightly',
			gate: { kind: 'signature' },
			skip: true,
		});
		expect(unknown.status).toBe(404);
	}
	expect(await audit('stream.gate.skip')).toEqual([]);
}, 60_000);

test.each(
	[
		['the newest waiting release over a newer finished one', ['awaiting-approval', 'succeeded'], 'r0'],
		['a failed release while it is the newest', ['succeeded', 'failed'], 'r1'],
		['nothing when a later release finished after a failed one', ['failed', 'succeeded'], undefined],
		['nothing when a later release was cancelled', ['failed', 'cancelled'], undefined],
	] as const,
)('the gate list follows %s', (_case, states, expected) => {
	const executions = states.map((state, index) => ({
		id: `r${index}`,
		operation: 'release',
		stream: 'main',
		state,
		createdAt: index,
	}));
	expect(
		gatedRelease(
			[...executions, { id: 'other', operation: 'release', stream: 'cli', state: 'blocked', createdAt: 9 }],
			'main',
		)?.id,
	)
		.toBe(expected);
});
