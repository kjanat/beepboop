import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import type { Repository } from '@root/test/support/github.ts';
import { botId, filesAt, ownerId } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { npmManifest, passChecks, publishWorkflow } from '@root/test/support/repositories.ts';
import type { SigningKey } from '@root/test/support/signing.ts';
import { fakeSigner, signingKey } from '@root/test/support/signing.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import { createExecution, expectedRunTitle } from '@/automation/execution';
import type { RefPlan } from '@/automation/refs';
import { Store } from '@/automation/store';
import type { Edit } from '@/automation/types';
import { requireReady } from '@/domain/repository';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';

let world: World, key: SigningKey | undefined;
eachWorld(created => {
	world = created;
});
afterEach(() => {
	key?.dispose();
	key = undefined;
});

const files: Edit[] = [
	{ path: 'dist/main.mjs', before: '', after: 'export const installed = true;\n' },
	{ path: 'dist/post.mjs', before: '', after: 'export const cached = true;\n' },
];

async function fixture(
	options: {
		enabled?: boolean;
		immutable?: boolean;
		cancelled?: boolean;
		foreignRun?: boolean;
		moveTagOnReleaseRead?: boolean;
	} = {},
) {
	key = signingKey('Release Maintainer <release@example.com>');
	const signer = fakeSigner(key);
	world.env.SIGNER = signer;
	const configuration = {
		managers: ['npm', 'workflow', 'github-release'],
		streams: {
			main: {
				packages: ['pkg:npm/widget'],
				required: ['github-release:octo/widget'],
				promote: {
					approval: 'required',
					workflow: {
						file: 'publish.yml',
						publications: ['github-release:octo/widget'],
						refs: {
							phase: 'version',
							signed: true,
							immutable: true,
							distribution: { files: files.map(file => file.path), ancestry: 'ours' },
						},
					},
				},
				workflows: {
					aliases: { file: 'aliases.yml', needs: ['promote'], refs: { phase: 'aliases', aliases: ['major', 'minor'] } },
				},
			},
		},
	};
	const settings = { enabled: options.enabled ?? true, immutable: options.immutable ?? true };
	const repository = world.github.create('octo/widget', {
		'package.json': npmManifest('widget', '1.2.3'),
		'README.md': '# widget\n',
		LICENSE: 'MIT License\n',
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/publish.yml': publishWorkflow,
		'.github/workflows/aliases.yml': publishWorkflow,
	});
	const source = world.github.head(repository);
	passChecks(repository, source);
	world.network.serve('api.github.com', async request => {
		const url = new URL(request.url);
		if (url.pathname.endsWith('/immutable-releases')) return Response.json({ enabled: settings.enabled });
		const response = await world.github.handle(request);
		if (options.foreignRun && url.pathname.endsWith('/actions/runs/123') && response.ok) {
			const value: unknown = await response.json();
			if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected workflow run');
			return Response.json({ ...value, repository: { id: repository.id + 1 } }, { status: response.status });
		}
		if (url.pathname.includes('/releases') && response.ok && response.headers.get('content-type')?.includes('json')) {
			const value: unknown = await response.json();
			if (options.moveTagOnReleaseRead && url.pathname.endsWith('/releases/tags/v1.2.3')) {
				repository.refs.set('tags/v1.2.3', source);
			}
			return typeof value === 'object' && value !== null && !Array.isArray(value) && 'tag_name' in value
				? Response.json({ ...value, immutable: settings.immutable }, { status: response.status })
				: Response.json(value, { status: response.status });
		}
		return response;
	});
	const api = bearer(world, await world.cliSession());
	const discovered = await api('/api/repositories/discover', { repository: repository.name });
	expect(discovered.status).toBe(200);
	const record = await Effect.runPromise(new Store(world.db).repository(repository.id));
	if (!record) throw new Error('Repository missing');
	const ready = await world.run(requireReady(record));
	const coordinator = world.coordinator(repository);
	const create = async (operation: 'promote' | 'aliases', dependencies: string[] = [], register = false) => {
		const execution = await world.run(
			createExecution(ready, {
				stream: 'main',
				operation,
				eventId: 'distribution',
				sourceSha: source,
				version: '1.2.3',
			}),
		);
		const workflowSha = world.github.head(repository);
		const identity: WorkflowIdentity = {
			repositoryId: repository.id,
			repository: repository.name,
			ownerId,
			actorId: ownerId,
			runId: operation === 'promote' ? 123 : 124,
			attempt: 1,
			sha: workflowSha,
			workflowSha,
			workflowRef: `${repository.name}/.github/workflows/${
				operation === 'promote' ? 'publish.yml' : 'aliases.yml'
			}@refs/heads/main`,
			ref: 'refs/heads/main',
			event: 'workflow_dispatch',
		};
		repository.runs.push({
			id: identity.runId,
			path: `.github/workflows/${operation === 'promote' ? 'publish.yml' : 'aliases.yml'}`,
			event: 'workflow_dispatch',
			headSha: workflowSha,
			headBranch: repository.defaultBranch,
			status: 'in_progress',
			conclusion: null,
			attempt: 1,
			title: expectedRunTitle(execution),
			inputs: { beepboop_execution_id: execution.id },
		});
		await coordinator.enqueue({
			...execution,
			dependencies,
			...(register
				? { state: 'dispatching' as const, attempts: 1 }
				: {
					state: options.cancelled ? 'cancelled' as const : 'running' as const,
					runId: identity.runId,
					runAttempt: identity.attempt,
					workflowSha,
					...(options.cancelled ? { reason: 'Cancelled by a stale client' } : {}),
				}),
		});
		return { execution, identity };
	};
	const promotion = await create('promote');
	return { repository, source, coordinator, signer, promotion, create, settings };
}

function land(repository: Repository, plan: RefPlan) {
	for (const change of plan.changes) {
		if (change.object === undefined) throw new Error('Expected a signed version tag');
		const hashed = spawnSync('git', ['hash-object', '-t', 'tag', '--stdin', '--literally'], {
			input: change.object,
			encoding: 'utf8',
		});
		if (hashed.status !== 0) throw new Error('Could not hash version tag');
		world.github.recordTag(repository, change.name, hashed.stdout.trim(), change.commit, true);
	}
	if (!plan.distribution) throw new Error('Expected distribution evidence');
	repository.refs.set(`heads/${repository.defaultBranch}`, plan.distribution.ancestryCommit);
}

async function nativePublication(options: Parameters<typeof fixture>[0] = {}) {
	const scenario = await fixture(options);
	const { repository, promotion, source } = scenario;
	const distribution = world.github.push(
		repository,
		Object.fromEntries(files.map(file => [file.path, file.after])),
		'Build distribution',
	);
	distribution.authorId = botId;
	const ancestry = world.github.push(
		repository,
		Object.fromEntries(files.map(file => [file.path, null])),
		'Record distribution ancestry',
	);
	ancestry.parents = [source, distribution.sha];
	repository.refs.set('tags/v1.2.3', distribution.sha);
	repository.releases.push({
		id: 999,
		tag: 'v1.2.3',
		target: repository.defaultBranch,
		draft: false,
		prerelease: false,
		authorId: botId,
		body: '',
	});
	const run = repository.runs.find(run => run.id === promotion.identity.runId);
	if (!run) throw new Error('Expected native publication run');
	run.status = 'completed';
	run.conclusion = 'success';
	return { ...scenario, distribution, ancestry, run };
}

test('a completed native workflow reconciles its signed distribution commit and lightweight patch ref', async () => {
	const { coordinator, promotion, repository, source, distribution, ancestry, run, signer } = await nativePublication();
	expect((await world.workflowRun(repository, run, 'success', 'workflow_dispatch')).status).toBe(202);
	await world.wait(2000);
	const completed = await coordinator.execution(promotion.execution.id);
	expect(completed?.state).toBe('succeeded');
	expect(completed?.sourceSha).toBe(source);
	expect(completed?.release?.commit).toBe(distribution.sha);
	expect(completed?.refPlan?.distribution?.ancestryCommit).toBe(ancestry.sha);
	expect(completed?.publications.map(publication => [publication.id, publication.outcome])).toEqual([
		['pkg:github/octo/widget', 'succeeded'],
		['refs:promote', 'succeeded'],
	]);
	expect(filesAt(repository, ancestry.sha)).toEqual(filesAt(repository, source));
	expect(signer.calls).toHaveLength(0);
});

test('native publication observation keeps the distribution target when the default branch advances', async () => {
	const { coordinator, promotion, repository, source, distribution, ancestry, run } = await nativePublication();
	const next = world.github.push(repository, { 'README.md': '# Next work\n' }, 'Continue development');
	expect((await world.workflowRun(repository, run, 'success', 'workflow_dispatch')).status).toBe(202);
	await world.wait(2000);
	const completed = await coordinator.execution(promotion.execution.id);
	expect(completed?.state).toBe('succeeded');
	expect(completed?.sourceSha).toBe(source);
	expect(completed?.release?.commit).toBe(distribution.sha);
	expect(completed?.refPlan?.distribution?.ancestryCommit).toBe(ancestry.sha);
	expect(world.github.head(repository)).toBe(next.sha);
});

test('native publication reconciliation refuses a patch tag moved while reading the immutable release', async () => {
	const { coordinator, promotion, repository, source, run } = await nativePublication({ moveTagOnReleaseRead: true });
	expect((await world.workflowRun(repository, run, 'success', 'workflow_dispatch')).status).toBe(202);
	await world.wait(2000);
	const reconciled = await coordinator.execution(promotion.execution.id);
	expect(repository.refs.get('tags/v1.2.3')).toBe(source);
	expect(reconciled?.state).not.toBe('succeeded');
	expect(reconciled?.release).toBeUndefined();
	expect(reconciled?.refPlan).toBeUndefined();
	expect(reconciled?.publications.some(publication => publication.outcome === 'succeeded')).toBe(false);
});

test('explicit reconciliation repairs a cancelled native publication without cancelling or retrying its workflow', async () => {
	const { coordinator, promotion, repository, source, distribution, ancestry, run } = await nativePublication({
		cancelled: true,
	});
	const mark = world.network.mark();
	const completed = await coordinator.recover(promotion.execution.id, 'reconcile', 'release-maintainer');
	expect(completed.state).toBe('succeeded');
	expect(completed.reason).toBeUndefined();
	expect(completed.release?.commit).toBe(distribution.sha);
	expect(completed.refPlan?.distribution?.ancestryCommit).toBe(ancestry.sha);
	expect(completed.sourceSha).toBe(source);
	expect(run.status).toBe('completed');
	expect(run.conclusion).toBe('success');
	expect(run.attempt).toBe(1);
	expect(repository.releases).toHaveLength(1);
	expect(
		world.network.since(mark).filter(exchange =>
			exchange.method === 'POST' && /\/(cancel|rerun|rerun-failed-jobs)$/.test(new URL(exchange.url).pathname)
		),
	).toEqual([]);
});

for (const problem of [
	'unsigned distribution',
	'different author',
	'extra file',
	'wrong parent',
	'missing ancestry',
	'changed ancestry tree',
	'wrong run attempt',
	'different workflow source',
	'foreign run',
]) {
	test(`native publication reconciliation rejects ${problem}`, async () => {
		const { coordinator, promotion, repository, source, distribution, ancestry, run } = await nativePublication({
			foreignRun: problem === 'foreign run',
		});
		if (problem === 'unsigned distribution') distribution.verified = false;
		if (problem === 'different author') distribution.authorId = ownerId;
		if (problem === 'extra file') {
			const tree = repository.trees.get(distribution.tree);
			if (!tree) throw new Error('Distribution tree missing');
			tree.set('unexpected.txt', { mode: '100644', type: 'blob', sha: 'f'.repeat(40) });
		}
		if (problem === 'wrong parent') distribution.parents = [];
		if (problem === 'missing ancestry') repository.refs.set(`heads/${repository.defaultBranch}`, source);
		if (problem === 'changed ancestry tree') ancestry.tree = distribution.tree;
		if (problem === 'wrong run attempt') run.attempt++;
		if (problem === 'different workflow source') run.headSha = 'e'.repeat(40);
		expect((await world.workflowRun(repository, run, 'success', 'workflow_dispatch')).status).toBe(202);
		await world.wait(2000);
		const reconciled = await coordinator.execution(promotion.execution.id);
		expect(reconciled?.state).not.toBe('succeeded');
		expect(reconciled?.release).toBeUndefined();
		expect(reconciled?.refPlan).toBeUndefined();
	});
}

test('distribution authorization freezes a signed target while retaining source identity and source-only master', async () => {
	const scenario = await fixture();
	const { coordinator, promotion, repository, source, signer } = scenario;
	const token = await world.runToken({ repository, runId: promotion.identity.runId, sha: source, file: 'publish.yml' });
	const response = await world.handle(
		new Request('https://beepboop.kjanat.dev/api/workflow/refs-plan', {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ executionId: promotion.execution.id, files }),
		}),
	);
	expect(response.status).toBe(200);
	const plan = (await coordinator.execution(promotion.execution.id))?.refPlan;
	if (!plan) throw new Error('Expected frozen ref plan');
	expect(await response.json()).toEqual(plan);
	if (!plan.distribution) throw new Error('Expected distribution evidence');
	expect(plan.changes.map(change => change.commit)).toEqual([plan.distribution.commit]);
	expect(plan.changes[0]?.signed).toBe(true);
	expect(signer.calls).toHaveLength(3);
	expect(world.github.head(repository)).toBe(source);
	expect(filesAt(repository, plan.distribution.commit)['dist/main.mjs']).toBe(files[0]?.after);
	expect(filesAt(repository, plan.distribution.ancestryCommit)).toEqual(filesAt(repository, source));
	const saved = await coordinator.execution(promotion.execution.id);
	expect(saved?.sourceSha).toBe(source);
	expect(saved?.refPlan).toEqual(plan);
	if (!saved) throw new Error('Missing saved execution');
	expect(decodeExecutionV1(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});

test('distribution planning rejects files outside the authorized exact paths before signing', async () => {
	const { coordinator, promotion, signer } = await fixture();
	await expect(coordinator.refs(promotion.execution.id, promotion.identity, false, [
		...files,
		{ path: 'README.md', before: '# widget\n', after: '# changed\n' },
	])).rejects.toThrow('Distribution files must match');
	expect(signer.calls).toHaveLength(0);
	expect((await coordinator.execution(promotion.execution.id))?.refPlan).toBeUndefined();
});

test('distribution authorization refuses disabled immutable releases before signing', async () => {
	const { coordinator, promotion, signer } = await fixture({ enabled: false });
	await expect(coordinator.refs(promotion.execution.id, promotion.identity, false, files)).rejects.toThrow(
		'Enable immutable GitHub releases',
	);
	expect(signer.calls).toHaveLength(0);
});

test('distribution retries preserve the original plan and reject changed bytes or source text', async () => {
	const { coordinator, promotion, signer } = await fixture();
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
	expect(await coordinator.refs(promotion.execution.id, promotion.identity, false, files)).toEqual(plan);
	expect(signer.calls).toHaveLength(3);
	for (const changed of [
		files.map(file => ({ ...file, after: `${file.after}// changed\n` })),
		files.map(file => ({ ...file, before: 'different reviewed source' })),
		files.map(file => ({ ...file, mode: '100755' as const })),
		files.slice(1),
	]) {
		await expect(coordinator.refs(promotion.execution.id, promotion.identity, false, changed)).rejects.toThrow(
			'Distribution files differ from the frozen plan',
		);
	}
	expect((await coordinator.execution(promotion.execution.id))?.refPlan).toEqual(plan);
	expect(signer.calls).toHaveLength(3);
});

test('distribution retries cannot omit a frozen executable mode', async () => {
	const { coordinator, promotion } = await fixture();
	const executable = files.map(file => ({ ...file, mode: '100755' as const }));
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, executable);
	expect(await coordinator.refs(promotion.execution.id, promotion.identity, false, executable)).toEqual(plan);
	await expect(coordinator.refs(promotion.execution.id, promotion.identity, false, files)).rejects.toThrow(
		'Distribution files differ from the frozen plan',
	);
});

test('distribution completion requires the exact signed patch tag and landed ancestry', async () => {
	const { coordinator, promotion, repository, source } = await fixture();
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
	if (!plan.distribution) throw new Error('Expected distribution');
	await expect(coordinator.refs(promotion.execution.id, promotion.identity, true)).rejects.toThrow(
		'Distribution tag object',
	);
	land(repository, plan);
	repository.refs.set('heads/main', source);
	await expect(coordinator.refs(promotion.execution.id, promotion.identity, true)).rejects.toThrow(
		'Distribution ancestry did not land',
	);
	repository.refs.set('heads/main', plan.distribution.ancestryCommit);
	expect(await coordinator.refs(promotion.execution.id, promotion.identity, true)).toEqual(plan);
	expect(
		(await coordinator.execution(promotion.execution.id))?.publications.find(publication =>
			publication.id === 'refs:promote'
		),
	).toMatchObject({
		id: 'refs:promote',
		manager: 'workflow',
		name: repository.name,
		version: '1.2.3',
		outcome: 'succeeded',
		required: true,
	});
});

test('immutable publication accepts only the frozen distribution commit and records its source separately', async () => {
	const { coordinator, promotion, repository, source } = await fixture();
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
	if (!plan.distribution) throw new Error('Expected distribution');
	land(repository, plan);
	await coordinator.refs(promotion.execution.id, promotion.identity, true);
	world.github.recordTag(repository, 'v1.2.3', 'd'.repeat(40), source, true);
	await expect(coordinator.publishRelease(promotion.execution.id, promotion.identity)).rejects.toThrow(
		'Distribution tag object differs from the signed plan',
	);
	land(repository, plan);
	const published = await coordinator.publishRelease(promotion.execution.id, promotion.identity);
	expect(published.sourceSha).toBe(source);
	expect(published.release?.commit).toBe(plan.distribution.commit);
	expect(repository.releases.at(-1)?.target).toBe(plan.distribution.commit);
});

test('an immutable release policy refuses a GitHub release whose immutable flag is false', async () => {
	const { coordinator, promotion, repository } = await fixture({ immutable: false });
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
	land(repository, plan);
	await coordinator.refs(promotion.execution.id, promotion.identity, true);
	await expect(coordinator.publishRelease(promotion.execution.id, promotion.identity)).rejects.toThrow(
		'Published GitHub release is not immutable',
	);
	expect((await coordinator.execution(promotion.execution.id))?.release).toBeUndefined();
});

test('aliases inherit the completed promotion distribution without changing source identity', async () => {
	const { coordinator, promotion, repository, source, create } = await fixture();
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
	if (!plan.distribution) throw new Error('Expected distribution');
	land(repository, plan);
	await coordinator.refs(promotion.execution.id, promotion.identity, true);
	await coordinator.publishRelease(promotion.execution.id, promotion.identity);
	const run = repository.runs.find(run => run.id === promotion.identity.runId);
	if (!run) throw new Error('Expected promotion run');
	run.status = 'completed';
	run.conclusion = 'success';
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(2000);
	expect((await coordinator.execution(promotion.execution.id))?.state).toBe('succeeded');
	const aliases = await create('aliases', [promotion.execution.id], true);
	const token = await world.runToken({
		repository,
		runId: aliases.identity.runId,
		sha: aliases.identity.sha,
		file: 'aliases.yml',
	});
	const began = await world.handle(new Request('https://beepboop.kjanat.dev/api/workflow/begin', {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ executionId: aliases.execution.id, stream: 'main', operation: 'aliases' }),
	}));
	expect(began.status).toBe(200);
	expect((await coordinator.execution(aliases.execution.id))?.workflowSha).toBe(plan.distribution.ancestryCommit);
	const aliasPlan = await coordinator.refs(aliases.execution.id, aliases.identity);
	expect(aliasPlan.changes.map(change => [change.name, change.commit])).toEqual([
		['v1', plan.distribution.commit],
		['v1.2', plan.distribution.commit],
	]);
	expect((await coordinator.execution(aliases.execution.id))?.sourceSha).toBe(source);
});

test('distribution publication requires confirmed refs even when the signed patch tag exists', async () => {
	const { coordinator, promotion, repository } = await fixture();
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
	land(repository, plan);
	await expect(coordinator.publishRelease(promotion.execution.id, promotion.identity)).rejects.toThrow(
		'Confirm distribution refs and ancestry before publishing the release',
	);
	expect(repository.releases).toEqual([]);
});

test('distribution publication requires an authorized plan even when a source version tag exists', async () => {
	const { coordinator, promotion, repository, source } = await fixture();
	world.github.recordTag(repository, 'v1.2.3', 'd'.repeat(40), source, true);
	await expect(coordinator.publishRelease(promotion.execution.id, promotion.identity)).rejects.toThrow(
		'Confirm distribution refs and ancestry before publishing the release',
	);
	expect(repository.releases).toEqual([]);
});

test('reconciliation refuses a source release when distribution publication has no authorized plan', async () => {
	const { coordinator, promotion, repository, source } = await fixture();
	world.github.recordTag(repository, 'v1.2.3', 'd'.repeat(40), source, true);
	repository.releases.push({
		id: 999,
		tag: 'v1.2.3',
		target: source,
		draft: false,
		prerelease: false,
		authorId: ownerId,
		body: '',
	});
	const run = repository.runs.find(run => run.id === promotion.identity.runId);
	if (!run) throw new Error('Expected promotion run');
	run.status = 'completed';
	run.conclusion = 'failure';
	await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
	await world.wait(2000);
	const reconciled = await coordinator.execution(promotion.execution.id);
	expect(reconciled?.state).toBe('failed');
	expect(reconciled?.release).toBeUndefined();
	expect(reconciled?.refPlan).toBeUndefined();
});

for (const problem of ['missing ancestry', 'different signed tag object']) {
	test(`publication rechecks confirmed distribution refs after ${problem}`, async () => {
		const { coordinator, promotion, repository, source } = await fixture();
		const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
		if (!plan.distribution) throw new Error('Expected distribution');
		land(repository, plan);
		await coordinator.refs(promotion.execution.id, promotion.identity, true);
		if (problem === 'missing ancestry') repository.refs.set('heads/main', source);
		else world.github.recordTag(repository, 'v1.2.3', 'd'.repeat(40), plan.distribution.commit, true);
		await expect(coordinator.publishRelease(promotion.execution.id, promotion.identity)).rejects.toThrow(
			problem === 'missing ancestry'
				? 'Distribution ancestry did not land'
				: 'Distribution tag object differs from the signed plan',
		);
		expect(repository.releases).toEqual([]);
	});
}

test('reconciliation after an ambiguous release response keeps the frozen target when master advances', async () => {
	const { coordinator, promotion, repository, source, settings, signer } = await fixture({ immutable: false });
	const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
	if (!plan.distribution) throw new Error('Expected distribution');
	land(repository, plan);
	await coordinator.refs(promotion.execution.id, promotion.identity, true);
	await expect(coordinator.publishRelease(promotion.execution.id, promotion.identity)).rejects.toThrow(
		'Published GitHub release is not immutable',
	);
	expect(repository.releases).toHaveLength(1);
	settings.immutable = true;
	const newer = world.github.push(repository, { 'README.md': '# next work\n' }, 'Continue development');
	const run = repository.runs.find(run => run.id === promotion.identity.runId);
	if (!run) throw new Error('Expected promotion run');
	run.status = 'completed';
	run.conclusion = 'failure';
	await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
	await world.wait(2000);
	const reconciled = await coordinator.execution(promotion.execution.id);
	expect(reconciled?.state).toBe('succeeded');
	expect(reconciled?.sourceSha).toBe(source);
	expect(reconciled?.refPlan).toEqual(plan);
	expect(reconciled?.release?.commit).toBe(plan.distribution.commit);
	expect(world.github.head(repository)).toBe(newer.sha);
	expect(repository.releases).toHaveLength(1);
	expect(signer.calls).toHaveLength(3);
});

for (const problem of ['missing ancestry', 'different signed tag object']) {
	test(`reconciliation refuses a distribution release with ${problem}`, async () => {
		const { coordinator, promotion, repository, source } = await fixture();
		const plan = await coordinator.refs(promotion.execution.id, promotion.identity, false, files);
		if (!plan.distribution) throw new Error('Expected distribution');
		land(repository, plan);
		if (problem === 'missing ancestry') repository.refs.set('heads/main', source);
		else world.github.recordTag(repository, 'v1.2.3', 'd'.repeat(40), plan.distribution.commit, true);
		repository.releases.push({
			id: 999,
			tag: 'v1.2.3',
			target: plan.distribution.commit,
			draft: false,
			prerelease: false,
			authorId: ownerId,
			body: '',
		});
		const run = repository.runs.find(run => run.id === promotion.identity.runId);
		if (!run) throw new Error('Expected promotion run');
		run.status = 'completed';
		run.conclusion = 'failure';
		await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
		await world.wait(2000);
		const reconciled = await coordinator.execution(promotion.execution.id);
		expect(reconciled?.state).toBe('failed');
		expect(reconciled?.release).toBeUndefined();
		expect(
			reconciled?.publications.some(publication =>
				publication.id === 'refs:promote' && publication.outcome === 'succeeded'
			),
		).toBe(false);
		expect(reconciled?.refPlan).toEqual(plan);
	});
}
