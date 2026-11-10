import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { packedRelease } from '@root/test/support/packed-release.ts';
import { loggedErrors } from '@root/test/support/process.ts';
import { approvePromotion, only, prepareRelease } from '@root/test/support/releases.ts';
import { editableConfiguration, passChecks, widget } from '@root/test/support/repositories.ts';
import { fakeSigner, signingKey } from '@root/test/support/signing.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { experimental_AstroContainer } from 'astro/container';
import { Effect } from 'effect';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { Store } from '@/automation/store';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { executionId, releaseEventId } from '@/persistence/identity-keys';
import { needsUser, releaseSetSummaries, releaseSummaries, runStateLabel } from '@/server/releases';
import { overview } from '@/server/views/overview';
import { runCard } from '@/server/views/runs';
import { releaseStatus } from '@/server/views/tone';

type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
const componentModule = z.object({ default: z.custom<Component>(value => typeof value === 'function') });

let world: World;
eachWorld(created => {
	world = created;
});

test('a managed release travels from discovery to a verified publication', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());

	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	expect(text(discovered.body, 'name')).toBe('octo/widget');

	const { plan, prepared } = await prepareRelease(api, {
		repositoryId: repository.id,
		stream: 'main',
		version: '1.1.0',
	});
	expect(plan.status).toBe(200);
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
	expect(readiness.body).toEqual({ problems: [], blocked: [] });
	const approved = await api('/api/executions/approve', { id: promotion.id, sourceSha: merged.sha });
	expect(text(approved.body, 'state')).toBe('ready');

	await world.wait(16_000);
	const [dispatch] = world.github.dispatches;
	expect(dispatch?.inputs.beepboop_execution_id).toBe(promotion.id);
	const run = repository.runs.at(-1);
	if (!run) throw new Error('No workflow run');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'publish.yml');
	const begun = await begin(world, identity, promotion.id, 'main', 'promote');
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
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
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
	const session = await world.cliSession();
	const repository = await discoveredWidget(world, session);
	const api = bearer(world, session);
	await prepareRelease(api, { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	await world.push(repository);
	await world.wait(1_000);
	const { promotion } = await approvePromotion(api, merged.sha);
	expect(promotion.state).toBe('awaiting-approval');
	await world.wait(16_000);
	const run = repository.runs.at(-1);
	if (!run) throw new Error('No workflow run');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'publish.yml');
	await begin(world, identity, promotion.id, 'main', 'promote');
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
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(2_000);
	const entry = (await world.coordinator(repository).exportJournal()).find(entry =>
		entry.key === `execution:${promotion.id}`
	);
	const stored = z.record(z.string(), z.unknown()).parse(entry?.value);
	return { api, repository, merged, promotion, stored, token, finished: await only(api, 'promote') };
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
	const { api, repository, merged, promotion, stored, finished } = await finishedPromotion('pending');
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
	await api('/api/repositories/discover', { repository: repository.name });
	const record = await Effect.runPromise(new Store(world.db).repository(repository.id));
	if (!record) throw new Error('No stored repository');
	const unreported = { ...finished, state: 'awaiting-approval' as const, publications: [] };
	expect(releaseSummaries([unreported]).map(release => [release.verified, release.publications])).toEqual([
		[0, [{ id: 'pkg:npm/widget', outcome: 'waiting' }]],
	]);
	expect(releaseSummaries([unreported], [record]).map(release => [release.verified, release.publications])).toEqual([
		[1, [{ id: 'pkg:npm/widget', outcome: 'succeeded' }]],
	]);
	expect(releaseSummaries([{ ...unreported, version: '1.2.0' }], [record]).map(release => release.verified)).toEqual([
		0,
	]);
	expect(runCard(finished, Date.now())).toMatchObject({
		release: undefined,
		publications: [{ outcome: 'pending', href: 'https://www.npmjs.com/package/widget' }],
	});
	const failed = finished.publications.map(publication => ({ ...publication, outcome: 'failed' as const }));
	expect(runCard({ ...finished, publications: failed }, Date.now()).publications.map(p => p.href)).toEqual([
		'https://www.npmjs.com/package/widget',
	]);
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

test('the overview counts only runs that still need the user and shows each version as one release', async () => {
	const { finished, repository } = await finishedPromotion('pending');
	const record = await Effect.runPromise(new Store(world.db).repository(repository.id));
	if (!record) throw new Error('No stored repository');
	const run = (id: string, at: number, changes: Partial<Execution>): Execution => ({
		...finished,
		id,
		createdAt: at,
		updatedAt: at,
		...changes,
	});
	const prepared = { operation: 'prepare', publications: [], sourceSha: 'a'.repeat(40) };
	const published = finished.publications.map(publication => ({ ...publication, outcome: 'succeeded' as const }));
	const readable = [
		run('prepare-failed', 1, { ...prepared, state: 'failed' }),
		run('prepare-done', 2, { ...prepared, state: 'succeeded' }),
		run('promote-cancelled', 3, { state: 'cancelled' }),
		run('promote-done', 4, { state: 'succeeded', publications: published }),
		run('abandoned', 5, { version: '1.0.9', state: 'cancelled' }),
		run('waiting', 6, { version: '2.0.0', state: 'awaiting-approval' }),
		run('next-prepared', 7, { ...prepared, version: '2.1.0', state: 'succeeded' }),
		run('next-running', 8, { version: '2.2.0', state: 'running' }),
	];
	const view = overview({
		section: 'overview',
		repositories: { readable: [], unreadable: [] },
		executions: { readable, unreadable: [] },
	});
	expect([view.attention, view.waiting.map(entry => entry.id), view.running]).toEqual([
		2,
		['waiting', 'abandoned'],
		1,
	]);
	const statuses = Object.fromEntries(
		view.releases.map(
			release => [release.version, [release.runs.map(entry => entry.id), releaseStatus(release).label]],
		),
	);
	expect(statuses).toEqual({
		[finished.version ?? '']: [
			['prepare-failed', 'prepare-done', 'promote-cancelled', 'promote-done'],
			'Required publications verified',
		],
		'1.0.9': [['abandoned'], 'Needs attention'],
		'2.0.0': [['waiting'], 'Waiting for you to publish'],
		'2.1.0': [['next-prepared'], 'Prepared, no publication run yet'],
		'2.2.0': [['next-running'], 'In progress'],
	});
	expect(view.releases.find(release => release.version === finished.version)?.commit).toBe(finished.sourceSha);
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Overview.astro'));
	const container = await experimental_AstroContainer.create();
	const html = await container.renderToString(componentModule.parse(loaded).default, {
		props: {
			data: {
				section: 'overview',
				repositories: { readable: [record], unreadable: [] },
				executions: { readable, unreadable: [] },
			},
		},
		request: new Request(`${origin}/`),
	});
	const page = new Window();
	page.document.body.innerHTML = html;
	const texts = (selector: string) =>
		[...page.document.querySelectorAll(selector)].map(element => element.textContent.trim());
	expect(texts('h2').slice(0, 2)).toEqual(['Needs your attention', 'Recent releases']);
	expect(texts('.release-path li')).toContain('Publish commit');
	expect(texts('.release-path li')).not.toContain('Approve commit');
	const text = page.document.body.textContent;
	expect(text).toContain('Publication run');
	expect(text).toContain('Preparation run');
	expect(text).toContain('waiting for you to publish');
	expect(texts('*')).not.toContain('promote');
	await page.happyDOM.close();
});

test('a later run replaces a failed run only for the same release target', async () => {
	const { finished } = await finishedPromotion('pending');
	const run = (id: string, at: number, changes: Partial<Execution>): Execution => ({
		...finished,
		id,
		createdAt: at,
		updatedAt: at,
		state: 'failed',
		...changes,
	});
	const set = (group: string) => ({ preparationId: 'set', group, required: [] });
	const plan = (id: string) => ({
		lockfiles: [],
		sourceSha: 'a'.repeat(40),
		groups: [{ id, packages: [`pkg:npm/${id}`], version: '1.0.0' }],
		operations: [],
		publicationOrder: [],
		edits: [],
		diagnostics: [],
		requiresPreparation: true,
	});
	const prepare = (id: string, at: number, group: string, state: Execution['state']) =>
		run(id, at, { operation: 'prepare', version: undefined, plan: plan(group), publications: [], state });
	const readable = [
		run('a-failed', 1, { releaseSet: set('a') }),
		run('b-done', 2, { releaseSet: set('b'), state: 'succeeded' }),
		prepare('x-failed', 3, 'x', 'failed'),
		prepare('y-done', 4, 'y', 'succeeded'),
		prepare('z-failed', 5, 'z', 'failed'),
		prepare('z-done', 6, 'z', 'succeeded'),
	];
	expect(readable.filter(entry => needsUser(entry, readable)).map(entry => entry.id)).toEqual([
		'a-failed',
		'x-failed',
	]);
});

test('a run that publishes once its checks pass is not waiting for the user', async () => {
	const { finished } = await finishedPromotion('pending');
	const waiting = { ...finished, id: 'waiting', state: 'awaiting-approval' as const };
	const started = { ...waiting, id: 'started', approvedBy: 'start' as const };
	const streams = finished.configuration.streams;
	const stream = streams[finished.stream];
	if (!stream) throw new Error('No stream');
	const pushed = {
		...waiting,
		id: 'pushed',
		configuration: {
			...finished.configuration,
			streams: {
				...streams,
				[finished.stream]: { ...stream, promote: { ...stream.promote, approval: 'push' as const } },
			},
		},
	};
	const runs = [waiting, started, pushed];
	expect(runs.map(entry => [entry.id, needsUser(entry, runs), runStateLabel(entry)])).toEqual([
		['waiting', true, 'waiting for you to publish'],
		['started', false, 'publishing once its checks pass'],
		['pushed', false, 'publishing once its checks pass'],
	]);
	const [release] = releaseSummaries([started]);
	if (!release) throw new Error('No release');
	expect(releaseStatus(release).label).toBe('Publishing once its checks pass');
	expect(runCard(started, Date.now()).automatic).toBe(true);
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
	const configuration = editableConfiguration();
	configuration.streams.main.promote.workflow.ref = 'release-line';
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Release from a branch');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });

	await prepareRelease(api, { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	repository.refs.set('heads/release-line', merged.sha);
	await world.push(repository);
	await world.wait(1_000);
	const { promotion, approved } = await approvePromotion(api, merged.sha);
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
	await prepareRelease(api, { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
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
	const logged = loggedErrors();
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(logged.events()).toEqual([{
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

test('publish-release replaces the draft notes with one copy free of bot attribution', async () => {
	const { repository } = await packedRelease(
		world,
		async () => {
			const target = world.github.repository('octo/widget');
			target.pulls.push({
				number: target.pulls.length + 1,
				head: { ref: 'docs', sha: world.github.head(target) },
				base: target.defaultBranch,
				state: 'closed',
				merged: true,
				title: 'Document the widget',
				body: '',
				labels: [],
				assignees: [],
				reviewers: [],
				author: 'octo',
			});
			const draft = target.releases.find(release => release.draft);
			if (!draft) throw new Error('Expected the dispatch to create a draft release');
			draft.body = "## What's Changed\n* Stale by @claude[bot] in https://github.com/octo/widget/pull/1\n";
		},
		undefined,
		true,
	);
	const preparation = repository.pulls[0];
	expect({ assignees: preparation?.assignees, reviewers: preparation?.reviewers }).toEqual({
		assignees: ['octo'],
		reviewers: ['octo'],
	});
	expect(repository.releases.map(release => ({ tag: release.tag, draft: release.draft }))).toEqual([
		{ tag: 'v1.1.0', draft: false },
	]);
	expect(repository.releases[0]?.body).toBe([
		"## What's Changed",
		`* ${preparation?.title} in https://github.com/octo/widget/pull/1`,
		'* Document the widget by @octo in https://github.com/octo/widget/pull/2',
		'',
		'## New Contributors',
		'* @octo made their first contribution in https://github.com/octo/widget/pull/2',
		'',
		'**Full Changelog**: https://github.com/octo/widget/commits/v1.1.0',
	].join('\n'));
	const promotion = await only(bearer(world, await world.cliSession()), 'promote');
	expect(promotion.state).toBe('succeeded');
	expect(promotion.publications.find(entry => entry.manager === 'github-release')).toMatchObject({
		id: 'pkg:github/octo/widget',
		version: 'v1.1.0',
		outcome: 'succeeded',
	});
	expect(world.github.unhandled).toEqual([]);
}, 30_000);

test('publish-release drops the contributor section when only bots contributed', async () => {
	const { repository } = await packedRelease(world, undefined, undefined, true);
	expect(repository.releases[0]?.body).toBe([
		"## What's Changed",
		`* ${repository.pulls[0]?.title} in https://github.com/octo/widget/pull/1`,
		'',
		'**Full Changelog**: https://github.com/octo/widget/commits/v1.1.0',
	].join('\n'));
	expect(repository.releases[0]?.body).not.toContain('[bot]');
}, 30_000);

test('publish-release creates a missing release with the same cleaned notes', async () => {
	const { repository } = await packedRelease(
		world,
		async promotionId => {
			const target = world.github.repository('octo/widget');
			target.releases = [];
			const storage = world.coordinators.instance(String(target.id)).storage;
			const key = `execution:${promotionId}`;
			const stored = z.looseObject({ draftRelease: z.unknown() }).parse(await storage.get(key));
			delete stored.draftRelease;
			await storage.put(key, stored);
		},
		undefined,
		true,
	);
	expect(repository.releases.map(release => ({ draft: release.draft, body: release.body }))).toEqual([{
		draft: false,
		body: [
			"## What's Changed",
			`* ${repository.pulls[0]?.title} in https://github.com/octo/widget/pull/1`,
			'',
			'**Full Changelog**: https://github.com/octo/widget/commits/v1.1.0',
		].join('\n'),
	}]);
}, 30_000);
