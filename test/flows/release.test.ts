import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { executionId, releaseEventId } from '@/persistence/identity-keys';
import { releaseSetSummaries, releaseSummaries } from '@/server/releases';
import { overview } from '@/server/views/overview';
import { runCard } from '@/server/views/runs';
import { runAction } from '@root/test/support/actions.ts';
import { packedRelease } from '@root/test/support/packed-release.ts';
import { botId, ownerId } from '@root/test/support/github.ts';
import { bearer, type Reply, text } from '@root/test/support/http.ts';
import { passChecks, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { fakeSigner, signingKey } from '@root/test/support/signing.ts';
import { World } from '@root/test/support/world.ts';

let world: World;
async function only(api: (path: string) => Promise<Reply>, operation: string): Promise<Execution> {
	const listed = await api('/api/executions');
	if (!Array.isArray(listed.body)) throw new Error('Expected an execution list');
	const matches = listed.body.map(decodeExecutionV1).filter(execution => execution.operation === operation);
	if (matches.length !== 1 || !matches[0]) {
		throw new Error(`Expected one ${operation} execution, found ${matches.length}`);
	}
	return matches[0];
}
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

test('a managed release travels from discovery to a verified publication', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());

	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	expect(text(discovered.body, 'name')).toBe('octo/widget');

	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	expect(plan.status).toBe(200);
	const prepared = await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	expect(prepared.status).toBe(200);
	expect(text(prepared.body, 'state')).toBe('ready');
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	expect(world.github.file(repository, 'package.json', pull.head.sha)).toContain('"version": "1.1.0"');

	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const promotion = await only(api, 'promote');
	expect(promotion.state).toBe('awaiting-approval');
	expect(promotion.sourceSha).toBe(merged.sha);

	const readiness = await api('/api/executions/approval', { id: promotion.id });
	expect(readiness.body).toEqual({ problems: [] });
	const approved = await api('/api/executions/approve', { id: promotion.id, sourceSha: merged.sha });
	expect(text(approved.body, 'state')).toBe('ready');

	await world.wait(16_000);
	const [dispatch] = world.github.dispatches;
	expect(dispatch?.inputs.beepboop_execution_id).toBe(promotion.id);
	const run = repository.runs.at(-1);
	if (!run) throw new Error('No workflow run');
	run.status = 'in_progress';
	const identity = { repository, runId: run.id, sha: run.headSha, file: 'publish.yml', actorId: botId };
	const begun = await runAction(world, 'begin', identity, {
		EXECUTION_ID: promotion.id,
		STREAM: 'main',
		OPERATION: 'promote',
	});
	expect(begun.outputs['execution-id']).toBe(promotion.id);
	expect(text(JSON.parse(begun.outputs.context ?? '{}'), 'state')).toBe('running');

	world.npm.publish('widget', '1.1.0');
	const reported = await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.1.0', outcome: 'succeeded' },
		]),
	});
	expect(reported.outputs.result).toContain('"outcome":"succeeded"');

	run.status = 'completed';
	run.conclusion = 'success';
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: {
			id: run.id,
			conclusion: 'success',
			event: 'workflow_dispatch',
			path: run.path,
			head_repository: { id: repository.id },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	expect((await only(api, 'promote')).state).toBe('succeeded');
	const journal = await world.coordinator(repository).exportJournal();
	const executions = journal.filter(entry => entry.key.startsWith('execution:')).map(entry =>
		decodeExecutionV1(entry.value)
	);
	expect(executions.map(execution => execution.operation).sort()).toEqual(['prepare', 'promote']);
	for (const execution of executions) {
		expect(execution.id).toBe(
			await Effect.runPromise(
				executionId(execution.repositoryId, execution.stream, execution.operation, execution.eventId),
			),
		);
	}
	const preparation = executions.find(execution => execution.operation === 'prepare');
	expect(preparation?.eventId).toBe(`plan:${text(plan.body, 'planId')}`);
	const succeeded = await only(api, 'promote');
	expect(journal.filter(entry => entry.key.startsWith('release-event:')).map(entry => entry.key)).toEqual([
		`release-event:${releaseEventId({ ...succeeded, version: '1.1.0' })}`,
	]);
	expect(world.github.unhandled).toEqual([]);
	expect(world.network.unrouted).toEqual([]);
});

async function finishedPromotion(outcome: 'pending' | 'skipped') {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	await world.push(repository);
	await world.wait(1_000);
	const promotion = await only(api, 'promote');
	expect(promotion.state).toBe('awaiting-approval');
	await api('/api/executions/approve', { id: promotion.id, sourceSha: merged.sha });
	await world.wait(16_000);
	const run = repository.runs.at(-1);
	if (!run) throw new Error('No workflow run');
	run.status = 'in_progress';
	const identity = { repository, runId: run.id, sha: run.headSha, file: 'publish.yml', actorId: botId };
	await runAction(world, 'begin', identity, { EXECUTION_ID: promotion.id, STREAM: 'main', OPERATION: 'promote' });
	const token = await runAction(world, 'token', identity, {
		EXECUTION_ID: promotion.id,
		PERMISSIONS: '{"contents":"read"}',
		TOKEN_IDENTITY: 'true',
	});
	await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.1.0', outcome },
		]),
	});
	run.status = 'completed';
	run.conclusion = 'success';
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: {
			id: run.id,
			conclusion: 'success',
			event: 'workflow_dispatch',
			path: run.path,
			head_repository: { id: repository.id },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	const entry = (await world.coordinator(repository).exportJournal()).find(entry =>
		entry.key === `execution:${promotion.id}`
	);
	const stored = z.record(z.string(), z.unknown()).parse(entry?.value);
	return { api, merged, promotion, stored, token, finished: await only(api, 'promote') };
}

test('the token action outputs the bot identity as an insertable Git environment', async () => {
	const { token } = await finishedPromotion('pending');
	const login = token.outputs['bot-login'];
	const email = token.outputs['bot-email'];
	expect(login).toMatch(/\[bot\]$/);
	expect(JSON.parse(token.outputs['gitId'] ?? '')).toEqual({
		GIT_AUTHOR_NAME: login,
		GIT_AUTHOR_EMAIL: email,
		GIT_COMMITTER_NAME: login,
		GIT_COMMITTER_EMAIL: email,
	});
});

test('a finished run whose registry publication appears late is verified without a second approval', async () => {
	const { api, merged, promotion, stored, finished } = await finishedPromotion('pending');
	expect(finished.state).toBe('verifying');
	expect(finished.publications.map(publication => publication.outcome)).toEqual(['pending']);
	expect(stored['state']).toBe('verifying');
	expect(runCard(finished, Date.now()).missing).toEqual([]);
	const counts = (state: Execution['state']) => {
		const { attention, running } = overview({
			section: 'overview',
			repositories: { readable: [], unreadable: [] },
			executions: { readable: [{ ...finished, state }], unreadable: [] },
		});
		return { attention, running };
	};
	expect(counts('verifying')).toEqual({ attention: 0, running: 1 });
	expect(counts('awaiting-approval')).toEqual({ attention: 1, running: 0 });
	expect(releaseSummaries([{ ...finished, state: 'awaiting-approval' }]).map(release => release.attention)).toEqual([
		true,
	]);
	expect((await api('/api/executions/approve', { id: promotion.id, sourceSha: merged.sha })).status).not.toBe(200);

	world.npm.publish('widget', '1.1.0');
	await world.wait(61_000);
	const settled = await only(api, 'promote');
	expect(settled.state).toBe('succeeded');
	expect(settled.publications.map(publication => publication.outcome)).toEqual(['succeeded']);
	expect(world.github.dispatches).toHaveLength(1);
	expect(runCard(finished, Date.now())).toMatchObject({ release: undefined, publications: [{ href: undefined }] });
	expect(runCard(settled, Date.now())).toMatchObject({
		release: { tag: 'v1.1.0', href: 'https://github.com/octo/widget/releases/tag/v1.1.0' },
		publications: [{ href: 'https://www.npmjs.com/package/widget/v/1.1.0' }],
	});
	const module = settled.publications.map(publication => ({
		...publication,
		manager: 'go' as const,
		name: 'statute.kjanat.dev',
		version: '0.13.1',
	}));
	expect(runCard({ ...settled, publications: module }, Date.now()).publications.map(p => p.href)).toEqual([
		'https://pkg.go.dev/statute.kjanat.dev@v0.13.1',
	]);
	const scoped = settled.publications.flatMap(publication => [
		{ ...publication, manager: 'npm' as const, name: '@kjanat/beepboop', version: '0.1.0' },
		{ ...publication, manager: 'jsr' as const, name: '@kjanat/beepboop', version: '0.1.0' },
	]);
	expect(runCard({ ...settled, publications: scoped }, Date.now()).publications.map(p => p.href)).toEqual([
		'https://www.npmjs.com/package/@kjanat/beepboop/v/0.1.0',
		'https://jsr.io/@kjanat/beepboop@0.1.0',
	]);
});

test('a registry outage during verification is retried once the registry answers again', async () => {
	const { api } = await finishedPromotion('pending');
	world.network.serve('registry.npmjs.org', () => new Response('unavailable', { status: 503 }));
	await world.wait(61_000);
	expect((await only(api, 'promote')).state).toBe('uncertain');

	world.network.serve('registry.npmjs.org', request => world.npm.handle(request));
	world.npm.publish('widget', '1.1.0');
	await world.wait(61_000);
	const settled = await only(api, 'promote');
	expect(settled.state).toBe('succeeded');
	expect(world.github.dispatches).toHaveLength(1);
});

test('a finished run whose publication cannot be rechecked is blocked and needs attention', async () => {
	const { finished } = await finishedPromotion('skipped');
	expect(finished.state).toBe('blocked');
	expect(finished.publications.map(publication => publication.outcome)).toEqual(['skipped']);
	expect(runCard(finished, Date.now()).missing).toEqual(['pkg:npm/widget']);
	const releaseSet = {
		preparationId: 'preparation',
		group: 'main',
		required: [],
		workflowId: 'set',
		operationCount: 2,
	};
	expect(releaseSetSummaries([{ ...finished, state: 'blocked', releaseSet }]).map(summary => summary.state)).toEqual([
		'needs attention',
	]);
});

test('a stored blocked promotion decodes as verifying only when a recheck can settle it', async () => {
	const { stored } = await finishedPromotion('pending');
	expect(decodeExecutionV1({ ...stored, state: 'blocked' }).state).toBe('verifying');
	const workflow = { ...z.record(z.string(), z.unknown()).parse(stored['workflow']), publications: ['pkg:npm/other'] };
	expect(decodeExecutionV1({ ...stored, state: 'blocked', workflow }).state).toBe('blocked');
});

test('a promotion whose workflow branch was deleted fails with the missing ref named', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = z.looseObject({
		streams: z.looseObject({
			main: z.looseObject({ promote: z.looseObject({ workflow: z.looseObject({}) }) }),
		}),
	}).parse(JSON.parse(widgetConfiguration()));
	configuration.streams.main.promote.workflow.ref = 'release-line';
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Release from a branch');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });

	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	repository.refs.set('heads/release-line', merged.sha);
	await world.push(repository);
	await world.wait(1_000);
	const promotion = await only(api, 'promote');
	const approved = await api('/api/executions/approve', { id: promotion.id, sourceSha: merged.sha });
	expect(text(approved.body, 'state')).toBe('ready');

	repository.refs.delete('heads/release-line');
	await world.wait(16_000);
	expect(world.github.dispatches).toEqual([]);
	expect((await only(api, 'promote')).reason).toBe(
		'Beepboop could not continue: Workflow ref release-line no longer exists',
	);
});

test('a merge-approved release whose merge cannot be confirmed waits for approval and logs why', async () => {
	const repository = widget(world.github, { approval: 'merge' });
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);

	world.network.serve(
		'api.github.com',
		request =>
			new URL(request.url).pathname.includes('/compare/')
				? Response.json({ message: 'Resource not accessible by integration' }, { status: 403 })
				: world.github.handle(request),
	);
	const logged = spyOn(console, 'error').mockImplementation(() => {});
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const events = logged.mock.calls.flatMap(([line]): unknown[] => {
		if (typeof line !== 'string') return [];
		const parsed: unknown = JSON.parse(line);
		return [parsed];
	});
	logged.mockRestore();
	expect(events).toEqual([{
		event: 'preparation-merge.failed',
		repository: 'octo/widget',
		pull: `https://github.com/octo/widget/pull/${pull.number}`,
		error:
			`GitHub HTTP 403 on GET /repos/octo/widget/compare/${merged.sha}...${merged.sha}: Resource not accessible by integration`,
	}]);
	const promotion = await only(api, 'promote');
	expect(promotion.state).toBe('awaiting-approval');
	expect(promotion.approvedBy).toBeUndefined();
});

test('the signer binding signs the version tag without a signed ref policy', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		const signer = fakeSigner(key);
		const { plan, tags } = await packedRelease(world, undefined, { key, signer });
		const promotion = await only(bearer(world, await world.cliSession()), 'promote');
		expect(promotion.state).toBe('succeeded');
		expect(promotion.publications.find(entry => entry.id === 'refs:promote')?.outcome).toBe('succeeded');
		expect(plan.changes[0]?.signed).toBe(true);
		expect(plan.publicKey).toBe(key.publicKey);
		expect(signer.calls).toEqual([{
			data: expect.stringMatching(
				/^object [0-9a-f]{40}\ntype commit\ntag v1\.1\.0\ntagger Release Bot \(CI\) <release@example\.com> \d+ \+0000\n\nRelease 1\.1\.0\n$/,
			),
			caller: 'beepboop:octo/widget',
		}]);
		expect(tags['v1.1.0']).toBe(plan.changes[0]?.object?.trimEnd());
		expect(tags['v1.1.0']).toContain('-----BEGIN PGP SIGNATURE-----');
	} finally {
		key.dispose();
	}
}, 30_000);

test('signed version tags fall back to the runner key without a signer binding', async () => {
	const key = signingKey('Beepboop <bot@example.com>');
	try {
		const { plan, tags } = await packedRelease(world, undefined, { key });
		const promotion = await only(bearer(world, await world.cliSession()), 'promote');
		expect(promotion.state).toBe('succeeded');
		expect(plan.publicKey).toBeUndefined();
		expect(plan.changes[0]?.object).toBeUndefined();
		expect(tags['v1.1.0']).toContain('tagger Beepboop <bot@example.com>');
		expect(tags['v1.1.0']).toContain('-----BEGIN PGP SIGNATURE-----');
	} finally {
		key.dispose();
	}
}, 30_000);

test('the refs runtime refuses a signature from another key', async () => {
	const key = signingKey('Release Bot <release@example.com>');
	const other = signingKey('Mallory <mallory@example.com>');
	try {
		const signer = fakeSigner(key, { signWith: other });
		await expect(packedRelease(world, undefined, { key, signer })).rejects.toThrow('Git verify-tag failed');
	} finally {
		key.dispose();
		other.dispose();
	}
}, 30_000);

test('ref planning refuses a signing key without a name and email', async () => {
	const key = signingKey('Release Bot <release@example.com>');
	try {
		const signer = fakeSigner(key, { userId: 'release-bot' });
		await expect(packedRelease(world, undefined, { key, signer })).rejects.toThrow(
			'The signing key needs a user ID with a name and email',
		);
		expect(signer.calls).toEqual([]);
	} finally {
		key.dispose();
	}
}, 30_000);

test('packed prepare and refs runtimes publish the planned tag', async () => {
	const { repository, promotionId, plan, tags } = await packedRelease(world);
	expect(plan.publicKey).toBeUndefined();
	expect(tags['v1.1.0']).not.toContain('-----BEGIN PGP SIGNATURE-----');
	const api = bearer(world, await world.cliSession());
	const promotion = await only(api, 'promote');
	expect(promotion.id).toBe(promotionId);
	expect(promotion.state).toBe('succeeded');
	expect(promotion.publications.some(entry => entry.id === 'refs:promote' && entry.outcome === 'succeeded')).toBe(
		true,
	);
	expect(world.github.file(repository, 'package.json', promotion.sourceSha)).toContain('"version": "1.1.0"');
	const journal = await world.coordinator(repository).exportJournal();
	expect(
		journal.filter(entry => entry.key.startsWith('execution:')).map(entry => decodeExecutionV1(entry.value).operation)
			.sort(),
	).toEqual(['prepare', 'promote']);
	expect(world.github.unhandled).toEqual([]);
	expect(world.network.unrouted).toEqual([]);
}, 30_000);
