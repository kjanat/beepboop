import { expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';
import { edgeFetch } from '@root/test/edge-fetch';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { RepositoryGateway } from '@/automation/github';
import { createManagedPreparation, createReleasePreparation, planIdentity } from '@/automation/managed';
import { discover } from '@/automation/managers';
import { planReleaseSet } from '@/automation/planning';
import type { RepositoryRecord, Snapshot } from '@/automation/types';

const snapshot: Snapshot = {
	repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: { 'package.json': '{"name":"tool","version":"1.0.0"}' },
};
const repository: RepositoryRecord = {
	...snapshot.repository,
	sha: snapshot.sha,
	inventory: discover(snapshot),
	diagnostics: [],
	presetShas: {},
	updatedAt: 0,
	configuration: parseRepositoryConfiguration({ streams: { main: { versioning: 'independent' } } }),
};
const plan = planReleaseSet(snapshot, repository.inventory, {
	groups: [{ id: 'tool', packages: ['npm:tool'], version: { bump: 'minor' } }],
});
test('managed preparation has stable identity, a frozen plan, and no workflow binding', async () => {
	const first = await createManagedPreparation(repository, 'main', plan);
	const second = await createManagedPreparation(repository, 'main', plan);
	expect(first.id).toBe(second.id);
	expect(first.workflow).toBeUndefined();
	expect(first.managed?.plan).toEqual(plan);
	expect(first.managed?.plan).not.toBe(plan);
	expect(first.managed?.branch).toMatch(/^release\/main\/[a-f0-9]{64}$/);
	await rejects(createManagedPreparation(repository, 'main', { ...plan, requiresPreparation: true }), /lockfiles/);
	await rejects(createManagedPreparation(repository, 'main', { ...plan, sourceSha: 'b'.repeat(40) }), /revision/);
});

test('reviewed plan identity binds versions, source revision and preset configuration', async () => {
	const identity = await planIdentity(plan, repository);
	expect(await planIdentity(structuredClone(plan), structuredClone(repository))).toBe(identity);
	expect(await planIdentity({ ...plan, sourceSha: 'e'.repeat(40) }, repository)).not.toBe(identity);
	expect(
		await planIdentity({ ...plan, groups: plan.groups.map(group => ({ ...group, version: '3.0.0' })) }, repository),
	).not.toBe(identity);
	expect(await planIdentity(plan, { ...repository, presetShas: { shared: 'e'.repeat(40) } })).not.toBe(identity);
});

test('lockfile release sets select the configured preparation workflow', async () => {
	const configuration = parseRepositoryConfiguration({
		streams: {
			main: {
				versioning: 'independent',
				prepare: { workflow: { file: 'prepare.yml' } },
			},
		},
	});
	const execution = await createReleasePreparation(
		{
			...repository,
			configuration,
			inventory: {
				...repository.inventory,
				workflows: [{
					file: 'prepare.yml',
					name: 'Prepare',
					events: ['workflow_dispatch'],
					jobs: [],
					localActions: [],
					dispatchInputs: ['beepboop_execution_id'],
					publication: false,
				}],
			},
		},
		'main',
		{ ...plan, requiresPreparation: true, lockfiles: ['package-lock.json'] },
	);
	expect(execution.workflow?.file).toBe('prepare.yml');
	expect(execution.managed).toBeUndefined();
	expect(execution.plan?.requiresPreparation).toBe(true);
	expect(execution.plan?.lockfiles).toEqual(['package-lock.json']);
});

class Gateway extends RepositoryGateway {
	branch: string | undefined;
	head = 'b'.repeat(40);
	checkpointed = false;
	failAfterBranch = true;
	commits = 0;
	pulls = 0;
	constructor() {
		super({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1);
	}
	override async token() {
		return 'fixture';
	}
	override async file() {
		return snapshot.files['package.json'] ?? '';
	}
	override async call(path: string, _token: string, method = 'GET', _body?: unknown): Promise<unknown> {
		if (path.includes('/git/ref/heads/')) return this.branch ? { object: { sha: this.branch } } : null;
		if (path.endsWith('/git/commits') && method === 'POST') {
			this.commits++;
			return { sha: this.head };
		}
		if (path.includes('/git/commits/')) return { tree: { sha: 'c'.repeat(40) }, parents: [{ sha: snapshot.sha }] };
		if (path.endsWith('/git/trees')) return { sha: 'd'.repeat(40) };
		if (path.includes('/rules/branches/')) return [];
		if (path.endsWith('/git/refs')) {
			expect(this.checkpointed).toBe(true);
			this.branch = this.head;
			if (this.failAfterBranch) {
				this.failAfterBranch = false;
				throw new Error('Interrupted after branch creation');
			}
			return {};
		}
		if (path.includes('/pulls?')) return this.pulls ? [{ number: 1, state: 'open' }] : [];
		if (path.endsWith('/pulls') || path.endsWith('/pulls/1')) {
			if (method === 'POST') this.pulls++;
			return {
				number: 1,
				html_url: 'https://github.com/example/tool/pull/1',
				head: { sha: this.head },
				base: { ref: 'main' },
			};
		}
		if (path.includes('/labels')) return [{ name: 'maintenance' }];
		throw new Error(`Unexpected fixture request: ${method} ${path}`);
	}
}
test('preparation resumes the checkpointed commit without creating another commit or PR', async () => {
	const gateway = new Gateway();
	let checkpoint = '';
	await rejects(
		gateway.pullRequest(snapshot, 'release/test', 'prepare', 'body', plan.edits, undefined, async head => {
			checkpoint = head;
			gateway.checkpointed = true;
		}),
		/Interrupted/,
	);
	const result = await gateway.resumePreparation(snapshot, 'release/test', 'prepare', 'body', checkpoint);
	expect(result.head).toBe(checkpoint);
	await gateway.resumePreparation(snapshot, 'release/test', 'prepare', 'body', checkpoint);
	expect(gateway.commits).toBe(1);
	expect(gateway.pulls).toBe(1);
	gateway.branch = 'e'.repeat(40);
	await rejects(gateway.resumePreparation(snapshot, 'release/test', 'prepare', 'body', checkpoint), /branch changed/);
	expect(gateway.pulls).toBe(1);
});

test('release-set target must be the merged preparation PR revision', async () => {
	class PreparedGateway extends RepositoryGateway {
		merged = true;
		constructor() {
			super({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1);
		}
		override async token() {
			return 'fixture';
		}
		override async call(path: string): Promise<unknown> {
			if (path.startsWith('/repos/example/tool/issues/1/events?')) {
				return [
					{ event: 'labeled' },
					...(this.merged ? [{ event: 'merged', commit_id: 'd'.repeat(40) }] : []),
					{ event: 'closed', commit_id: 'd'.repeat(40) },
				];
			}
			if (path === '/repos/example/tool/pulls/1') {
				return { merged: this.merged, head: { sha: 'b'.repeat(40) }, base: { ref: 'main', repo: { id: 1 } } };
			}
			throw new Error(`Unexpected fixture request ${path}`);
		}
		override async snapshot() {
			return { ...snapshot, sha: 'd'.repeat(40) };
		}
	}
	const gateway = new PreparedGateway();
	const result = { url: 'https://github.com/example/tool/pull/1', head: 'b'.repeat(40) };
	expect((await gateway.preparedSnapshot('example/tool', 1, result, 'd'.repeat(40))).sha).toBe('d'.repeat(40));
	await rejects(gateway.preparedSnapshot('example/tool', 1, result, 'e'.repeat(40)), /merged preparation/);
	await rejects(gateway.preparedSnapshot('example/other', 1, result, 'd'.repeat(40)), /PR identity/);
	gateway.merged = false;
	await rejects(gateway.preparedSnapshot('example/tool', 1, result, 'd'.repeat(40)), /merged preparation/);
});

test('tag discovery resolves the actual ref object instead of a stale tag-list commit', async () => {
	class TagGateway extends RepositoryGateway {
		constructor() {
			super({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1);
		}
		override async token() {
			return 'fixture';
		}
		override async call(path: string): Promise<unknown> {
			if (path.includes('/tags?')) return [{ name: 'v1.0.0', commit: { sha: 'a'.repeat(40) } }];
			if (path.includes('/git/ref/')) return { object: { type: 'tag', sha: 'b'.repeat(40) } };
			if (path.includes('/git/tags/')) return { object: { type: 'commit', sha: 'c'.repeat(40) } };
			throw new Error('Unexpected fixture request');
		}
	}
	expect(await new TagGateway().tagRefs('example/tool', 1)).toEqual([{
		name: 'v1.0.0',
		oid: 'b'.repeat(40),
		commit: 'c'.repeat(40),
	}]);
});

test('the gateway calls fetch unbound, at the current GitHub API version', async () => {
	const seen: { receiver: unknown; init: RequestInit | undefined }[] = [];
	function transport(this: unknown, _input: string | URL | Request, init?: RequestInit): Promise<Response> {
		seen.push({ receiver: this, init });
		if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
		return Promise.resolve(Response.json({ ok: true }));
	}
	const gateway = new RepositoryGateway({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1, transport);
	expect(await gateway.call('/meta', 'token')).toEqual({ ok: true });
	expect(seen[0]?.receiver).toBeUndefined();
	expect(new Headers(seen[0]?.init?.headers).get('X-GitHub-Api-Version')).toBe('2026-03-10');
});

test('the merge commit comes from the merged issue event on any page', async () => {
	class PagedGateway extends RepositoryGateway {
		requests: string[] = [];
		constructor(private mergedEvent?: Record<string, unknown>) {
			super({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1);
		}
		override async token() {
			return 'fixture';
		}
		override async call(path: string): Promise<unknown> {
			this.requests.push(path);
			if (path === '/repos/example/tool/pulls/1') {
				return { merged: true, head: { sha: 'b'.repeat(40) }, base: { ref: 'main', repo: { id: 1 } } };
			}
			const page = path.match(/^\/repos\/example\/tool\/issues\/1\/events\?per_page=100&page=(\d+)$/)?.[1];
			if (page === '2' && this.mergedEvent) return [this.mergedEvent];
			if (page) return Array.from({ length: 100 }, () => ({ event: 'commented' }));
			throw new Error(`Unexpected fixture request ${path}`);
		}
		override async snapshot() {
			return { ...snapshot, sha: 'd'.repeat(40) };
		}
	}
	const result = { url: 'https://github.com/example/tool/pull/1', head: 'b'.repeat(40) };
	const paged = new PagedGateway({ event: 'merged', commit_id: 'd'.repeat(40) });
	expect((await paged.preparedSnapshot('example/tool', 1, result, 'd'.repeat(40))).sha).toBe('d'.repeat(40));
	expect(paged.requests).toEqual([
		'/repos/example/tool/pulls/1',
		'/repos/example/tool/issues/1/events?per_page=100&page=1',
		'/repos/example/tool/issues/1/events?per_page=100&page=2',
	]);
	await rejects(
		new PagedGateway({ event: 'merged', commit_id: null }).preparedSnapshot('example/tool', 1, result, 'd'.repeat(40)),
		/merged preparation/,
	);
	const unmerged = new PagedGateway();
	await rejects(unmerged.preparedSnapshot('example/tool', 1, result, 'd'.repeat(40)), /merged preparation/);
	expect(unmerged.requests.length).toBe(11);
});

test('GitHub requests run on the Workers fetch and refuse a redirect', async () => {
	const ok = edgeFetch(() => Response.json({ ok: true }));
	expect(
		await new RepositoryGateway({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1, ok.fetch).call('/meta', 'token'),
	)
		.toEqual({ ok: true });
	const moved = edgeFetch(() => new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } }));
	await rejects(
		new RepositoryGateway({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1, moved.fetch).call('/meta', 'token'),
		/GitHub HTTP 302/,
	);
	expect(moved.urls).toEqual(['https://api.github.com/meta']);
});
