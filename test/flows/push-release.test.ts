import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import type { Reply } from '@root/test/support/http.ts';
import { bearer, field, text } from '@root/test/support/http.ts';
import { promotions } from '@root/test/support/releases.ts';
import { licenseText, npmManifest, passChecks, widget } from '@root/test/support/repositories.ts';
import { applySetup, previewSetup } from '@root/test/support/setup.ts';
import type { SigningKey } from '@root/test/support/signing.ts';
import { fakeSigner, signingKey } from '@root/test/support/signing.ts';
import type { RunIdentity, World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Schema } from 'effect';
import type { Execution } from '@/automation/types';
import { decodeSync, mutableArray, mutableStruct } from '@/schema';

type Api = (path: string, body?: unknown) => Promise<Reply>;

let world: World, key: SigningKey | undefined;
eachWorld(created => {
	world = created;
});
afterEach(() => {
	key?.dispose();
	key = undefined;
});

function manifest(name: string, version: string, dependencies?: Record<string, string>): string {
	return npmManifest(name, version, dependencies ? { dependencies } : {});
}
async function finish(repository: Repository, promotion: Execution, name: string, version: string) {
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === promotion.id);
	if (!run) throw new Error(`No run for ${promotion.stream}`);
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'publish.yml');
	await begin(world, identity, promotion.id, promotion.stream, 'promote');
	world.npm.publish(name, version);
	await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([{ id: `pkg:npm/${name}`, manager: 'npm', name, version, outcome: 'succeeded' }]),
	});
	run.status = 'completed';
	run.conclusion = 'success';
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(2_000);
}

async function mergedSetup(release: boolean, approval: 'push' | 'required' = 'push') {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const plan = await previewSetup(api, repository.name, {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			approval,
			promote: {
				file: 'release.yml',
				job: 'promote',
				triggers: 'review',
				commands: 'npm publish',
				publicationSteps: {},
			},
		}],
	});
	expect(plan.blockers).toEqual([]);
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(200);
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
	await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
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

const signedPlan = mutableStruct({
	changes: mutableArray(mutableStruct({
		name: Schema.String,
		expected: Schema.NullOr(Schema.String),
		commit: Schema.String,
		object: Schema.optional(Schema.String),
		replaces: Schema.optional(Schema.Boolean),
	})),
});
function objectId(object: string | undefined): string {
	const hashed = spawnSync('git', ['hash-object', '-t', 'tag', '--stdin', '--literally'], {
		input: object ?? '',
		encoding: 'utf8',
	});
	return hashed.stdout.trim();
}
async function pushRefs(identity: RunIdentity, executionId: string, repository: Repository) {
	const planned = await runAction(world, 'refs-plan', identity, { EXECUTION_ID: executionId });
	const changes = decodeSync(signedPlan, JSON.parse(planned.outputs.result ?? '')).changes;
	for (const change of changes) {
		if (change.object !== undefined) {
			world.github.recordTag(repository, change.name, objectId(change.object), change.commit, true);
		}
	}
	await runAction(world, 'refs-complete', identity, { EXECUTION_ID: executionId });
	return changes;
}

async function taggedFailure(approval: 'push' | 'required' = 'push', existing?: string) {
	key = signingKey('Release Bot (CI) <release@example.com>');
	world.env.SIGNER = fakeSigner(key);
	const { repository, api, merged } = await mergedSetup(true, approval);
	if (existing) world.github.recordTag(repository, 'v1.0.0', existing, merged.sha, true);
	if (approval === 'required') {
		const [waiting] = await promotions(api);
		expect((await api('/api/executions/approve', { id: waiting?.id, sourceSha: merged.sha })).status).toBe(200);
		await world.wait(16_000);
	}
	const [first] = await promotions(api);
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === first?.id);
	if (!first || !run) throw new Error('Expected a dispatched release');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'release.yml');
	await begin(world, identity, first.id, 'main', 'promote');
	const changes = await pushRefs(identity, first.id, repository);
	expect(changes.map(change => [change.name, change.expected])).toEqual([['v1.0.0', existing ?? null]]);
	run.status = 'completed';
	run.conclusion = 'failure';
	await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
	await world.wait(16_000);
	expect((await promotions(api)).map(promotion => promotion.state)).toEqual(['failed']);
	const oid = repository.refs.get('tags/v1.0.0') ?? '';
	return { repository, api, merged, first, run, oid };
}
async function pushFix(repository: Repository, checks = true) {
	const fixed = world.github.push(repository, { 'README.md': '# widget\n\nFixed.\n' }, 'Fix the release');
	if (checks) passChecks(repository, fixed.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	return fixed;
}

test('a release of the same version takes over the tag of a failed release that published nothing', async () => {
	const { repository, api, merged, first, oid } = await taggedFailure();
	const fixed = await pushFix(repository);
	const second = (await promotions(api)).find(promotion => promotion.sourceSha === fixed.sha);
	if (!second) throw new Error('Expected a release of the fixed commit');
	expect([second.version, second.reclaims]).toEqual(['1.0.0', [{ name: 'v1.0.0', oid, commit: merged.sha }]]);
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === second.id);
	if (!run) throw new Error('Expected the second release run');
	expect(run.headSha).toBe(fixed.sha);
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'release.yml');
	await begin(world, identity, second.id, 'main', 'promote');
	const changes = await pushRefs(identity, second.id, repository);
	expect(changes.map(change => [change.name, change.expected, change.commit, change.replaces])).toEqual([
		['v1.0.0', oid, fixed.sha, true],
	]);
	const earlier = (await promotions(api)).find(promotion => promotion.id === first.id);
	expect([earlier?.state, earlier?.reason]).toEqual(['cancelled', `Superseded by ${second.id}`]);
	const retried = await api('/api/executions/recover', { id: first.id, action: 'retry' });
	expect([retried.status, field(retried.body, 'error')]).toEqual([
		422,
		`Release ${second.id} takes over the version tag of 1.0.0; retry that release instead`,
	]);
	world.npm.publish('widget', '1.0.0');
	await runAction(world, 'report', identity, {
		EXECUTION_ID: second.id,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.0', outcome: 'succeeded' },
		]),
	});
	await runAction(world, 'release', identity, { EXECUTION_ID: second.id });
	run.status = 'completed';
	run.conclusion = 'success';
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(16_000);
	expect((await promotions(api)).find(promotion => promotion.id === second.id)?.state).toBe('succeeded');
	expect(
		repository.releases.filter(release => release.tag === 'v1.0.0').map(release => [release.draft, release.target]),
	)
		.toEqual([[false, fixed.sha]]);
}, 60_000);

test('a version already on its registry keeps its tag, and the new commit gets no release', async () => {
	const { repository, api, first } = await taggedFailure();
	world.npm.publish('widget', '1.0.0');
	await pushFix(repository);
	expect((await promotions(api)).map(promotion => [promotion.id, promotion.state])).toEqual([[first.id, 'failed']]);
}, 60_000);

test('a tag that a failed release found and only checked never moves', async () => {
	const { repository, api, merged } = await taggedFailure('push', 'a'.repeat(40));
	await pushFix(repository);
	expect((await promotions(api)).map(promotion => promotion.sourceSha)).toEqual([merged.sha]);
	expect(repository.refs.get('tags/v1.0.0')).toBe('a'.repeat(40));
}, 60_000);

test('a run of the failed release that still runs keeps its tag', async () => {
	const { repository, api, merged, run } = await taggedFailure();
	run.status = 'in_progress';
	await pushFix(repository);
	expect((await promotions(api)).map(promotion => promotion.sourceSha)).toEqual([merged.sha]);
}, 60_000);

test('a publishing run on the tagged commit that still runs keeps its tag', async () => {
	const { repository, api, merged, oid } = await taggedFailure();
	repository.runs.push({
		id: 900_001,
		path: '.github/workflows/publish.yml',
		event: 'push',
		headSha: merged.sha,
		headBranch: 'v1.0.0',
		status: 'in_progress',
		conclusion: null,
		attempt: 1,
		title: 'Publish v1.0.0',
		inputs: {},
	});
	await pushFix(repository);
	expect((await promotions(api)).map(promotion => promotion.sourceSha)).toEqual([merged.sha]);
	expect(repository.refs.get('tags/v1.0.0')).toBe(oid);
}, 60_000);

test('a takeover stops at its ref step once the version reached its registry', async () => {
	const { repository, api, merged, oid } = await taggedFailure();
	const fixed = await pushFix(repository);
	const second = (await promotions(api)).find(promotion => promotion.sourceSha === fixed.sha);
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === second?.id);
	if (!second || !run) throw new Error('Expected the second release run');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'release.yml');
	await begin(world, identity, second.id, 'main', 'promote');
	world.npm.publish('widget', '1.0.0');
	await expect(runAction(world, 'refs-plan', identity, { EXECUTION_ID: second.id })).rejects.toThrow(
		'v1.0.0 can no longer move: a release of 1.0.0 published or runs',
	);
	expect([repository.refs.get('tags/v1.0.0'), merged.sha.length]).toEqual([oid, 40]);
}, 60_000);

test('a cached takeover plan is checked again before the tag moves', async () => {
	const { repository, api, oid } = await taggedFailure();
	const fixed = await pushFix(repository);
	const second = (await promotions(api)).find(promotion => promotion.sourceSha === fixed.sha);
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === second?.id);
	if (!second || !run) throw new Error('Expected the second release run');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'release.yml');
	await begin(world, identity, second.id, 'main', 'promote');
	await runAction(world, 'refs-plan', identity, { EXECUTION_ID: second.id });
	world.npm.publish('widget', '1.0.0');
	await expect(runAction(world, 'refs-plan', identity, { EXECUTION_ID: second.id })).rejects.toThrow(
		'v1.0.0 can no longer move: a release of 1.0.0 published or runs',
	);
	expect(repository.refs.get('tags/v1.0.0')).toBe(oid);
}, 60_000);

for (const published of [true, false]) {
	test(
		`a package of the failed release that left the stream ${published ? 'blocks' : 'allows'} the takeover`,
		async () => {
			const { repository, api, first } = await taggedFailure();
			const file = '.github/beepboop.json';
			const renamed = (world.github.file(repository, file) ?? '').replaceAll('pkg:npm/widget', 'pkg:npm/gadget');
			if (published) world.npm.publish('widget', '1.0.0');
			const fixed = world.github.push(
				repository,
				{ [file]: renamed, 'package.json': manifest('gadget', '1.0.0') },
				'Rename the package',
			);
			passChecks(repository, fixed.sha);
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
			const takeover = (await promotions(api)).find(promotion => promotion.sourceSha === fixed.sha);
			expect([(await promotions(api)).some(promotion => promotion.id === first.id), takeover?.reclaims?.length])
				.toEqual([true, published ? undefined : 1]);
		},
		60_000,
	);
}

test('a takeover leaves retries of other operations of its version alone', async () => {
	const { repository, api } = await taggedFailure();
	const fixed = await pushFix(repository);
	const second = (await promotions(api)).find(promotion => promotion.sourceSha === fixed.sha);
	if (!second) throw new Error('Expected the takeover release');
	await world.coordinator(repository).enqueue({ ...second, id: 'downstream', operation: 'extra', state: 'failed' });
	const retried = await api('/api/executions/recover', { id: 'downstream', action: 'retry' });
	expect(field(retried.body, 'error') ?? '').not.toContain('takes over the version tag');
}, 60_000);

test('a push-approved takeover checks the registries before it starts', async () => {
	const { repository, api } = await taggedFailure();
	const fixed = await pushFix(repository, false);
	const second = (await promotions(api)).find(promotion => promotion.sourceSha === fixed.sha);
	if (!second) throw new Error('Expected a release waiting for its checks');
	world.npm.publish('widget', '1.0.0');
	passChecks(repository, fixed.sha);
	await world.wait(16_000);
	const stopped = (await promotions(api)).find(promotion => promotion.id === second.id);
	expect(stopped?.state).toBe('cancelled');
	expect(stopped?.reason).toContain('and that release published packages');
	expect(repository.runs.filter(entry => entry.inputs.beepboop_execution_id === second.id)).toEqual([]);
}, 60_000);

test('a takeover waits while nothing of the version is public, and stops once something is', async () => {
	const { repository, api, merged } = await taggedFailure('required');
	const fixed = await pushFix(repository);
	const second = (await promotions(api)).find(promotion => promotion.sourceSha === fixed.sha);
	if (!second) throw new Error('Expected a release of the fixed commit');
	expect([second.state, second.reclaims?.map(tag => tag.name)]).toEqual(['awaiting-approval', ['v1.0.0']]);
	const readiness = async () => {
		const reply = await api('/api/executions/approval', { id: second.id });
		return decodeSync(mutableStruct({ blocked: mutableArray(Schema.String) }), reply.body).blocked;
	};
	expect(await readiness()).toEqual([]);
	world.npm.publish('widget', '1.0.0');
	const refused = await api('/api/executions/approve', { id: second.id, sourceSha: fixed.sha });
	const lost = `Version tag v1.0.0 already targets ${merged.sha.slice(0, 12)}, and that release published packages`;
	expect([refused.status, field(refused.body, 'error')]).toEqual([422, lost]);
	repository.releases.push({
		id: 999,
		tag: 'v1.0.0',
		target: merged.sha,
		draft: false,
		prerelease: false,
		authorId: 1,
		body: '',
	});
	expect(await readiness()).toEqual([`${lost}. Release a new version.`]);
}, 60_000);

test('a retry that re-runs the failed jobs of the same run keeps the recorded draft', async () => {
	const { merged, run, draft, retry, drafts } = await failedRelease(true);
	const retried = await retry();
	expect([run.attempt, retried?.runId, retried?.draftRelease]).toEqual([2, run.id, draft]);
	expect(drafts().map(release => [release.id, release.target])).toEqual([[draft.id, merged.sha]]);
}, 60_000);

test('a retry refuses to run once the workflow branch has moved past the release commit', async () => {
	const { repository, merged, run, draft } = await failedRelease(true);
	const api = bearer(world, await world.cliSession());
	const file = '.github/workflows/release.yml';
	const workflow = world.github.file(repository, file, merged.sha) ?? '';
	const moved = world.github.push(repository, { [file]: `${workflow}# changed\n` }, 'Change the release workflow');
	const [promotion] = await promotions(api);
	if (!promotion) throw new Error('Expected the failed release');
	const refused = await api('/api/executions/recover', { id: promotion.id, action: 'retry' });
	expect([refused.status, field(refused.body, 'error')]).toEqual([
		422,
		`main is at ${moved.sha.slice(0, 12)} but this execution builds ${
			merged.sha.slice(0, 12)
		}; prepare the release again`,
	]);
	await world.wait(16_000);
	const [kept] = await promotions(api);
	expect([kept?.state, kept?.draftRelease, run.attempt]).toEqual(['failed', draft, 1]);
	expect(repository.runs.filter(entry => entry.inputs.beepboop_execution_id === promotion.id).length).toBe(1);
}, 60_000);

test('a retry re-runs the failed jobs of a tagged release after the workflow branch moved', async () => {
	const { repository, merged, run, draft } = await failedRelease(true);
	const api = bearer(world, await world.cliSession());
	repository.refs.set('tags/v1.0.0', merged.sha);
	world.github.push(repository, { 'README.md': '# widget\n\nMoved on.\n' }, 'Move the branch');
	const [promotion] = await promotions(api);
	if (!promotion) throw new Error('Expected the failed release');
	expect((await api('/api/executions/recover', { id: promotion.id, action: 'retry' })).status).toBe(200);
	await world.wait(16_000);
	const [retried] = await promotions(api);
	expect([run.attempt, retried?.runId, retried?.draftRelease]).toEqual([2, run.id, draft]);
	expect(repository.runs.filter(entry => entry.inputs.beepboop_execution_id === promotion.id).length).toBe(1);
}, 60_000);

test('a retry refuses a tagged release whose run built another commit after the branch moved', async () => {
	const { repository, merged, run } = await failedRelease();
	const api = bearer(world, await world.cliSession());
	repository.refs.set('tags/v1.0.0', merged.sha);
	const moved = world.github.push(repository, { 'README.md': '# widget\n\nMoved on.\n' }, 'Move the branch');
	const [promotion] = await promotions(api);
	if (!promotion) throw new Error('Expected the failed release');
	const refused = await api('/api/executions/recover', { id: promotion.id, action: 'retry' });
	expect([refused.status, field(refused.body, 'error')]).toEqual([
		422,
		`main is at ${moved.sha.slice(0, 12)} but this execution builds ${
			merged.sha.slice(0, 12)
		}; prepare the release again`,
	]);
	expect(run.attempt).toBe(1);
}, 60_000);

test('a retry on an unmoved branch re-runs the failed jobs while a tag resolves to no commit', async () => {
	const { repository, merged, run, draft, retry } = await failedRelease(true);
	const oid = 'f'.repeat(40);
	world.github.recordTag(repository, 'tree-v1', oid, merged.sha, true);
	const tree = repository.tagObjects.get(oid);
	if (!tree) throw new Error('Expected the tag object');
	tree.targetType = 'Tree';
	const retried = await retry();
	expect([run.attempt, retried?.runId, retried?.draftRelease]).toEqual([2, run.id, draft]);
}, 60_000);

test('a retry of a tagged release refuses once its workflow branch no longer exists', async () => {
	const { repository, merged, run, draft } = await failedRelease(true);
	const api = bearer(world, await world.cliSession());
	const [promotion] = await promotions(api);
	if (!promotion) throw new Error('Expected the failed release');
	repository.refs.set('tags/v1.0.0', merged.sha);
	repository.refs.delete('heads/main');
	const refused = await api('/api/executions/recover', { id: promotion.id, action: 'retry' });
	expect([refused.status, field(refused.body, 'error')]).toEqual([422, 'Workflow ref main no longer exists']);
	const [kept] = await promotions(api);
	expect([kept?.state, kept?.draftRelease, run.attempt]).toEqual(['failed', draft, 1]);
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

async function grantNpmToken(api: Api, repository: Repository) {
	await world.elevate();
	expect(
		(await api('/api/credentials/replace', {
			alias: 'npm-token',
			value: 'secret',
			proof: 'proof',
			expectedVersion: null,
		}))
			.status,
	).toBe(200);
	await world.elevate();
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
}

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

	await grantNpmToken(api, repository);
	await world.wait(16_000);
	const [approved] = await promotions(api);
	expect(approved?.reason).toBeUndefined();
	expect(approved?.approvedAt).toBeNumber();
	expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([approved?.id]);
}, 60_000);

test(
	'a promotion of a package without a license waits with the reason, refuses approval and releases once the license lands',
	async () => {
		const repository = widget(world.github, { approval: 'push' });
		world.npm.publish('widget', '1.0.0');
		const api = bearer(world, await world.cliSession());
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		await grantNpmToken(api, repository);
		const unlicensed = world.github.push(
			repository,
			{ 'package.json': npmManifest('widget', '1.1.0', { license: undefined }) },
			'Release 1.1.0',
		);
		passChecks(repository, unlicensed.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(60_000);
		const [blocked] = await promotions(api);
		if (!blocked) throw new Error('Expected a promotion');
		expect([blocked.state, blocked.sourceSha, blocked.reason]).toEqual([
			'awaiting-approval',
			unlicensed.sha,
			'Fix the package metadata before this release: widget (package.json) lacks license',
		]);
		expect(world.github.dispatches).toEqual([]);
		expect((await api('/api/executions/approval', { id: blocked.id })).body).toEqual({
			problems: [],
			blocked: ['widget (package.json) lacks license'],
		});
		world.network.serve('api.github.com', request =>
			new URL(request.url).pathname.endsWith('/status')
				? new Response(null, { status: 500 })
				: world.github.handle(request));
		expect((await api('/api/executions/approval', { id: blocked.id })).body).toEqual({
			problems: [],
			blocked: ['widget (package.json) lacks license'],
		});
		world.network.serve('api.github.com', request => world.github.handle(request));
		const forced = await api('/api/executions/approve', { id: blocked.id, sourceSha: unlicensed.sha, force: true });
		expect([forced.status, text(forced.body, 'error')]).toEqual([422, 'widget (package.json) lacks license']);

		const licensed = world.github.push(
			repository,
			{ 'package.json': npmManifest('widget', '1.1.0') },
			'Add the license',
		);
		passChecks(repository, licensed.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(60_000);
		const settled = new Map((await promotions(api)).map(promotion => [promotion.sourceSha, promotion]));
		expect(settled.get(unlicensed.sha)?.state).toBe('cancelled');
		const released = settled.get(licensed.sha);
		expect([released?.reason, typeof released?.approvedAt]).toEqual([undefined, 'number']);
		expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([released?.id]);
	},
	60_000,
);

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
		'packages/gadget/README.md': '# gadget\n',
		'packages/gadget/LICENSE': licenseText,
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
