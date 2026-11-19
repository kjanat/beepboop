import { expect, test } from 'bun:test';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import type { Api } from '@root/test/support/http.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import { prepareRelease, promotions } from '@root/test/support/releases.ts';
import {
	editableConfiguration,
	licenseText,
	npmManifest,
	passChecks,
	widget,
} from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Schema } from 'effect';
import type { Execution } from '@/automation/types';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

type Approval = 'required' | 'merge' | 'push';

let world: World;
eachWorld(created => {
	world = created;
});

function taggedConfiguration(approval: Approval, lint = false) {
	const configuration = editableConfiguration();
	const main = configuration.streams.main;
	configuration.streams.main = {
		...main,
		credentials: [],
		prepare: { strategy: 'managed', bump: 'pr' },
		promote: {
			...main.promote,
			approval,
			workflow: {
				...main.promote.workflow,
				refs: { phase: 'version', prefix: 'v' },
				...(lint ? { needs: ['lint'] } : {}),
			},
		},
		...(lint ? { workflows: { lint: { file: 'lint.yml' } } } : {}),
	};
	return JSON.stringify(configuration);
}

async function configured(approval: Approval, lint = false) {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const head = world.github.push(
		repository,
		{
			'.github/beepboop.json': taggedConfiguration(approval, lint),
			...(lint
				? {
					'.github/workflows/lint.yml':
						'name: Lint\non:\n  workflow_dispatch:\n    inputs:\n      beepboop_execution_id:\n        required: true\n        type: string\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo lint\n',
				}
				: {}),
		},
		'Configure tagged releases',
	);
	passChecks(repository, head.sha);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	return { repository, api };
}

async function squashedVersionPr(approval: Approval, lint = false) {
	const { repository, api } = await configured(approval, lint);
	const request = { repositoryId: repository.id, stream: 'main', version: '1.0.1' };
	expect((await prepareRelease(api, request)).prepared.status).toBe(200);
	await world.wait(16_000);
	const pull = one(repository.pulls, 'version PR');
	world.github.push(repository, { 'CHANGELOG.md': '# 1.0.1\n\nNotes.\n' }, 'Write the release notes', pull.head.ref);
	const merged = world.github.merge(repository, pull.number, 'squash');
	return { repository, api, merged };
}

async function pushed(repository: Repository) {
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
}

function pendingChecks(repository: Repository, sha: string) {
	repository.checks.set(sha, [{ name: 'test', status: 'in_progress', conclusion: null, runId: 1 }]);
}

function moveOn(repository: Repository) {
	const later = world.github.push(repository, { 'renovate.json': '{}\n' }, 'Hold a dependency back');
	passChecks(repository, later.sha);
	return later;
}

function dispatched(repository: Repository) {
	return world.github.dispatches
		.filter(dispatch => dispatch.repository === repository.name)
		.map(dispatch => dispatch.inputs.beepboop_execution_id);
}

const refPlanSchema = mutableStruct({
	changes: mutableArray(mutableStruct({ name: Schema.String, commit: Schema.String })),
});

function refPlan(planned: { outputs: Record<string, string | undefined> }) {
	return decodeSync(refPlanSchema, JSON.parse(planned.outputs.result ?? '')).changes.map(({ name, commit }) => ({
		name,
		commit,
	}));
}

async function publishTagged(repository: Repository, api: Api, promotion: Execution) {
	const run = one(
		repository.runs.filter(entry => entry.inputs.beepboop_execution_id === promotion.id),
		'release run',
	);
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'publish.yml');
	await begin(world, identity, promotion.id, promotion.stream, 'promote');
	const planned = refPlan(await runAction(world, 'refs-plan', identity, { EXECUTION_ID: promotion.id }));
	for (const change of planned) repository.refs.set(`tags/${change.name}`, change.commit);
	await runAction(world, 'refs-complete', identity, { EXECUTION_ID: promotion.id });
	world.npm.publish('widget', '1.0.1');
	await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.1', outcome: 'succeeded' },
		]),
	});
	run.status = 'completed';
	run.conclusion = 'success';
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(16_000);
	return { run, planned };
}

for (const approval of ['merge', 'required', 'push'] as const) {
	test(`a squash-merged version PR with a commit of its own follows approval ${approval}`, async () => {
		const { repository, api, merged } = await squashedVersionPr(approval);
		passChecks(repository, merged.sha);
		await pushed(repository);
		const promotion = one(await promotions(api), 'promotion');
		expect(promotion.sourceSha).toBe(merged.sha);
		if (approval === 'required') {
			expect([promotion.state, promotion.approvedBy, dispatched(repository)]).toEqual([
				'awaiting-approval',
				undefined,
				[],
			]);
		} else {
			expect([promotion.approvedBy, dispatched(repository)]).toEqual([
				approval === 'merge' ? 'merge' : undefined,
				[promotion.id],
			]);
		}
	});
}

test('a commit after the merged version PR leaves one release, which publishes and tags the version commit', async () => {
	const { repository, api, merged } = await squashedVersionPr('merge');
	pendingChecks(repository, merged.sha);
	await pushed(repository);
	const later = moveOn(repository);
	await pushed(repository);
	const waiting = one(await promotions(api), 'promotion');
	expect([waiting.sourceSha, waiting.state, waiting.approvedBy, dispatched(repository)]).toEqual([
		merged.sha,
		'awaiting-approval',
		'merge',
		[],
	]);
	passChecks(repository, merged.sha);
	await world.wait(60_000);
	expect(dispatched(repository)).toEqual([waiting.id]);
	const { run, planned } = await publishTagged(repository, api, waiting);
	expect(run.headSha).toBe(later.sha);
	expect(planned).toEqual([{ name: 'v1.0.1', commit: merged.sha }]);
	expect((await promotions(api)).map(entry => [entry.id, entry.sourceSha, entry.state])).toEqual([
		[waiting.id, merged.sha, 'succeeded'],
	]);
	expect(repository.refs.get('tags/v1.0.1')).toBe(merged.sha);
});

test('publishing the version commit in Beepboop works after the default branch moved on', async () => {
	const { repository, api, merged } = await squashedVersionPr('required');
	passChecks(repository, merged.sha);
	await pushed(repository);
	const later = moveOn(repository);
	await pushed(repository);
	const waiting = one(await promotions(api), 'promotion');
	expect([waiting.sourceSha, waiting.state]).toEqual([merged.sha, 'awaiting-approval']);
	const approved = await api('/api/executions/approve', { id: waiting.id, sourceSha: merged.sha });
	expect(approved.status).toBe(200);
	await world.wait(16_000);
	expect(dispatched(repository)).toEqual([waiting.id]);
	const { run } = await publishTagged(repository, api, waiting);
	expect(run.headSha).toBe(later.sha);
	expect((await promotions(api)).map(entry => [entry.sourceSha, entry.state])).toEqual([[merged.sha, 'succeeded']]);
	expect(repository.refs.get('tags/v1.0.1')).toBe(merged.sha);
});

test('releasing a version the default branch already carries pins the version commit', async () => {
	const { repository, api, merged } = await squashedVersionPr('required');
	passChecks(repository, merged.sha);
	const later = moveOn(repository);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const { plan, prepared } = await prepareRelease(api, {
		repositoryId: repository.id,
		stream: 'main',
		version: '1.0.1',
	});
	expect([plan.status, text(plan.body, 'sourceSha')]).toEqual([200, merged.sha]);
	expect(prepared.status).toBe(200);
	expect(world.github.head(repository)).toBe(later.sha);
	expect((await promotions(api)).map(entry => entry.sourceSha)).toEqual([merged.sha]);
});

test('a pushed version commit publishes itself although a later commit landed before its checks passed', async () => {
	const { repository, api } = await configured('push');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	pendingChecks(repository, version.sha);
	await pushed(repository);
	moveOn(repository);
	await pushed(repository);
	const waiting = one(await promotions(api), 'promotion');
	expect([waiting.sourceSha, dispatched(repository)]).toEqual([version.sha, []]);
	passChecks(repository, version.sha);
	await world.wait(60_000);
	expect(dispatched(repository)).toEqual([waiting.id]);
	await publishTagged(repository, api, waiting);
	expect((await promotions(api)).map(entry => [entry.sourceSha, entry.state])).toEqual([[version.sha, 'succeeded']]);
	expect(repository.refs.get('tags/v1.0.1')).toBe(version.sha);
});

test('a later commit that edits the manifest gets its own release, which supersedes the earlier one', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	const edited = world.github.push(
		repository,
		{ 'package.json': npmManifest('widget', '1.0.1', { keywords: ['widget'] }) },
		'Add keywords',
	);
	passChecks(repository, edited.sha);
	await pushed(repository);
	const bySource = async () => new Map((await promotions(api)).map(entry => [entry.sourceSha, entry]));
	const both = await bySource();
	const earlier = both.get(version.sha), current = both.get(edited.sha);
	if (!earlier || !current) throw new Error('Expected a release for each commit');
	const refused = await api('/api/executions/approve', { id: earlier.id, sourceSha: version.sha });
	expect([refused.status, text(refused.body, 'error')]).toEqual([
		422,
		`main is at ${edited.sha.slice(0, 12)}. Publish the release for that commit.`,
	]);
	expect((await api('/api/executions/approve', { id: current.id, sourceSha: edited.sha })).status).toBe(200);
	const settled = await bySource();
	expect([settled.get(version.sha)?.state, settled.get(version.sha)?.reason]).toEqual([
		'cancelled',
		`Superseded by ${current.id}`,
	]);
});

test('a later commit that raises the version again refuses the earlier version commit', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	const raised = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.2') }, 'Release 1.0.2');
	passChecks(repository, raised.sha);
	await pushed(repository);
	const listed = await promotions(api);
	expect(listed.map(entry => [entry.sourceSha, entry.version]).sort()).toEqual(
		[[version.sha, '1.0.1'], [raised.sha, '1.0.2']].sort(),
	);
	const earlier = one(listed.filter(entry => entry.version === '1.0.1'), '1.0.1 release');
	const refused = await api('/api/executions/approve', { id: earlier.id, sourceSha: version.sha });
	expect([refused.status, text(refused.body, 'error')]).toEqual([
		422,
		`main is at ${raised.sha.slice(0, 12)}. Publish the release for that commit.`,
	]);
});

test('a later commit that adds the missing license file gets its own release, and the earlier one cannot publish', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(
		repository,
		{ 'package.json': npmManifest('widget', '1.0.1'), LICENSE: null },
		'Release 1.0.1',
	);
	passChecks(repository, version.sha);
	await pushed(repository);
	const licensed = world.github.push(repository, { LICENSE: licenseText }, 'Add the license');
	passChecks(repository, licensed.sha);
	await pushed(repository);
	const bySource = new Map((await promotions(api)).map(entry => [entry.sourceSha, entry]));
	const earlier = bySource.get(version.sha), current = bySource.get(licensed.sha);
	if (!earlier || !current) throw new Error('Expected a release for each commit');
	const refused = await api('/api/executions/approve', { id: earlier.id, sourceSha: version.sha });
	expect([refused.status, text(refused.body, 'error')]).toEqual([
		422,
		`main is at ${licensed.sha.slice(0, 12)}. Publish the release for that commit.`,
	]);
	expect((await api('/api/executions/approve', { id: current.id, sourceSha: licensed.sha })).status).toBe(200);
});

test('a manifest edit after the merged version PR waits for you to publish it and retires the merged release', async () => {
	const { repository, api, merged } = await squashedVersionPr('merge');
	pendingChecks(repository, merged.sha);
	await pushed(repository);
	const edited = world.github.push(
		repository,
		{ 'package.json': npmManifest('widget', '1.0.1', { keywords: ['widget'] }) },
		'Add keywords',
	);
	passChecks(repository, edited.sha);
	await pushed(repository);
	passChecks(repository, merged.sha);
	await world.wait(60_000);
	const bySource = new Map((await promotions(api)).map(entry => [entry.sourceSha, entry]));
	const current = bySource.get(edited.sha);
	expect([current?.state, current?.approvedBy]).toEqual(['awaiting-approval', undefined]);
	expect([bySource.get(merged.sha)?.state, bySource.get(merged.sha)?.reason]).toEqual([
		'cancelled',
		`Superseded by ${current?.id}`,
	]);
	expect(dispatched(repository)).toEqual([]);
});

test('a reverted manifest edit lets the version commit publish and retires the edit release', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	const edited = world.github.push(
		repository,
		{ 'package.json': npmManifest('widget', '1.0.1', { keywords: ['widget'] }) },
		'Add keywords',
	);
	passChecks(repository, edited.sha);
	await pushed(repository);
	const reverted = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Drop keywords');
	passChecks(repository, reverted.sha);
	await pushed(repository);
	const bySource = async () => new Map((await promotions(api)).map(entry => [entry.sourceSha, entry]));
	const listed = await bySource();
	const earlier = listed.get(version.sha), later = listed.get(edited.sha);
	if (!earlier || !later) throw new Error('Expected a release for each manifest');
	expect(listed.size).toBe(2);
	const refused = await api('/api/executions/approve', { id: later.id, sourceSha: edited.sha });
	expect(refused.status).toBe(422);
	expect((await api('/api/executions/approve', { id: earlier.id, sourceSha: version.sha })).status).toBe(200);
	expect((await bySource()).get(edited.sha)?.state).toBe('cancelled');
});

test('a cancelled release of the version does not hold it for a later commit', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	const cancelled = one(await promotions(api), 'promotion');
	expect((await api('/api/executions/cancel', { id: cancelled.id })).status).toBe(200);
	const later = moveOn(repository);
	await pushed(repository);
	const current = one((await promotions(api)).filter(entry => entry.state !== 'cancelled'), 'open promotion');
	expect(current.sourceSha).toBe(later.sha);
});

test('a commit that GitHub cannot compare with an earlier release still gets a release', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	world.network.serve('api.github.com', request =>
		new URL(request.url).pathname.includes(`/compare/${version.sha}...`)
			? Response.json({ message: 'Not Found' }, { status: 404 })
			: world.github.handle(request));
	const later = moveOn(repository);
	await pushed(repository);
	expect((await promotions(api)).map(entry => entry.sourceSha).sort()).toEqual([version.sha, later.sha].sort());
});

test('a change to a reusable workflow that the release workflow calls gets its own release', async () => {
	const { repository, api } = await configured('required');
	const publish = world.github.file(repository, '.github/workflows/publish.yml') ?? '';
	const build = (step: string) =>
		`on: workflow_call\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${step}\n`;
	const calling = world.github.push(repository, {
		'.github/workflows/build.yml': build('npm pack'),
		'.github/workflows/publish.yml': `${publish}  build:\n    uses: ./.github/workflows/build.yml\n`,
	}, 'Build in a reusable workflow');
	passChecks(repository, calling.sha);
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	const changed = world.github.push(
		repository,
		{ '.github/workflows/build.yml': build('npm pack --dry-run') },
		'Change the build',
	);
	passChecks(repository, changed.sha);
	await pushed(repository);
	const listed = new Map((await promotions(api)).map(entry => [entry.sourceSha, entry]));
	const earlier = listed.get(version.sha);
	if (!earlier || !listed.has(changed.sha)) throw new Error('Expected a release for each workflow');
	const refused = await api('/api/executions/approve', { id: earlier.id, sourceSha: version.sha });
	expect([refused.status, text(refused.body, 'error')]).toEqual([
		422,
		`main is at ${changed.sha.slice(0, 12)}. Publish the release for that commit.`,
	]);
});

test('a cancelled release of a merged version PR does not hold the version for a later commit', async () => {
	const { repository, api, merged } = await squashedVersionPr('required');
	passChecks(repository, merged.sha);
	await pushed(repository);
	const cancelled = one(await promotions(api), 'promotion');
	expect(cancelled.sourceSha).toBe(merged.sha);
	expect((await api('/api/executions/cancel', { id: cancelled.id })).status).toBe(200);
	const later = moveOn(repository);
	await pushed(repository);
	const current = one((await promotions(api)).filter(entry => entry.state !== 'cancelled'), 'open promotion');
	expect([current.sourceSha, current.state]).toEqual([later.sha, 'awaiting-approval']);
});

test('a later commit that stops publishing a package of the release refuses the earlier version commit', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	const waiting = one(await promotions(api), 'promotion');
	const hidden = world.github.push(
		repository,
		{ 'package.json': npmManifest('widget', '1.0.1', { private: true }) },
		'Stop publishing widget',
	);
	passChecks(repository, hidden.sha);
	await pushed(repository);
	const refused = await api('/api/executions/approve', { id: waiting.id, sourceSha: version.sha });
	expect([refused.status, text(refused.body, 'error')]).toEqual([
		422,
		`main is at ${hidden.sha.slice(0, 12)}. Publish the release for that commit.`,
	]);
});

test('a later change to the release configuration refuses the earlier version commit', async () => {
	const { repository, api } = await configured('required');
	const version = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, version.sha);
	await pushed(repository);
	const waiting = one(await promotions(api), 'promotion');
	const reconfigured = world.github.push(
		repository,
		{ '.github/beepboop.json': taggedConfiguration('push') },
		'Publish on push',
	);
	passChecks(repository, reconfigured.sha);
	await pushed(repository);
	const refused = await api('/api/executions/approve', { id: waiting.id, sourceSha: version.sha });
	expect(refused.status).toBe(422);
	const current = one((await promotions(api)).filter(entry => entry.id !== waiting.id), 'new promotion');
	expect(current.sourceSha).toBe(reconfigured.sha);
});

test('a prerequisite of a kept release still starts after the default branch moved on', async () => {
	const { repository, api, merged } = await squashedVersionPr('push', true);
	passChecks(repository, merged.sha);
	moveOn(repository);
	await pushed(repository);
	const waiting = one(await promotions(api), 'promotion');
	expect([waiting.sourceSha, waiting.dependencies.length]).toEqual([merged.sha, 1]);
	expect(dispatched(repository)).toEqual(waiting.dependencies);
});
