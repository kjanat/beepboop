import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { RepositoryGateway } from '@/automation/github';
import { Store } from '@/automation/store';
import type { RepositoryRecord } from '@/automation/types';
import { parseWinGetPolicy, WinGetService } from '@/automation/winget';

const configuration = JSON.parse(readFileSync('examples/winget/package.json', 'utf8'));
const repo: RepositoryRecord = {
	id: 1,
	name: 'example/tool',
	defaultBranch: 'main',
	sha: 'a'.repeat(40),
	configuration: parseRepositoryConfiguration({ winget: { config: 'distribution/winget.json' } }),
	diagnostics: [],
	presetShas: {},
	inventory: { packages: [], workflows: [], managers: [], diagnostics: [], publicationOrder: [] },
	updatedAt: 0,
};
function fixture() {
	const sqlite = new Database(':memory:');
	sqlite.run(readFileSync('migrations/0001_automation.sql', 'utf8'));
	sqlite.run(readFileSync('migrations/0003_winget.sql', 'utf8'));
	const prepare = (sql: string, args: unknown[] = []): unknown => ({
		bind: (...values: unknown[]) => prepare(sql, values),
		first: async () => sqlite.query(sql).get(...args as never[]),
		all: async () => ({ results: sqlite.query(sql).all(...args as never[]) }),
		run: async () => ({ meta: { changes: sqlite.query(sql).run(...args as never[]).changes } }),
	});
	class Gateway extends RepositoryGateway {
		posts: string[] = [];
		files: Record<string, string> = {};
		branch = false;
		pull = false;
		merged = false;
		failAfterPr = false;
		draft = false;
		prerelease = false;
		digest = true;
		tampered = false;
		privateRepo = false;
		async token() {
			return 'fixture';
		}
		async snapshot() {
			return {
				repository: { id: 1, name: repo.name, defaultBranch: 'main' },
				sha: 'b'.repeat(40),
				files: { 'distribution/winget.json': JSON.stringify(configuration) },
			};
		}
		async call(path: string, _token: string, method = 'GET', body?: unknown): Promise<unknown> {
			if (method === 'POST') this.posts.push(path);
			if (path === '/repos/example/tool') return { private: this.privateRepo };
			if (path.includes('/releases/42/assets')) {
				return ['amd64', 'arm64'].map((arch, i) => ({
					name: `tool_1.2.3_windows_${arch}.zip`,
					state: 'uploaded',
					digest: this.digest ? `sha256:${(i ? 'b' : 'a').repeat(64)}` : null,
					browser_download_url:
						`https://github.com/example/tool/releases/download/v1.2.3/tool_1.2.3_windows_${arch}.zip`,
				}));
			}
			if (path === '/repos/example/tool/releases/42') {
				return {
					id: 42,
					tag_name: 'v1.2.3',
					draft: this.draft,
					prerelease: this.prerelease,
					published_at: '2026-11-02T00:00:00Z',
					body: 'Release notes',
					html_url: 'https://github.com/example/tool/releases/tag/v1.2.3',
				};
			}
			if (path.includes('/releases?')) return [{ id: 42, tag_name: 'v1.2.3', published_at: '2026-11-02T00:00:00Z' }];
			if (path === '/repos/bot/winget-pkgs') return { fork: true, parent: { full_name: 'microsoft/winget-pkgs' } };
			if (path === '/repos/microsoft/winget-pkgs') return { default_branch: 'master' };
			const pr = {
				number: 7,
				html_url: 'https://github.com/microsoft/winget-pkgs/pull/7',
				state: 'open',
				merged_at: this.merged ? '2026-11-03' : null,
				head: { sha: 'c'.repeat(40) },
			};
			if (path.includes('/pulls?')) return this.pull ? [pr] : [];
			if (path.endsWith('/pulls/7')) return pr;
			if (path.endsWith('/pulls/7/reviews?per_page=100')) {
				return [{ state: 'CHANGES_REQUESTED', user: { login: 'reviewer' } }];
			}
			if (path.endsWith('/check-runs?per_page=100')) {
				return { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] };
			}
			if (path.endsWith('/status')) return { total_count: 0, state: 'pending' };
			if (path === '/repos/microsoft/winget-pkgs/pulls' && method === 'POST') {
				this.pull = true;
				if (this.failAfterPr) throw Error('Lost response');
				return pr;
			}
			if (path.startsWith('/repos/bot/winget-pkgs/git/ref/heads/')) {
				return this.branch
					? { object: { sha: 'c'.repeat(40) } }
					: null;
			}
			if (path === '/repos/bot/winget-pkgs/git/refs') {
				this.branch = true;
				return { object: { sha: 'c'.repeat(40) } };
			}
			if (path.includes('/git/ref/heads/master')) return { object: { sha: 'd'.repeat(40) } };
			if (path.startsWith('/repos/microsoft/winget-pkgs/git/commits/')) return { tree: { sha: 'e'.repeat(40) } };
			if (path.endsWith('/git/trees')) {
				const tree = (body as { tree: { path: string; content: string }[] }).tree;
				this.files = Object.fromEntries(tree.map(file => [file.path, file.content]));
				return { sha: 'f'.repeat(40) };
			}
			if (path.endsWith('/git/commits')) return { sha: 'c'.repeat(40) };
			if (path.includes('/compare/')) {
				return {
					files: Object.keys(this.files).map(filename => ({ filename, status: this.tampered ? 'modified' : 'added' })),
				};
			}
			if (path.includes('/contents/')) {
				const name = path.split('/contents/')[1]?.split('?')[0] ?? '';
				return { content: Buffer.from(this.files[name] ?? '', 'utf8').toString('base64') };
			}
			throw Error(`Unexpected fixture request ${path}`);
		}
	}
	const gateway = new Gateway({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1);
	const service = new WinGetService(new Store({ prepare } as unknown as D1Database), gateway, {
		WINGET_FORK: 'bot/winget-pkgs',
		WINGET_GITHUB_TOKEN: 'fixture',
	});
	return { sqlite, gateway, service };
}
test('WinGet preview derives exact release files and refuses drafts, prereleases, private assets and absent digests', async () => {
	const f = fixture();
	try {
		const plan = await f.service.plan(repo, 42);
		expect(Object.keys(plan.files)).toHaveLength(3);
		expect(Object.keys(plan.files)[0]).toBe('manifests/e/Example/Tool/1.2.3/Example.Tool.yaml');
		expect(plan.sourceSha).toBe('b'.repeat(40));
		expect(f.gateway.posts).toEqual([]);
		for (const key of ['draft', 'prerelease', 'privateRepo'] as const) {
			f.gateway[key] = true;
			await rejects(f.service.plan(repo, 42));
			f.gateway[key] = false;
		}
		f.gateway.digest = false;
		await rejects(f.service.plan(repo, 42), /Checksum missing/);
	} finally {
		f.sqlite.close();
	}
});
test('WinGet submission recovers a lost PR response without a duplicate and tracks checks and merge', async () => {
	const f = fixture();
	try {
		const plan = await f.service.plan(repo, 42);
		await rejects(f.service.submit(repo, 42, 'stale'), /preview again/);
		f.gateway.failAfterPr = true;
		await rejects(f.service.submit(repo, 42, plan.digest), /Lost response/);
		expect((await f.service.get(plan.id))?.state).toBe('failed');
		const submitted = await f.service.submit(repo, 42, plan.digest);
		expect(submitted.number).toBe(7);
		expect(f.gateway.posts.filter(path => path.endsWith('/pulls'))).toHaveLength(1);
		await f.service.reconcile();
		expect((await f.service.get(plan.id))?.checks).toBe('passed');
		expect((await f.service.get(plan.id))?.reviews).toBe('Changes requested');
		f.gateway.merged = true;
		await f.service.reconcile();
		expect((await f.service.get(plan.id))?.state).toBe('merged');
	} finally {
		f.sqlite.close();
	}
});
test('WinGet rejects unexpected branch changes and concurrent submissions', async () => {
	const f = fixture();
	try {
		const plan = await f.service.plan(repo, 42);
		f.gateway.tampered = true;
		await rejects(f.service.submit(repo, 42, plan.digest), /unexpected changes/);
		expect(f.gateway.posts.some(path => path.endsWith('/pulls'))).toBe(false);
		f.sqlite.run('UPDATE winget_submissions SET lease_until=?', [Date.now() + 60_000]);
		await rejects(f.service.submit(repo, 42, plan.digest), /already in progress/);
	} finally {
		f.sqlite.close();
	}
});
test('WinGet automation does not submit historical releases when first enabled', async () => {
	const f = fixture();
	try {
		const automatic = {
			...repo,
			configuration: parseRepositoryConfiguration({ winget: { config: 'distribution/winget.json', automatic: true } }),
		};
		await f.service.automatic(automatic);
		expect(f.gateway.posts).toEqual([]);
		f.sqlite.run('UPDATE winget_watches SET since=0');
		await f.service.automatic(automatic);
		expect((await f.service.list())[0]?.state).toBe('open');
	} finally {
		f.sqlite.close();
	}
});
test('WinGet policy rejects traversal and unsupported fields', () => {
	expect(() => parseWinGetPolicy({ config: '../private.json' })).toThrow();
	expect(() => parseWinGetPolicy({ config: 'package.json', automatic: 'yes' })).toThrow();
	expect(() => parseWinGetPolicy({ config: 'package.json', token: 'secret' })).toThrow();
});
