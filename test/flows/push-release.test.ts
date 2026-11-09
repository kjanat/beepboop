import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { runAction } from '@root/test/support/actions.ts';
import { botId, ownerId, type Repository } from '@root/test/support/github.ts';
import { bearer, type Reply } from '@root/test/support/http.ts';
import { passChecks, widget } from '@root/test/support/repositories.ts';
import { World } from '@root/test/support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

async function promotions(api: (path: string) => Promise<Reply>): Promise<Execution[]> {
	const listed = await api('/api/executions');
	if (!Array.isArray(listed.body)) throw new Error('Expected an execution list');
	return listed.body.map(decodeExecutionV1).filter(execution => execution.operation === 'promote');
}
function manifest(name: string, version: string, dependencies?: Record<string, string>): string {
	return `${JSON.stringify({ name, version, ...(dependencies ? { dependencies } : {}) }, null, 2)}\n`;
}
async function elevate() {
	await world.db.prepare('INSERT INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)')
		.bind(
			'proof',
			'elevation',
			JSON.stringify({ subject: world.env.ADMIN_SUBJECT, elevated: true }),
			Date.now() + 60_000,
		)
		.run();
}
async function finish(repository: Repository, promotion: Execution, name: string, version: string) {
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === promotion.id);
	if (!run) throw new Error(`No run for ${promotion.stream}`);
	run.status = 'in_progress';
	const identity = { repository, runId: run.id, sha: run.headSha, file: 'publish.yml', actorId: botId };
	await runAction(world, 'begin', identity, {
		EXECUTION_ID: promotion.id,
		STREAM: promotion.stream,
		OPERATION: 'promote',
	});
	world.npm.publish(name, version);
	await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([{ id: `pkg:npm/${name}`, manager: 'npm', name, version, outcome: 'succeeded' }]),
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
}

async function mergedSetup(release: boolean) {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: {
			streams: [{
				name: 'main',
				packages: ['pkg:npm/widget'],
				required: ['pkg:npm/widget'],
				versioning: 'workspace',
				approval: 'push',
				promote: {
					file: 'release.yml',
					job: 'promote',
					triggers: 'review',
					commands: 'npm publish',
					publicationSteps: {},
				},
			}],
		},
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	expect(
		(await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		})).status,
	).toBe(200);
	const pull = repository.pulls[0];
	if (!pull) throw new Error('No setup pull request');
	const box = '- [ ] <!-- beepboop:release-after-merge --> Release after merge';
	expect(pull.body).toContain(box);
	if (release) pull.body = pull.body.replace(box, '- [x] <!-- beepboop:release-after-merge --> Release after merge');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	return { repository, api, merged };
}

test('merging a setup PR with Release after merge unticked starts no release', async () => {
	const { repository, api, merged } = await mergedSetup(false);
	expect((await promotions(api)).filter(promotion => promotion.sourceSha === merged.sha)).toEqual([]);
	const next = world.github.push(repository, { 'README.md': '# widget\n\nUsage.\n' }, 'Document usage');
	passChecks(repository, next.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect((await promotions(api)).map(promotion => [promotion.sourceSha, promotion.version])).toEqual([
		[next.sha, '1.0.0'],
	]);
}, 60_000);

test('merging a setup PR with Release after merge ticked releases its version', async () => {
	const { api, merged } = await mergedSetup(true);
	expect((await promotions(api)).map(promotion => [promotion.sourceSha, promotion.version])).toEqual([
		[merged.sha, '1.0.0'],
	]);
}, 60_000);

async function failedRelease(rerun = false) {
	const { repository, api, merged } = await mergedSetup(true);
	const [promotion] = await promotions(api);
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === promotion?.id);
	if (!promotion?.draftRelease || !run) throw new Error('Expected a dispatched release with a draft');
	run.status = 'completed';
	run.conclusion = 'failure';
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: {
			id: run.id,
			conclusion: 'failure',
			event: 'workflow_dispatch',
			path: run.path,
			head_repository: { id: repository.id },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(16_000);
	const [failed] = await promotions(api);
	expect(failed?.state).toBe('failed');
	if (!rerun) run.headSha = 'e'.repeat(40);
	const retry = async () => {
		expect((await api('/api/executions/recover', { id: promotion.id, action: 'retry' })).status).toBe(200);
		await world.wait(16_000);
		const [retried] = await promotions(api);
		expect(repository.runs.filter(entry => entry.inputs.beepboop_execution_id === promotion.id).length)
			.toBe(rerun ? 1 : 2);
		return retried;
	};
	const drafts = () => repository.releases.filter(release => release.draft && release.tag === 'v1.0.0');
	return { repository, merged, run, draft: promotion.draftRelease, retry, drafts };
}

test('a retry that re-runs the failed jobs of the same run keeps the recorded draft', async () => {
	const { merged, run, draft, retry, drafts } = await failedRelease(true);
	const retried = await retry();
	expect([run.attempt, retried?.runId, retried?.draftRelease]).toEqual([2, run.id, draft]);
	expect(drafts().map(release => [release.id, release.target])).toEqual([[draft.id, merged.sha]]);
}, 60_000);

test('a retried release reuses the draft its execution recorded', async () => {
	const { merged, draft, retry, drafts } = await failedRelease();
	const retried = await retry();
	expect(retried?.draftRelease).toEqual(draft);
	expect(drafts().map(release => [release.id, release.target])).toEqual([[draft.id, merged.sha]]);
}, 60_000);

test('a retried release adopts a bot draft with the same tag and commit when its own draft is gone', async () => {
	const { merged, draft, retry, drafts } = await failedRelease();
	const [release] = drafts();
	if (!release) throw new Error('Expected the draft release');
	release.id = draft.id + 500;
	const retried = await retry();
	expect(retried?.draftRelease).toEqual({ id: draft.id + 500, tag: 'v1.0.0' });
	expect(drafts().map(entry => [entry.id, entry.target])).toEqual([[draft.id + 500, merged.sha]]);
}, 60_000);

test('a retried release deletes a stale bot draft for another commit and keeps one draft', async () => {
	const { repository, merged, draft, retry, drafts } = await failedRelease();
	const [release] = drafts();
	if (!release) throw new Error('Expected the draft release');
	release.id = draft.id + 500;
	release.target = 'f'.repeat(40);
	const retried = await retry();
	const kept = retried?.draftRelease?.id;
	if (kept === undefined) throw new Error('Expected a draft on the retried release');
	expect(repository.releases.includes(release)).toBe(false);
	expect([kept === draft.id, kept === release.id]).toEqual([false, false]);
	expect(drafts().map(entry => [entry.id, entry.target])).toEqual([[kept, merged.sha]]);
}, 60_000);

test('a push release waits for its credential grant and dispatches once the grant exists', async () => {
	const repository = widget(world.github, { approval: 'push' });
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const merged = world.github.push(repository, { 'package.json': manifest('widget', '1.1.0') }, 'Release 1.1.0');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(60_000);
	const [waiting] = await promotions(api);
	expect([waiting?.state, waiting?.sourceSha, waiting?.reason]).toEqual([
		'awaiting-approval',
		merged.sha,
		'Releases once npm-token has a runtime grant for publish.yml',
	]);
	expect(world.github.dispatches).toEqual([]);

	await elevate();
	expect(
		(await api('/api/credentials/replace', {
			alias: 'npm-token',
			value: 'secret',
			proof: 'proof',
			expectedVersion: null,
		}))
			.status,
	).toBe(200);
	await elevate();
	const granted = await api('/api/credentials/grant', {
		proof: 'proof',
		selection: {
			alias: 'npm-token',
			repositoryId: repository.id,
			stream: 'main',
			operation: 'promote',
			delivery: 'runtime',
		},
	});
	expect(granted.status).toBe(200);
	await world.wait(16_000);
	const [approved] = await promotions(api);
	expect(approved?.reason).toBeUndefined();
	expect(approved?.approvedAt).toBeNumber();
	expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([approved?.id]);
}, 60_000);

test('a promotion waits for the promotion of the same commit that publishes its dependency', async () => {
	const promote = (name: string) => ({
		packages: [`pkg:npm/${name}`],
		required: [`pkg:npm/${name}`],
		prepare: { strategy: 'managed' },
		promote: { approval: 'push', workflow: { file: 'publish.yml', publications: [`pkg:npm/${name}`] } },
	});
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: { main: promote('widget'), cli: promote('gadget') },
		}),
		'packages/gadget/package.json': manifest('gadget', '1.0.0', { widget: '^1.0.0' }),
	}, 'Release the gadget CLI separately');
	passChecks(repository, world.github.head(repository));
	world.npm.publish('widget', '1.0.0');
	world.npm.publish('gadget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const merged = world.github.push(repository, {
		'package.json': manifest('widget', '1.1.0'),
		'packages/gadget/package.json': manifest('gadget', '1.1.0', { widget: '^1.1.0' }),
	}, 'Release 1.1.0');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const byStream = async () => new Map((await promotions(api)).map(promotion => [promotion.stream, promotion]));
	const first = await byStream();
	const main = first.get('main'), cli = first.get('cli');
	if (!main || !cli) throw new Error('Expected promotions for both streams');
	expect([cli.state, cli.reason]).toEqual([
		'awaiting-approval',
		'Releases after the main release publishes pkg:npm/widget',
	]);
	expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([main.id]);

	await finish(repository, main, 'widget', '1.1.0');
	await world.wait(16_000);
	const second = await byStream();
	expect(second.get('main')?.state).toBe('succeeded');
	expect(second.get('cli')?.reason).toBeUndefined();
	expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([main.id, cli.id]);
}, 60_000);
