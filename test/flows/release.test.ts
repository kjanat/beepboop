import { expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { packedRelease } from '@root/test/support/packed-release.ts';
import { loggedErrors } from '@root/test/support/process.ts';
import { approvePromotion, only, prepareRelease } from '@root/test/support/releases.ts';
import { editableConfiguration, jsonFile, passChecks, widget } from '@root/test/support/repositories.ts';
import { fakeSigner, signingKey } from '@root/test/support/signing.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { experimental_AstroContainer } from 'astro/container';
import { Effect, Schema, Struct } from 'effect';
import { Window } from 'happy-dom';
import { createExecution, runFailedNote } from '@/automation/execution';
import { Store } from '@/automation/store';
import type { Execution } from '@/automation/types';
import { requireReady } from '@/domain/repository';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { ProjectionBackfill } from '@/persistence/d1/backfill';
import { executionId, releaseEventId } from '@/persistence/identity-keys';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableRecord,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';
import { loaders } from '@/server/loaders';
import { needingUser, releaseSetSummaries, releaseSummaries, runStateLabel } from '@/server/releases';
import { overview } from '@/server/views/overview';
import { pipeline, runCard } from '@/server/views/runs';
import { releaseStatus } from '@/server/views/tone';
import { packageDestinations } from '@/ui/destinations';

type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
const componentModule = mutableStruct({
	default: Schema.declare<Component>((value): value is Component => typeof value === 'function'),
});

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
			{
				id: 'github-release:octo/widget',
				manager: 'github-release',
				name: repository.name,
				version: 'v1.1.0',
				outcome: 'succeeded',
			},
		]),
	});
	expect(reported.outputs.result).toContain('"outcome":"succeeded"');
	expect((await only(api, 'promote')).release).toMatchObject({ tag: 'v1.1.0', commit: merged.sha });

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
	expect(journal.find(entry => entry.key.startsWith('release-event:'))?.value).toMatchObject({
		release: { tag: 'v1.1.0', commit: merged.sha },
	});
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
	const stored = decodeSync(mutableRecord(Schema.String, Schema.Unknown), entry?.value);
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
			completed: [],
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
		completed: [],
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
	const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
		props: {
			data: {
				section: 'overview',
				completed: [],
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

test('a run cancelled after a newer release started stays below the unfinished release', async () => {
	const { finished, repository } = await finishedPromotion('pending');
	const record = await Effect.runPromise(new Store(world.db).repository(repository.id));
	if (!record) throw new Error('No stored repository');
	const run = (id: string, createdAt: number, updatedAt: number, changes: Partial<Execution>): Execution => ({
		...finished,
		id,
		createdAt,
		updatedAt,
		publications: [],
		...changes,
	});
	const readable = [
		run('stale-cancelled', 1, 900, { version: '1.0.0', state: 'cancelled' }),
		run('current-prepare', 2, 100, { version: '1.1.0', operation: 'prepare', state: 'running' }),
		run('stale-failed', 0, 950, { version: '0.9.0', state: 'failed' }),
		run('next-pending', 3, 50, { version: '1.2.0', operation: 'prepare', state: 'pending' }),
		run('awaiting', 4, 40, { version: '1.3.0', state: 'awaiting-approval' }),
	];
	const releases = releaseSummaries(readable).map(release => release.version);
	expect(releases).toEqual(['1.3.0', '1.2.0', '1.1.0', '1.0.0', '0.9.0']);
	const view = overview({
		section: 'overview',
		completed: [],
		repositories: { readable: [], unreadable: [] },
		executions: { readable, unreadable: [] },
	});
	expect(view.releases.map(release => release.version)).toEqual(releases);
	expect(view.waiting.map(entry => entry.id)).toEqual(['awaiting', 'stale-cancelled', 'stale-failed']);
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Overview.astro'));
	const container = await experimental_AstroContainer.create();
	const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
		props: {
			data: {
				section: 'overview',
				completed: [],
				repositories: { readable: [record], unreadable: [] },
				executions: { readable, unreadable: [] },
			},
		},
		request: new Request(`${origin}/`),
	});
	const page = new Window();
	page.document.body.innerHTML = html;
	const titles = [...page.document.querySelectorAll('article h2')].map(element => element.textContent.trim());
	expect(titles).toEqual(['Version 1.3.0', 'Version 1.2.0', 'Version 1.1.0', 'Version 1.0.0', 'Version 0.9.0']);
	await page.happyDOM.close();
});

test('GitHub package links preserve literal tags while GoReleaser keeps its version convention', () => {
	for (
		const [manager, version, tag] of [
			['github-release', '0.62.0', '0.62.0'],
			['github-release', 'v0.62.0', 'v0.62.0'],
			['github-release', 'tools/v0.62.0', 'tools/v0.62.0'],
			['goreleaser', '0.62.0', 'v0.62.0'],
		] as const
	) {
		const entries = packageDestinations({
			manager,
			name: 'kjanat/kprint',
			published: version,
			manifest: '',
			versionSource: '',
			publication: { kind: 'registry' },
			dependencies: [],
		}, 'kjanat/kprint');
		expect(entries[0]?.href).toBe(`https://github.com/kjanat/kprint/releases/tag/${tag}`);
	}
});

test.each(['1.1.0', 'v1.1.0', 'widget-v1.1.0', 'tools/v1.1.0'])(
	'the runs page preserves release tag %s in its publication table and run card',
	async tag => {
		const { finished } = await finishedPromotion('pending');
		const run = (id: string, at: number, changes: Partial<Execution>): Execution => ({
			...finished,
			id,
			createdAt: at,
			updatedAt: at,
			publications: [],
			...changes,
		});
		const [npm] = finished.publications;
		if (!npm) throw new Error('No publication');
		const { identity: _identity, ...bare } = npm;
		const wheel = {
			...bare,
			identity: { type: 'pypi', name: 'widget', version: npm.version },
			id: 'pkg:pypi/widget',
			manager: 'pypi' as const,
			name: 'widget',
			required: false,
		};
		const notes = {
			...bare,
			identity: { type: 'github', namespace: 'octo', name: 'widget', version: tag },
			id: 'pkg:github/octo/widget',
			manager: 'github-release' as const,
			name: 'octo/widget',
			version: tag,
			required: false,
		};
		const readable = [
			run('crates', 5, { operation: 'crates', state: 'running', runId: 44, runAttempt: 1 }),
			run('release', 4, {
				operation: 'release',
				state: 'failed',
				runId: 43,
				runAttempt: 2,
				publications: [{ ...wheel, outcome: 'succeeded' }, { ...notes, outcome: 'succeeded' }],
			}),
			run('promote', 3, { state: 'succeeded', publications: [{ ...npm, outcome: 'succeeded' }] }),
			run('promote-cancelled', 2, { state: 'cancelled' }),
			run('prepare', 1, { operation: 'prepare', state: 'succeeded' }),
		];
		const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Runs.astro'));
		const container = await experimental_AstroContainer.create();
		const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
			props: { data: { section: 'runs', executions: { readable, unreadable: [] }, repositories: [] } },
			request: new Request(`${origin}/runs`),
		});
		const page = new Window();
		page.document.body.innerHTML = html;
		const all = (selector: string) => [...page.document.querySelectorAll(selector)];
		const words = (selector: string) => all(selector).map(element => element.textContent.replace(/\s+/g, ' ').trim());
		expect(all('.release-pipeline')).toHaveLength(1);
		expect(words('.release-pipeline > .section-heading h2')).toEqual([`Version ${finished.version}`]);
		expect(
			all('.pipeline li').map(
				stage => [stage.querySelector('a, span > span')?.textContent, stage.getAttribute('data-tone')],
			),
		)
			.toEqual([
				['prepare', 'ok'],
				['promote', 'ok'],
				['release', 'error'],
				['crates', 'active'],
			]);
		expect(words('.pipeline li small')).toEqual([
			'succeeded ↗',
			'succeeded, attempt 2 ↗',
			'failed, attempt 2 ↗',
			'running ↗',
		]);
		expect(all('.pipeline li .arrow').map(link => link.getAttribute('href')).slice(2)).toEqual([
			'https://github.com/octo/widget/actions/runs/43',
			'https://github.com/octo/widget/actions/runs/44',
		]);
		const table = all('.release-pipeline > .release-detail > .table-scroll tbody tr').map(row => [
			row.querySelector('td')?.firstChild?.textContent?.trim(),
			row.querySelector('.arrow')?.getAttribute('href'),
			row.querySelector('.badge')?.textContent,
		]);
		expect(table).toEqual([
			['widget on npm', `https://www.npmjs.com/package/widget/v/${finished.version}`, 'succeeded'],
			['widget on PyPI', `https://pypi.org/project/widget/${finished.version}/`, 'succeeded'],
			['octo/widget on GitHub release', `https://github.com/octo/widget/releases/tag/${tag}`, 'succeeded'],
		]);
		expect(
			runCard({ ...finished, state: 'succeeded', publications: [{ ...notes, outcome: 'succeeded' }] }, Date.now())
				.release,
		).toEqual({
			tag,
			href: `https://github.com/octo/widget/releases/tag/${tag}`,
		});
		expect(all('.stage-detail').map(detail => [detail.querySelector('.run-card')?.id, detail.hasAttribute('open')]))
			.toEqual([
				['prepare', false],
				['promote', false],
				['promote-cancelled', false],
				['release', true],
				['crates', true],
			]);
		expect(page.document.body.textContent).not.toContain('Still to publish');
		await page.happyDOM.close();
	},
);

test('the runs page filters by repository and folds a settled release', async () => {
	const { finished } = await finishedPromotion('pending');
	const published = finished.publications.map(publication => ({ ...publication, outcome: 'succeeded' as const }));
	const { runId: _runId, runAttempt: _runAttempt, workflowSha: _workflowSha, ...unstarted } = finished;
	const actor = 'ab'.repeat(16);
	const readable: Execution[] = [
		{
			...unstarted,
			id: 'old-a',
			version: '1.0.0',
			state: 'cancelled',
			reason: `Cancelled by ${actor}`,
			createdAt: 1,
			updatedAt: 1,
		},
		{
			...unstarted,
			id: 'old-b',
			version: '1.0.0',
			state: 'cancelled',
			reason: `Cancelled by ${actor}`,
			createdAt: 2,
			updatedAt: 2,
		},
		{ ...finished, id: 'done', state: 'succeeded', publications: published, createdAt: 3, updatedAt: 3 },
		{
			...unstarted,
			id: 'observed',
			eventId: 'observed:77',
			operation: 'crates',
			state: 'succeeded',
			publications: [],
			runId: 77,
			createdAt: 4,
			updatedAt: 4,
		},
		{
			...finished,
			id: 'other',
			repository: 'octo/gadget',
			repositoryId: 99,
			state: 'running',
			createdAt: 5,
			updatedAt: 5,
		},
	];
	const unreadable = [
		{ id: 'broken-widget', repositoryId: finished.repositoryId, error: 'widget record' },
		{ id: 'broken-gadget', repositoryId: 99, error: 'gadget record' },
	];
	const completed = [{
		repositoryId: finished.repositoryId,
		stream: finished.stream,
		version: finished.version!,
		group: undefined,
		completedAt: 3,
	}];
	expect([...needingUser(readable, completed)]).toEqual([]);
	const unpublished = readable.map(run => run.id === 'done' ? { ...run, publications: [] } : run);
	expect([...needingUser(unpublished)]).toEqual(['old-b']);
	const hotfix = readable.map(run => run.version === '1.0.0' ? { ...run, version: '2.0.0' } : run);
	expect([...needingUser(hotfix, completed)]).toEqual(['old-b']);
	const set = (group: string) => ({ preparationId: 'set', group, required: [] });
	const groups = readable.map(run => ({ ...run, releaseSet: set(run.version === '1.0.0' ? 'widget' : 'gadget') }));
	expect([...needingUser(groups, completed)]).toEqual(['old-b']);
	const [old] = releaseSummaries(readable).filter(release => release.version === '1.0.0');
	if (!old) throw new Error('No release');
	expect(pipeline(old, Date.now())?.stages.map(stage => stage.note)).toEqual(['cancelled']);
	expect([runCard(readable[0] ?? finished, Date.now()).reason, runCard(readable[3] ?? finished, Date.now()).release])
		.toEqual([`Cancelled by ${actor.slice(0, 12)}`, undefined]);
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Runs.astro'));
	const container = await experimental_AstroContainer.create();
	const render = async (selected?: string) => {
		const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
			props: {
				data: {
					section: 'runs',
					completed,
					executions: { readable, unreadable },
					repositories: ['octo/gadget', 'octo/widget'],
					selected,
				},
			},
			request: new Request(`${origin}/runs`),
		});
		const page = new Window();
		page.document.body.innerHTML = html;
		const all = (selector: string) => [...page.document.querySelectorAll(selector)];
		const view = {
			filters: all('.filters a').map(link => [link.textContent.trim(), link.getAttribute('aria-current')]),
			releases: all('.release-pipeline').map(card => [
				card.querySelector('.eyebrow')?.textContent.trim(),
				card.querySelector('.section-heading .badge')?.textContent.trim(),
				card.querySelector('.release-detail')?.hasAttribute('open'),
			]),
			text: page.document.body.textContent,
			broken: all('.run-card pre').map(error => error.textContent),
			polled: page.document.querySelector('[data-runs-latest]')?.getAttribute('data-runs-repository'),
		};
		await page.happyDOM.close();
		return view;
	};
	const everything = await render();
	expect(everything.broken).toEqual(['widget record', 'gadget record']);
	expect(everything.filters).toEqual([
		['All repositories', 'page'],
		['octo/gadget', null],
		['octo/widget', null],
	]);
	expect(everything.releases).toEqual([
		['octo/widget / main', 'cancelled', false],
		['octo/widget / main', 'Required publications verified', false],
		['octo/gadget / main', 'In progress', true],
	]);
	expect(everything.text).toContain('Started on GitHub');
	const widget = await render('octo/widget');
	expect(widget.filters.filter(([, current]) => current === 'page')).toEqual([['octo/widget', 'page']]);
	expect([everything.polled, widget.polled]).toEqual([null, 'octo/widget']);
});

test('the runs loader reads one repository when the page names it', async () => {
	const { finished, repository } = await finishedPromotion('pending');
	const load = (name?: string) =>
		world.run(loaders.runs({ env: world.env, actor: 'admin', ...(name ? { repository: name } : {}) }));
	const named = await load(repository.name);
	expect([named.selected, named.repositories, named.executions.readable.map(run => run.id)]).toEqual([
		repository.name,
		[repository.name],
		(await load()).executions.readable.map(run => run.id),
	]);
	expect(named.executions.readable.map(run => run.id)).toContain(finished.id);
	expect((await load('octo/missing')).selected).toBeUndefined();
	const store = new Store(world.db);
	const other = await Effect.runPromise(store.readExecutions(repository.id + 1));
	expect(other).toEqual([]);
});

test('an earlier run that still needs the user decides its stage and stays unfolded', async () => {
	const { finished } = await finishedPromotion('pending');
	const published = finished.publications.map(publication => ({ ...publication, outcome: 'succeeded' as const }));
	const readable: Execution[] = [
		{ ...finished, id: 'unknown', state: 'uncertain', publications: [], createdAt: 1 },
		{ ...finished, id: 'done', state: 'succeeded', publications: published, createdAt: 2 },
	];
	const [release] = releaseSummaries(readable);
	if (!release) throw new Error('No release');
	const view = pipeline(release, Date.now());
	expect([view?.status.label, view?.open, view?.stages.map(stage => [stage.run?.id, stage.tone])]).toEqual([
		'Needs attention',
		true,
		[['unknown', 'warn']],
	]);
	expect(view?.stages.flatMap(stage => stage.runs).map(entry => [entry.run.id, entry.earlier, entry.open])).toEqual([
		['done', false, false],
		['unknown', true, true],
	]);
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Runs.astro'));
	const container = await experimental_AstroContainer.create();
	const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
		props: { data: { section: 'runs', executions: { readable, unreadable: [] }, repositories: [] } },
		request: new Request(`${origin}/runs`),
	});
	const page = new Window();
	page.document.body.innerHTML = html;
	const folds = [...page.document.querySelectorAll('details[data-fold]')].map(fold => [
		fold.getAttribute('data-fold'),
		fold.hasAttribute('open'),
	]);
	expect(folds).toEqual([
		[`release:${finished.repositoryId}:main:${finished.version}:`, true],
		['run:done', false],
		['details:done', false],
		['run:unknown', true],
		['details:unknown', false],
	]);
	expect(page.document.querySelector('details[data-fold="run:unknown"] form[data-action="recover"]')).not.toBeNull();
	await page.happyDOM.close();
});

test('a stage whose run failed after publishing is green and says the run failed', async () => {
	const { finished } = await finishedPromotion('pending');
	const published = finished.publications.map(publication => ({ ...publication, outcome: 'succeeded' as const }));
	const readable = [{ ...finished, state: 'succeeded' as const, reason: runFailedNote, publications: published }];
	const [release] = releaseSummaries(readable);
	if (!release) throw new Error('No release');
	const view = pipeline(release, Date.now());
	expect([view?.status.label, view?.stages.map(stage => [stage.operation, stage.tone, stage.note])]).toEqual([
		'Required publications verified',
		[['promote', 'ok', 'succeeded, workflow run failed']],
	]);
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Runs.astro'));
	const container = await experimental_AstroContainer.create();
	const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
		props: { data: { section: 'runs', executions: { readable, unreadable: [] }, repositories: [] } },
		request: new Request(`${origin}/runs`),
	});
	expect(html).toContain(runFailedNote);
	expect(html).not.toContain('This operation completed.');
});

test('a stage with one execution per package stays unfinished until every package succeeds', async () => {
	const { finished } = await finishedPromotion('pending');
	const run = (id: string, at: number, changes: Partial<Execution>): Execution => ({
		...finished,
		id,
		createdAt: at,
		updatedAt: at,
		operation: 'publish',
		publications: [],
		runAttempt: 1,
		...changes,
	});
	const [release] = releaseSummaries([
		run('core-failed', 1, { package: { id: 'pkg:npm/core', manager: 'npm' }, state: 'failed' }),
		run('core-running', 2, { package: { id: 'pkg:npm/core', manager: 'npm' }, state: 'running' }),
		run('cli-done', 3, { package: { id: 'pkg:npm/cli', manager: 'npm' }, state: 'succeeded' }),
	]);
	if (!release) throw new Error('No release');
	const stage = pipeline(release, Date.now())?.stages.find(entry => entry.operation === 'publish');
	expect([stage?.run?.id, stage?.tone, stage?.note]).toEqual([
		'core-running',
		'active',
		'running, 1 of 2 packages succeeded, attempt 2',
	]);
	expect(stage?.runs.map(entry => [entry.run.id, entry.earlier, entry.open])).toEqual([
		['core-running', false, true],
		['core-failed', true, false],
		['cli-done', false, false],
	]);
	expect(pipeline(release, Date.now())?.status).toEqual({ tone: 'active', label: 'In progress' });
});

test('stages follow the configured order and leave out the ones a release skipped', async () => {
	const { finished } = await finishedPromotion('pending');
	const stream = finished.configuration.streams[finished.stream];
	if (!stream) throw new Error('No stream');
	const binding = { file: 'lint.yml', inputs: {}, required: true };
	const configuration = {
		...finished.configuration,
		streams: {
			...finished.configuration.streams,
			[finished.stream]: {
				...stream,
				promote: { ...stream.promote, workflow: { ...binding, file: 'release.yml', needs: ['lint'] } },
				workflows: {
					lint: binding,
					release: { ...binding, file: 'observed.yml', needs: ['promote'] },
					crates: { ...binding, file: 'crates.yml', needs: ['release'] },
				},
			},
		},
	};
	const run = (id: string, at: number, changes: Partial<Execution>): Execution => ({
		...finished,
		configuration,
		id,
		createdAt: at,
		updatedAt: at,
		publications: [],
		...changes,
	});
	const stagesOf = (runs: Execution[]) => {
		const [release] = releaseSummaries(runs);
		if (!release) throw new Error('No release');
		return pipeline(release, Date.now())?.stages.map(
			stage => [stage.operation, stage.note, stage.runs.map(e => e.open)],
		);
	};
	expect(stagesOf([run('lint', 1, { operation: 'lint', state: 'succeeded' })])).toEqual([
		['lint', 'succeeded', [false]],
		['promote', 'not run', []],
		['release', 'not run', []],
		['crates', 'not run', []],
	]);
	expect(stagesOf([run('observed', 1, { operation: 'release', state: 'cancelled' })])).toEqual([
		['release', 'cancelled', [true]],
		['crates', 'not run', []],
	]);
});

test('two releases of one repository with different tags both stay in the publication table', async () => {
	const { finished } = await finishedPromotion('pending');
	const [npm] = finished.publications;
	if (!npm) throw new Error('No publication');
	const { identity: _identity, ...bare } = npm;
	const notes = (version: string) => ({
		...bare,
		identity: { type: 'github', namespace: 'octo', name: 'widget', version },
		id: 'pkg:github/octo/widget',
		manager: 'github-release' as const,
		name: 'octo/widget',
		version,
		required: false,
		outcome: 'succeeded' as const,
	});
	const [release] = releaseSummaries([{ ...finished, publications: [notes('cli-v1.1.0'), notes('sdk-v1.1.0')] }]);
	if (!release) throw new Error('No release');
	expect(pipeline(release, Date.now())?.publications.filter(p => !p.required).map(p => p.version)).toEqual([
		'cli-v1.1.0',
		'sdk-v1.1.0',
	]);
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
	expect(readable.filter(entry => needingUser(readable).has(entry.id)).map(entry => entry.id)).toEqual([
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
	expect(runs.map(entry => [entry.id, needingUser(runs).has(entry.id), runStateLabel(entry)])).toEqual([
		['waiting', true, 'waiting for you to publish'],
		['started', false, 'publishing once its checks pass'],
		['pushed', false, 'publishing once its checks pass'],
	]);
	const [release] = releaseSummaries([started]);
	if (!release) throw new Error('No release');
	expect(releaseStatus(release).label).toBe('Publishing once its checks pass');
	expect(runCard(started, Date.now()).automatic).toBe(true);
});

test('a newer active run decides the release badge over earlier verified publications', async () => {
	const { finished } = await finishedPromotion('pending');
	const published = finished.publications.map(publication => ({ ...publication, outcome: 'succeeded' as const }));
	const done = { ...finished, id: 'done', state: 'succeeded' as const, publications: published, createdAt: 1 };
	const rerun = { ...finished, id: 'rerun', state: 'running' as const, publications: [], createdAt: 2 };
	const [release] = releaseSummaries([done, rerun]);
	if (!release) throw new Error('No release');
	expect([release.latest.id, release.verified, releaseStatus(release).label]).toEqual(['rerun', 1, 'In progress']);
});

test('runs created in the same millisecond have one order whatever the input order', async () => {
	const { finished } = await finishedPromotion('pending');
	const failed = { ...finished, id: 'a-failed', state: 'failed' as const, createdAt: 5 };
	const retried = { ...finished, id: 'b-running', state: 'running' as const, createdAt: 5 };
	for (const input of [[failed, retried], [retried, failed]]) {
		const [release] = releaseSummaries(input);
		expect([release?.latest.id, release?.runs.map(run => run.id), [...needingUser(input)]]).toEqual([
			'b-running',
			['a-failed', 'b-running'],
			[],
		]);
	}
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
	const workflow = {
		...decodeSync(mutableRecord(Schema.String, Schema.Unknown), stored['workflow']),
		publications: ['pkg:npm/other'],
	};
	expect(decodeExecutionV1({ ...stored, state: 'blocked', workflow }).state).toBe('blocked');
});

test('the state filter matches the state a stored blocked run decodes to and keeps the limit correct', async () => {
	const { stored, finished } = await finishedPromotion('pending');
	const workflow = {
		...decodeSync(mutableRecord(Schema.String, Schema.Unknown), stored['workflow']),
		publications: ['pkg:npm/other'],
	};
	const { approvedAt: _approvedAt, ...unapproved } = stored;
	const legacy = [
		{ id: finished.id, document: { ...stored, state: 'blocked' }, updatedAt: 3_000 },
		{
			id: 'legacy-approval',
			document: { ...unapproved, id: 'legacy-approval', operation: 'promote', attempts: 0, state: 'blocked' },
			updatedAt: 2_000,
		},
		{
			id: 'legacy-blocked',
			document: { ...stored, id: 'legacy-blocked', state: 'blocked', workflow },
			updatedAt: 1_000,
		},
	];
	for (const row of legacy) {
		await world.db.prepare(
			'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?) '
				+ 'ON CONFLICT(id) DO UPDATE SET state_version=NULL, state=excluded.state, document=excluded.document, updated_at=excluded.updated_at',
		).bind(row.id, finished.repositoryId, 'blocked', JSON.stringify(row.document), row.updatedAt).run();
	}
	const store = new Store(world.db);
	const found = async (states: string, limit?: number) =>
		(await Effect.runPromise(store.filteredExecutions({ states, ...(limit === undefined ? {} : { limit }) })))
			.map(execution => [execution.id, execution.state]);
	expect(await found('verifying')).toEqual([[finished.id, 'verifying']]);
	expect(await found('awaiting-approval')).toEqual([['legacy-approval', 'awaiting-approval']]);
	expect(await found('blocked')).toEqual([['legacy-blocked', 'blocked']]);
	expect(await found('blocked', 1)).toEqual([['legacy-blocked', 'blocked']]);
	expect(await found('verifying,awaiting-approval', 1)).toEqual([[finished.id, 'verifying']]);
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
	expect(logged.events()).toEqual([expect.objectContaining({
		event: 'preparation-merge.failed',
		repository: 'octo/widget',
		repositoryId: repository.id,
		pull: `https://github.com/octo/widget/pull/${pull.number}`,
		error:
			`GitHub HTTP 403 on GET /repos/octo/widget/compare/${merged.sha}...${merged.sha}: Resource not accessible by integration`,
	})]);
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

test('a companion module tag is pushed on the release commit beside the version tag', async () => {
	const { plan, tags } = await packedRelease(world, undefined, undefined, false, 'github.com/octo/widget/go');
	const promotion = await only(bearer(world, await world.cliSession()), 'promote');
	expect(promotion.state).toBe('succeeded');
	expect(plan.changes.map(change => change.name)).toEqual(['v1.1.0', 'go/v1.1.0']);
	expect(new Set(plan.changes.map(change => change.commit)).size).toBe(1);
	expect(Object.keys(tags)).toEqual(['v1.1.0', 'go/v1.1.0']);
	expect(tags['go/v1.1.0']).toContain('tag go/v1.1.0');
}, 30_000);

async function removeCompanionModule(): Promise<void> {
	const target = world.github.repository('octo/widget');
	const configuration = decodeSync(
		looseStruct({ streams: looseStruct({ main: looseStruct({}) }) }),
		JSON.parse(world.github.file(target, '.github/beepboop.json') ?? '{}'),
	);
	delete configuration.streams.main.companionModules;
	world.github.push(
		target,
		{ '.github/beepboop.json': jsonFile(configuration, '\t'), 'go/go.mod': null },
		'Remove the Go module',
	);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	const stored = await Effect.runPromise(new Store(world.db).repository(target.id));
	expect(stored?.inventory.packages.map(pkg => pkg.manager)).toEqual(['npm']);
}

test(
	'a companion module removed by a later discovery is still tagged by the release that started with it',
	async () => {
		const { plan, tags } = await packedRelease(
			world,
			removeCompanionModule,
			undefined,
			false,
			'github.com/octo/widget/go',
		);
		expect(plan.changes.map(change => change.name)).toEqual(['v1.1.0', 'go/v1.1.0']);
		expect(Object.keys(tags)).toEqual(['v1.1.0', 'go/v1.1.0']);
	},
	30_000,
);

test('a release stored without its companion modules reads them from discovery', async () => {
	const { plan } = await packedRelease(
		world,
		async promotionId => {
			const target = world.github.repository('octo/widget');
			const storage = world.coordinators.instance(String(target.id)).storage;
			const key = `execution:${promotionId}`;
			const stored = decodeSync(looseStruct({ moduleTags: Schema.Unknown }), await storage.get(key));
			expect(stored.moduleTags).toEqual([{ id: 'pkg:golang/github.com/octo/widget/go', prefix: 'go/v' }]);
			delete stored.moduleTags;
			await storage.put(key, stored);
		},
		undefined,
		false,
		'github.com/octo/widget/go',
	);
	expect(plan.changes.map(change => change.name)).toEqual(['v1.1.0', 'go/v1.1.0']);
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
			const stored = decodeSync(looseStruct({ draftRelease: Schema.Unknown }), await storage.get(key));
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

test('completion evidence survives execution pagination and later auxiliary work cannot move its timestamp', async () => {
	const { finished, repository } = await finishedPromotion('pending');
	const store = new Store(world.db), coordinator = world.coordinator(repository);
	const required = ['pkg:npm/widget', 'pkg:npm/other'];
	const configuration = {
		...finished.configuration,
		streams: { ...finished.configuration.streams, main: { ...finished.configuration.streams.main!, required } },
	};
	const successful = (id: string, name: string): Execution => ({
		...finished,
		id,
		configuration,
		state: 'succeeded' as const,
		publications: [{
			id: `pkg:npm/${name}`,
			manager: 'npm',
			name,
			version: '1.1.0',
			outcome: 'succeeded' as const,
			required: true,
		}],
	});
	const candidate = { ...finished, state: 'failed' as const, version: '0.0.0', updatedAt: 0 };
	await coordinator.enqueue(successful('part-one', 'widget'));
	expect(await Effect.runPromise(store.completionEvidence([candidate]))).toEqual([]);
	await coordinator.enqueue(successful('part-two', 'other'));
	const [completion] = await Effect.runPromise(store.completionEvidence([candidate]));
	if (!completion) throw new Error('No completion record');
	const failure = {
		...finished,
		id: 'attention',
		state: 'failed' as const,
		version: '1.0.0',
		createdAt: completion.completedAt - 1,
		updatedAt: completion.completedAt - 1,
	};
	world.db.reset();
	expect(await Effect.runPromise(store.completionEvidence([finished]))).toEqual([]);
	expect(world.db.queries).toHaveLength(0);
	expect(await Effect.runPromise(store.completionEvidence([failure]))).toEqual([completion]);
	for (const candidate of [
		{ ...failure, repositoryId: failure.repositoryId + 1 },
		{ ...failure, stream: 'other-stream' },
		{ ...failure, updatedAt: completion.completedAt + 1 },
	]) {
		expect(await Effect.runPromise(store.completionEvidence([candidate]))).toEqual([]);
	}
	await world.db.prepare('DELETE FROM executions').run();
	const insert = world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)',
	);
	await world.db.batch(Array.from({ length: 240 }, (_, i) => {
		const run = { ...finished, id: `page-${i}`, state: 'succeeded', createdAt: completion.completedAt - i - 10 };
		return insert.bind(run.id, run.repositoryId, run.state, JSON.stringify(run), run.updatedAt);
	}));
	await insert.bind(failure.id, failure.repositoryId, failure.state, JSON.stringify(failure), failure.updatedAt).run();
	await Effect.runPromise(new ProjectionBackfill(world.db).drain());
	const load = (name?: string) =>
		world.run(loaders.runs({ env: world.env, actor: 'admin', ...(name ? { repository: name } : {}) }));
	for (const data of [await load(), await load(repository.name)]) {
		expect(data.executions.readable).toHaveLength(200);
		expect(data.executions.readable.some(run => run.id === 'part-one' || run.id === 'part-two')).toBe(false);
		expect(needingUser(data.executions.readable, data.completed).has(failure.id)).toBe(false);
	}
	await world.wait(1000);
	await coordinator.enqueue({ ...successful('auxiliary', 'widget'), operation: 'extra' });
	await coordinator.reindex(repository.id);
	expect(await Effect.runPromise(store.completionEvidence([candidate]))).toEqual([completion]);
	const laterFailure = { ...failure, updatedAt: completion.completedAt + 1 };
	expect(
		needingUser(
			[laterFailure, ...(await load()).executions.readable],
			await Effect.runPromise(store.completionEvidence([candidate])),
		).has(failure.id),
	).toBe(true);
});

test('many legacy blocked run IDs are normalized once without hiding an older verifying execution', async () => {
	const { stored, finished } = await finishedPromotion('pending');
	await world.db.prepare('DELETE FROM executions').run();
	const insert = world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)',
	);
	const stuckWorkflow = {
		...decodeSync(mutableRecord(Schema.String, Schema.Unknown), stored['workflow']),
		publications: ['pkg:npm/missing'],
	};
	await world.db.batch(
		Array.from(
			{ length: 1200 },
			(_, i) =>
				insert.bind(
					`stuck-${i}`,
					finished.repositoryId,
					'blocked',
					JSON.stringify({
						...stored,
						id: `stuck-${i}`,
						state: 'blocked',
						workflow: stuckWorkflow,
						createdAt: 100 + i,
					}),
					100 + i,
				),
		),
	);
	await insert.bind(
		'old-verifying',
		finished.repositoryId,
		'blocked',
		JSON.stringify({ ...stored, id: 'old-verifying', state: 'blocked', createdAt: 1 }),
		1,
	).run();
	await Effect.runPromise(new ProjectionBackfill(world.db).drain());
	const store = new Store(world.db);
	world.db.reset();
	expect((await Effect.runPromise(store.executions()))[0]?.id).toBe('old-verifying');
	expect(world.db.queries.length).toBeLessThan(30);
	world.db.reset();
	const runs = await Effect.runPromise(store.executions());
	expect(runs).toHaveLength(200);
	expect(runs[0]?.state).toBe('verifying');
	const reads = world.db.queries.filter(query => query.sql.includes('FROM executions'));
	expect(reads).toHaveLength(3);
	expect(reads.reduce((total, query) => total + world.db.sqlite.prepare(query.sql).all(...query.values).length, 0))
		.toBe(200);
	expect(world.db.queries.some(query => query.sql.startsWith('UPDATE executions'))).toBe(false);
	const pending = reads.find(query => query.sql.includes('state_version IS NULL'))!;
	expect(JSON.stringify(world.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${pending.sql}`).all(...pending.values))).toContain(
		'executions_state_pending',
	);
});

test('the parent publishes a companion tag and the module stream reuses it only at the same commit', async () => {
	const { repository, promotionId } = await packedRelease(
		world,
		undefined,
		undefined,
		false,
		'github.com/octo/widget/go',
		true,
	);
	const coordinator = world.coordinator(repository), store = new Store(world.db);
	const parent = await coordinator.execution(promotionId);
	if (!parent) throw new Error('Missing parent');
	expect(parent.state).toBe('succeeded');
	const original = repository.refs.get('tags/go/v1.1.0');
	expect(original).toBeDefined();
	const record = await Effect.runPromise(store.repository(repository.id));
	if (!record) throw new Error('Missing repository');
	const ready = await world.run(requireReady(record));
	const identity = {
		repositoryId: repository.id,
		repository: repository.name,
		ownerId: Number(world.env.OWNER_ID),
		actorId: Number(world.env.OWNER_ID),
		runId: parent.runId!,
		attempt: parent.runAttempt!,
		sha: parent.sourceSha,
		workflowSha: parent.workflowSha!,
		workflowRef: `${repository.name}/.github/workflows/publish.yml@refs/heads/main`,
		ref: 'refs/heads/main',
		event: 'workflow_dispatch',
	};
	const create = async (sourceSha: string) => {
		const execution = await world.run(
			createExecution(ready, {
				stream: 'sdk',
				operation: 'promote',
				eventId: `sdk:${sourceSha}`,
				sourceSha,
				version: '1.1.0',
			}),
		);
		await coordinator.enqueue({
			...execution,
			state: 'running',
			runId: identity.runId,
			runAttempt: identity.attempt,
			workflowSha: identity.workflowSha,
		});
		return execution;
	};
	const same = await create(parent.sourceSha);
	const plan = await coordinator.refs(same.id, identity);
	expect(plan.changes).toHaveLength(1);
	expect(plan.changes[0]).toMatchObject({ name: 'go/v1.1.0', expected: original, commit: parent.sourceSha });
	await coordinator.refs(same.id, identity, true);
	const newer = world.github.push(repository, { 'go/new.go': 'package sdk\n' }, 'Advance module');
	const next = await create(newer.sha);
	await expect(coordinator.refs(next.id, identity)).rejects.toThrow('Version tag go/v1.1.0 already targets');
	expect(repository.refs.get('tags/go/v1.1.0')).toBe(original);
	expect((await coordinator.execution(next.id))?.refPlan).toBeUndefined();
}, 30000);

test('repository filters render only their own readable and unreadable runs even outside the global page', async () => {
	const { finished, repository } = await finishedPromotion('pending');
	const store = new Store(world.db);
	const original = await Effect.runPromise(store.repository(repository.id));
	if (!original) throw new Error('Missing repository');
	for (const [id, name] of [[99, 'octo/gadget'], [100, 'octo/broken']] as const) {
		await Effect.runPromise(store.saveDiscovery({ ...original, id, name }));
	}
	await world.db.prepare('DELETE FROM executions').run();
	const insert = world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)',
	);
	await world.db.batch(Array.from({ length: 210 }, (_, i) => {
		const run = { ...finished, id: `widget-${i}`, state: 'running', createdAt: 1000 + i };
		return insert.bind(run.id, repository.id, run.state, JSON.stringify(run), run.updatedAt);
	}));
	const gadget = {
		...finished,
		id: 'gadget-only',
		repositoryId: 99,
		repository: 'octo/gadget',
		state: 'failed',
		createdAt: 1,
	};
	await insert.bind(gadget.id, 99, gadget.state, JSON.stringify(gadget), 1).run();
	await insert.bind('broken-only', 100, 'failed', '{bad', 1).run();
	await Effect.runPromise(new ProjectionBackfill(world.db).drain());
	const load = (name?: string) =>
		world.run(loaders.runs({ env: world.env, actor: 'admin', ...(name ? { repository: name } : {}) }));
	const all = await load();
	expect(all.executions.readable).toHaveLength(200);
	expect(all.repositories).toEqual(['octo/broken', 'octo/gadget', 'octo/widget']);
	const component =
		decodeSync(componentModule, await import(join(import.meta.dir, '../../src/components/Runs.astro'))).default;
	const container = await experimental_AstroContainer.create();
	for (const [name, ids, broken] of [['octo/widget', 210, 0], ['octo/gadget', 1, 0], ['octo/broken', 0, 1]] as const) {
		const data = await load(name);
		expect(data.executions.readable).toHaveLength(Math.min(ids, 200));
		expect(data.executions.unreadable).toHaveLength(broken);
		expect(data.executions.readable.every(run => run.repository === name)).toBe(true);
		const html = await container.renderToString(component, {
			props: { data },
			request: new Request(`${origin}/runs?repository=${name}`),
		});
		const page = new Window();
		page.document.body.innerHTML = html;
		expect(
			[...page.document.querySelectorAll('.run-card .eyebrow')].every(element =>
				element.textContent.includes(name) || (name === 'octo/broken' && element.textContent === 'Repository 100')
			),
		).toBe(true);
		expect(page.document.querySelector('[data-runs-latest]')?.getAttribute('data-runs-repository')).toBe(name);
		expect(page.document.querySelectorAll('.run-card pre')).toHaveLength(broken);
		await page.happyDOM.close();
	}
});

test('legacy normalization bounds UTF-8 batch parameters and preserves concurrent document updates', async () => {
	const { finished } = await finishedPromotion('pending');
	await world.db.prepare('DELETE FROM executions').run();
	const insert = world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)',
	);
	for (const [id, length] of [['small-a', 300_000], ['small-b', 300_000], ['large', 700_000]] as const) {
		await insert.bind(id, finished.repositoryId, 'failed', JSON.stringify({ padding: 'λ'.repeat(length) }), 1).run();
	}
	const execute = world.db.execute.bind(world.db);
	let replaced = false;
	spyOn(world.db, 'execute').mockImplementation((query, values) => {
		if (query.startsWith('UPDATE executions')) {
			for (const value of values) {
				if (typeof value === 'string') expect(new TextEncoder().encode(value).byteLength).toBeLessThan(2_000_000);
			}
			if (!replaced) {
				replaced = true;
				execute("UPDATE executions SET state='cancelled',document='{}' WHERE id='small-a'", []);
			}
		}
		return execute(query, values);
	});
	await Effect.runPromise(new ProjectionBackfill(world.db).drain());
	const rows = await Effect.runPromise(new Store(world.db).readExecutions());
	expect(rows).toHaveLength(3);
	expect(rows.every(row => row.kind === 'unreadable')).toBe(true);
	expect(await world.db.prepare("SELECT state,state_version,document FROM executions WHERE id='small-a'").first())
		.toEqual({ state: 'cancelled', state_version: 1, document: '{}' });
	expect(await world.db.prepare('SELECT COUNT(*) AS pending FROM executions WHERE state_version IS NULL').first())
		.toEqual({ pending: 0 });
});
