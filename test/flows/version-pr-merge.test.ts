import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import { prepareWorkflow } from '@root/test/support/packed-release.ts';
import { executions, only, prepareRelease } from '@root/test/support/releases.ts';
import { editableConfiguration, passChecks, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { behaviourChanges } from '@/automation/setup-changes';
import type { VersionPrMerge } from '@/contract/setup-terms';
import { versionPrMergeSentences } from '@/contract/setup-terms';
import { runCard } from '@/server/views/runs';

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
) {
	const repository = widget(world.github, { version: manifest });
	repository.allowAutoMerge = allowAutoMerge;
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	configuration.streams.main = {
		...configuration.streams.main,
		credentials: [],
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
	const opened = await versionPr(merge, allowAutoMerge, { strategy: 'managed', bump: 'pr' }, override);
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
		['commits its version', { strategy: 'managed', bump: 'commit' }, '1.0.0'],
		['prepares in its own workflow', { strategy: 'workflow', workflow: { file: 'prepare.yml' } }, '1.0.0'],
		['already carries its version', { strategy: 'managed', bump: 'pr' }, '1.0.1'],
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
