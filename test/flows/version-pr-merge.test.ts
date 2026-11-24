import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { botId, ownerId } from '@root/test/support/github.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import { prepareWorkflow } from '@root/test/support/packed-release.ts';
import { executions, only, prepareRelease } from '@root/test/support/releases.ts';
import { editableConfiguration, passChecks, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { AutomationCoordinator } from '@/automation/coordinator';
import type { VersionPrMerge } from '@/domain/setup-terms.ts';
import { versionPrMergeSentences, versionScopeNames } from '@/domain/setup-terms.ts';
import { decodeExecutionV1 } from '@/release/domain/execution/codec-v1.ts';
import { runCard } from '@/server/views/runs';
import { behaviourChanges } from '@/setup/changes.ts';

let world: World;
eachWorld(created => {
	world = created;
});

async function versionPr(
	merge: VersionPrMerge,
	allowAutoMerge: boolean,
	prepare: Record<string, unknown>,
	override?: VersionPrMerge,
) {
	const { repository, api, prepared } = await requested(merge, allowAutoMerge, prepare, override);
	expect(prepared.status).toBe(200);
	return { repository, api, executionId: text(prepared.body, 'id') };
}

async function requested(
	merge: VersionPrMerge,
	allowAutoMerge: boolean,
	prepare: Record<string, unknown>,
	override?: VersionPrMerge,
	manifest = '1.0.0',
	versioning: 'workspace' | 'independent' = 'workspace',
) {
	const repository = widget(world.github, { version: manifest });
	repository.allowAutoMerge = allowAutoMerge;
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	configuration.streams.main = {
		...configuration.streams.main,
		credentials: [],
		versionScope: versionScopeNames[versioning],
		prepare: { ...prepare, versionPrMerge: merge },
	};
	const head = world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/prepare.yml': prepareWorkflow,
	}, 'Configure the version PR merge');
	passChecks(repository, head.sha);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const { prepared } = await prepareRelease(
		api,
		{ repositoryId: repository.id, stream: 'main', version: '1.0.1' },
		override ? { versionPrMerge: override } : {},
	);
	return { repository, api, prepared };
}

async function managed(merge: VersionPrMerge, allowAutoMerge = true, override?: VersionPrMerge) {
	const opened = await versionPr(
		merge,
		allowAutoMerge,
		{ strategy: 'managed', versionLands: 'via-version-pr' },
		override,
	);
	await world.wait(16_000);
	return opened;
}

async function submitted(repository: Repository, executionId: string, api: Parameters<typeof only>[0]) {
	await world.wait(20_000);
	const run = one(repository.runs.filter(entry => entry.path === '.github/workflows/prepare.yml'), 'prepare run');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'prepare.yml');
	await begin(world, identity, executionId, 'main', 'prepare');
	const edits = (await only(api, 'prepare')).plan?.edits ?? [];
	const scratch = mkdtempSync(join(tmpdir(), 'beepboop-prepared-'));
	try {
		const file = join(scratch, 'prepared.json');
		writeFileSync(
			file,
			JSON.stringify({ executionId, files: edits.map(edit => ({ path: edit.path, content: edit.after })) }),
		);
		await runAction(world, 'prepared', identity, { PREPARED_FILE: file });
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

for (const merge of ['squash', 'merge', 'rebase'] as const) {
	test(`versionPrMerge ${merge} turns on GitHub auto-merge with that method for a managed version PR`, async () => {
		const { repository, api } = await managed(merge);
		const pull = one(repository.pulls, 'version PR');
		expect([pull.state, pull.merged, pull.autoMerge, pull.comments]).toEqual([
			'open',
			false,
			merge.toUpperCase(),
			undefined,
		]);
		const preparation = await only(api, 'prepare');
		expect(preparation.managed?.result?.autoMerge).toEqual({ method: merge, state: 'enabled' });
		expect(runCard(preparation, Date.now()).autoMerge).toBe(versionPrMergeSentences[merge].replaceAll('`', ''));
	});
}

test('versionPrMerge squash turns on auto-merge for a version PR that a preparation workflow submits', async () => {
	const { repository, api, executionId } = await versionPr('squash', true, { workflow: { file: 'prepare.yml' } });
	await submitted(repository, executionId, api);
	const pull = one(repository.pulls, 'version PR');
	expect([pull.state, pull.autoMerge]).toEqual(['open', 'SQUASH']);
	expect((await only(api, 'prepare')).prepared?.result?.autoMerge).toEqual({ method: 'squash', state: 'enabled' });
});

test('versionPrMerge manual leaves the version PR for you to merge', async () => {
	const { repository, api } = await managed('manual');
	const pull = one(repository.pulls, 'version PR');
	expect([pull.state, pull.merged, pull.autoMerge, pull.comments]).toEqual(['open', false, undefined, undefined]);
	const preparation = await only(api, 'prepare');
	expect([preparation.state, preparation.managed?.result?.autoMerge]).toEqual(['succeeded', undefined]);
	expect(runCard(preparation, Date.now()).autoMerge).toBeUndefined();
});

test('a release auto-merges its version PR with its own method although the stream merges by hand', async () => {
	const { repository, api } = await managed('manual', true, 'rebase');
	expect(one(repository.pulls, 'version PR').autoMerge).toBe('REBASE');
	const preparation = await only(api, 'prepare');
	expect([preparation.versionPrMerge, preparation.managed?.result?.autoMerge]).toEqual([
		'rebase',
		{ method: 'rebase', state: 'enabled' },
	]);
});

test('a release leaves its version PR for you although the stream auto-merges', async () => {
	const { repository, api } = await managed('squash', true, 'manual');
	expect(one(repository.pulls, 'version PR').autoMerge).toBeUndefined();
	expect((await only(api, 'prepare')).managed?.result?.autoMerge).toBeUndefined();
});

for (
	const [release, prepare, manifest] of [
		['commits its version', { strategy: 'managed', versionLands: 'via-direct-commit' }, '1.0.0'],
		['prepares in its own workflow', { strategy: 'workflow', workflow: { file: 'prepare.yml' } }, '1.0.0'],
		['already carries its version', { strategy: 'managed', versionLands: 'via-version-pr' }, '1.0.1'],
	] as const
) {
	test(`a release that ${release} refuses a version PR merge and prepares nothing`, async () => {
		const { repository, api, prepared } = await requested('manual', true, prepare, 'squash', manifest);
		expect(prepared.status).toBe(422);
		expect(JSON.stringify(prepared.body)).toContain('1.0.1 of main opens no version PR to merge');
		await world.wait(16_000);
		expect([repository.pulls, repository.runs]).toEqual([[], []]);
		expect((await executions(api)).filter(execution => execution.initiatedBy !== undefined)).toEqual([]);
	});
}

test('preparing the same release again refuses another version PR merge and keeps the first', async () => {
	const { repository, api, prepared } = await requested('manual', true, {
		strategy: 'managed',
		versionLands: 'via-version-pr',
	}, 'manual');
	const request = { repositoryId: repository.id, stream: 'main', version: '1.0.1' };
	const again = await prepareRelease(api, request, { versionPrMerge: 'manual' });
	expect([again.prepared.status, text(again.prepared.body, 'id')]).toEqual([200, text(prepared.body, 'id')]);
	const changed = await prepareRelease(api, request, { versionPrMerge: 'rebase' });
	expect(changed.prepared.status).toBe(422);
	expect(JSON.stringify(changed.prepared.body)).toContain(
		'1.0.1 of main is already being prepared with versionPrMerge manual',
	);
	await world.wait(16_000);
	expect(one(repository.pulls, 'version PR').autoMerge).toBeUndefined();
	expect((await only(api, 'prepare')).versionPrMerge).toBe('manual');
});

test('a repository that disallows auto-merge keeps the version PR open with a note', async () => {
	const { repository, api } = await managed('squash', false);
	const pull = one(repository.pulls, 'version PR');
	const note =
		'Beepboop could not turn on squash auto-merge for this version PR. GitHub said: Pull request Auto merge is not allowed for this repository. The PR stays open until you merge it.';
	expect([pull.state, pull.merged, pull.autoMerge, pull.comments]).toEqual(['open', false, undefined, [note]]);
	const preparation = await only(api, 'prepare');
	expect([preparation.state, preparation.managed?.result?.autoMerge]).toEqual([
		'succeeded',
		{ method: 'squash', state: 'refused', note },
	]);
	expect(runCard(preparation, Date.now()).autoMerge).toBe(note);
});

function intercept(answer: (path: string, body: string) => Response | undefined) {
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		const body = request.method === 'POST' ? await request.clone().text() : '';
		return answer(path, body) ?? world.github.handle(request);
	});
}
const autoMergeCall = (path: string, body: string) =>
	path === '/graphql' && body.includes('enablePullRequestAutoMerge');

test('an HTTP 403 from GitHub refuses auto-merge with a note on the version PR', async () => {
	intercept((path, body) =>
		autoMergeCall(path, body)
			? Response.json({ message: 'Resource not accessible by integration' }, { status: 403 })
			: undefined
	);
	const { repository, api } = await managed('squash');
	const note =
		'Beepboop could not turn on squash auto-merge for this version PR. GitHub said: GitHub HTTP 403 on POST /graphql: Resource not accessible by integration. The PR stays open until you merge it.';
	const pull = one(repository.pulls, 'version PR');
	expect([pull.state, pull.autoMerge, pull.comments]).toEqual(['open', undefined, [note]]);
	const preparation = await only(api, 'prepare');
	expect([preparation.state, preparation.managed?.result?.autoMerge]).toEqual([
		'succeeded',
		{ method: 'squash', state: 'refused', note },
	]);
});

const rateLimits = {
	'GraphQL RATE_LIMITED with HTTP 200': () =>
		Response.json({
			data: { enablePullRequestAutoMerge: null },
			errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for installation ID 1.' }],
		}),
	'HTTP 403 secondary rate limit': () =>
		Response.json({ message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' }, { status: 403 }),
};
for (const [kind, limit] of Object.entries(rateLimits)) {
	test(`an auto-merge request hit by a ${kind} leaves preparation successful and never records a refusal`, async () => {
		let limited = true;
		intercept((path, body) => {
			if (!limited || !autoMergeCall(path, body)) return undefined;
			limited = false;
			return limit();
		});
		const { repository, api } = await managed('squash');
		expect(limited).toBe(false);
		const waiting = await only(api, 'prepare');
		expect([waiting.state, waiting.managed?.result?.autoMerge]).toEqual(['succeeded', {
			method: 'squash',
			state: 'enabled',
		}]);
		expect(waiting.reason).toBeUndefined();
		await world.wait(4 * 60_000);
		const pull = one(repository.pulls, 'version PR');
		expect([pull.state, pull.autoMerge, pull.comments]).toEqual(['open', 'SQUASH', undefined]);
		const preparation = await only(api, 'prepare');
		expect([preparation.state, preparation.managed?.result?.autoMerge]).toEqual([
			'succeeded',
			{ method: 'squash', state: 'enabled' },
		]);
	});
}

test('a refusal note that GitHub does not accept still records the refusal', async () => {
	intercept(path =>
		/^\/repos\/octo\/widget\/issues\/\d+\/comments$/.test(path)
			? Response.json({ message: 'Server Error' }, { status: 500 })
			: undefined
	);
	const { repository, api } = await managed('squash', false);
	const note =
		'Beepboop could not turn on squash auto-merge for this version PR. GitHub said: Pull request Auto merge is not allowed for this repository. The PR stays open until you merge it.';
	expect(one(repository.pulls, 'version PR').comments).toBeUndefined();
	const preparation = await only(api, 'prepare');
	expect([preparation.state, preparation.managed?.result?.autoMerge]).toEqual([
		'succeeded',
		{ method: 'squash', state: 'refused', note },
	]);
});

test('the setup PR describes a versionPrMerge change with the sentence of its new value', () => {
	const document = (prepare: Record<string, unknown>) =>
		`${JSON.stringify({ streams: { main: { packages: ['npm:widget'], prepare } } }, null, '\t')}\n`;
	const before = document({ versionLands: 'via-version-pr' });
	const after = document({ versionLands: 'via-version-pr', versionPrMerge: 'rebase' });
	expect(behaviourChanges([{ path: '.github/beepboop.json', before, after }])).toEqual([
		'- `main`',
		`  - \`prepare.versionPrMerge\`: none → \`rebase\`. ${versionPrMergeSentences.rebase}`,
	]);
});

test('a preparation rerun never receives the stored before and after lockfile copies', async () => {
	const { repository, api, executionId } = await versionPr('manual', true, { workflow: { file: 'prepare.yml' } });
	await submitted(repository, executionId, api);
	const execution = await world.coordinator(repository).execution(executionId);
	if (!execution?.prepared) throw new Error('Missing prepared execution');
	execution.prepared.edits.push({ path: 'Cargo.lock', before: 'before'.repeat(50_000), after: 'after'.repeat(50_000) });
	await world.coordinators.instance(String(repository.id)).storage.put(`execution:${executionId}`, execution);
	const run = one(repository.runs.filter(entry => entry.path === '.github/workflows/prepare.yml'), 'prepare run');
	run.attempt = 2;
	const begun = await begin(
		world,
		{ ...runIdentity(repository, run, 'prepare.yml'), attempt: 2 },
		executionId,
		'main',
		'prepare',
	);
	expect(begun.outputs.context?.length).toBeLessThan(2_000);
	expect(JSON.parse(begun.context ?? '{}').prepared).toBeUndefined();
	expect(begun.context).not.toContain('beforebeforebefore');
});

for (const start of [false, true]) {
	for (const initial of [undefined, 'rebase'] as const) {
		test(`a ${start ? 'started' : 'prepared'} release rejects ${initial ? 'omitting its explicit' : 'adding an explicit'} merge override without an acceptance audit`, async () => {
			const { repository, api, prepared } = await requested(
				'manual',
				true,
				{ strategy: 'managed', versionLands: 'via-version-pr' },
				initial,
				'1.0.0',
				start ? 'workspace' : 'independent',
			);
			expect(prepared.status).toBe(200);
			const request = { repositoryId: repository.id, stream: 'main', version: '1.0.1' };
			const action = start ? 'release.start' : 'release.prepare';
			const audit = () => world.db.prepare('SELECT id FROM audit WHERE action = ?').bind(action).all();
			const accepted = await audit();
			expect(accepted.results).toHaveLength(1);
			const same = await prepareRelease(api, request, initial ? { versionPrMerge: initial } : {});
			expect(same.prepared.status).toBe(200);
			expect(text(same.prepared.body, 'id')).toBe(text(prepared.body, 'id'));
			const before = await audit();
			expect(before.results).toHaveLength(2);
			const conflicting = await prepareRelease(api, request, initial ? {} : { versionPrMerge: 'rebase' });
			expect(conflicting.prepared.status).toBe(422);
			expect(JSON.stringify(conflicting.prepared.body)).toContain(`versionPrMerge ${initial ?? 'from the stream'}`);
			expect(await audit()).toEqual(before);
			await world.wait(16_000);
			expect((await only(api, 'prepare')).versionPrMerge).toBe(initial);
			expect(one(repository.pulls, 'version PR').autoMerge).toBe(initial ? 'REBASE' : undefined);
		});
	}
}

test('the prepared call answers before GitHub turns on auto-merge, and disposing the coordinator waits for auto-merge', async () => {
	const { repository, api, executionId } = await versionPr('squash', true, { workflow: { file: 'prepare.yml' } });
	await world.wait(20_000);
	const run = one(repository.runs.filter(entry => entry.path === '.github/workflows/prepare.yml'), 'prepare run');
	run.status = 'in_progress';
	await begin(world, runIdentity(repository, run, 'prepare.yml'), executionId, 'main', 'prepare');
	const edits = (await only(api, 'prepare')).plan?.edits ?? [];
	const reached = Promise.withResolvers<void>();
	const held = Promise.withResolvers<void>();
	world.network.serve('api.github.com', async request => {
		if (autoMergeCall(new URL(request.url).pathname, request.method === 'POST' ? await request.clone().text() : '')) {
			reached.resolve();
			await held.promise;
		}
		return world.github.handle(request);
	});
	const coordinator = world.coordinator(repository);
	const ref = `refs/heads/${repository.defaultBranch}`;
	const pending = (outcome: Promise<unknown>, settled: string, milliseconds: number) =>
		Promise.race([outcome.then(() => settled), Bun.sleep(milliseconds).then(() => 'pending')]);
	try {
		const answered = coordinator.prepared(executionId, {
			repositoryId: repository.id,
			repository: repository.name,
			ownerId,
			actorId: botId,
			runId: run.id,
			attempt: 1,
			sha: run.headSha,
			workflowSha: run.headSha,
			workflowRef: `${repository.name}/.github/workflows/prepare.yml@${ref}`,
			ref,
			event: 'workflow_dispatch',
		}, edits);
		await reached.promise;
		expect(await pending(answered, 'answered', 2_000)).toBe('answered');
		expect((await coordinator.execution(executionId))?.prepared?.result).toEqual(await answered);
		const disposed = AutomationCoordinator.dispose(coordinator);
		expect(await pending(disposed, 'disposed', 20)).toBe('pending');
		held.resolve();
		await disposed;
	} finally {
		held.resolve();
	}
	expect(one(repository.pulls, 'version PR').autoMerge).toBe('SQUASH');
	const stored = await world.coordinators.instance(String(repository.id)).storage.get(`execution:${executionId}`);
	expect(decodeExecutionV1(stored).prepared?.result?.autoMerge).toEqual({ method: 'squash', state: 'enabled' });
});

test('a managed version PR whose branch GitHub refused once opens later from the commit it recorded', async () => {
	let refused = 0;
	intercept((path, body) => {
		if (refused || path !== '/repos/octo/widget/git/refs' || !body) return undefined;
		refused++;
		return Response.json({ message: 'Reference update failed' }, { status: 422 });
	});
	const { repository, api } = await managed('manual');
	expect(refused).toBe(1);
	const stopped = await only(api, 'prepare');
	const head = stopped.managed?.head;
	expect([stopped.state, typeof head, repository.pulls]).toEqual(['uncertain', 'string', []]);
	await world.wait(61_000);
	expect(await only(api, 'prepare')).toMatchObject({ state: 'succeeded', managed: { head, result: { head } } });
	expect(one(repository.pulls, 'version PR').head.sha).toBe(head ?? '');
});
