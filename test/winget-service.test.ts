import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { RepositoryGateway } from '@/automation/github';
import { type AutomationBindings, AutomationService } from '@/automation/service';
import { Store } from '@/automation/store';
import type { AutomationEvent, Execution, RepositoryRecord } from '@/automation/types';
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
	sqlite.run(readFileSync('migrations/0002_release_events.sql', 'utf8'));
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
		failBeforeBranch = false;
		failLookup = false;
		expireLookup = false;
		packageIdentifier = configuration.packageIdentifier;
		releaseNotes = 'Release notes';
		requests: string[] = [];
		draft = false;
		prerelease = false;
		digest = true;
		tampered = false;
		privateRepo = false;
		failReleases = false;
		reconciled: number[] = [];
		checks = { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] };
		statuses = { total_count: 0, state: 'pending' };
		async token() {
			return 'fixture';
		}
		async snapshot() {
			return {
				repository: { id: 1, name: repo.name, defaultBranch: 'main' },
				sha: 'b'.repeat(40),
				files: {
					'distribution/winget.json': JSON.stringify({ ...configuration, packageIdentifier: this.packageIdentifier }),
				},
			};
		}
		async call(path: string, _token: string, method = 'GET', body?: unknown): Promise<unknown> {
			this.requests.push(path);
			if (this.failBeforeBranch && path === '/repos/bot/winget-pkgs') throw Error('Permission denied');
			if (this.failLookup && path.includes('/pulls?')) throw Error('Lookup unavailable');
			if (this.expireLookup && path.includes('/pulls?')) sqlite.run('UPDATE winget_submissions SET lease_until=0');
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
					body: this.releaseNotes,
					html_url: 'https://github.com/example/tool/releases/tag/v1.2.3',
				};
			}
			if (this.failReleases && path.includes('/releases?')) throw Error('Release API unavailable');
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
			const pullNumber = /\/pulls\/(\d+)$/.exec(path)?.[1];
			if (pullNumber) {
				this.reconciled.push(Number(pullNumber));
				return pr;
			}
			if (/\/pulls\/\d+\/reviews\?per_page=100$/.test(path)) {
				return [{ state: 'CHANGES_REQUESTED', user: { login: 'reviewer' } }];
			}
			if (path.endsWith('/check-runs?per_page=100')) {
				return this.checks;
			}
			if (path.endsWith('/status')) return this.statuses;
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

test('WinGet reconciliation visits every open submission beyond the dashboard limit', async () => {
	const f = fixture();
	try {
		const plan = await f.service.plan(repo, 42);
		for (let i = 0; i < 305; i++) {
			const id = String(i).padStart(4, '0');
			const saved = { plan: { ...plan, id }, state: i < 205 ? 'open' : 'closed', number: i + 1, updatedAt: i };
			f.sqlite.run('INSERT INTO winget_submissions(id,package,version,document,updated_at) VALUES(?,?,?,?,?)', [
				id,
				`Example.Tool${i}`,
				'1.2.3',
				JSON.stringify(saved),
				i,
			]);
		}
		expect(await f.service.list()).toHaveLength(100);
		f.gateway.merged = true;
		await f.service.reconcile();
		expect(f.gateway.reconciled).toHaveLength(205);
		expect(new Set(f.gateway.reconciled).size).toBe(205);
		expect((await f.service.get('0000'))?.state).toBe('merged');
		expect((await f.service.get('0204'))?.state).toBe('merged');
		expect((await f.service.get('0304'))?.state).toBe('closed');
	} finally {
		f.sqlite.close();
	}
});

test('WinGet reconciliation recognizes status-only validation and keeps absent validation pending', async () => {
	const f = fixture();
	try {
		const plan = await f.service.plan(repo, 42);
		await f.service.submit(repo, 42, plan.digest);
		f.gateway.checks = { total_count: 0, check_runs: [] };
		for (
			const [state, total_count, expected] of [
				['success', 1, 'passed'],
				['success', 0, 'pending'],
				['pending', 1, 'pending'],
				['failure', 1, 'failed'],
				['error', 1, 'failed'],
			] as const
		) {
			f.gateway.statuses = { state, total_count };
			await f.service.reconcile();
			expect((await f.service.get(plan.id))?.checks).toBe(expected);
		}
	} finally {
		f.sqlite.close();
	}
});

test('WinGet release-list failure does not prevent coordinator wake, event delivery, or scheduled workflows', async () => {
	const f = fixture();
	try {
		const scheduled: RepositoryRecord = {
			...repo,
			configuration: parseRepositoryConfiguration({
				winget: { config: 'distribution/winget.json', automatic: true },
				streams: { main: { workflows: { publish: { file: 'release.yml', schedule: '* * * * *' } } } },
			}),
			inventory: {
				...repo.inventory,
				workflows: [{
					name: 'Release',
					file: 'release.yml',
					events: ['workflow_dispatch'],
					dispatchInputs: ['beepboop_execution_id'],
					jobs: [],
					localActions: [],
					publication: true,
				}],
			},
		};
		f.sqlite.run('INSERT INTO repositories VALUES(?,?,?,?)', [repo.id, repo.name, JSON.stringify(scheduled), 0]);
		const lastTick = Math.floor(Date.now() / 60_000) * 60_000 - 60_000;
		f.sqlite.run('INSERT INTO schedules VALUES(?,?)', ['1:main:publish:* * * * *', lastTick]);
		const calls: string[] = [];
		const event: AutomationEvent = {
			id: 'released',
			source: repo.name,
			event: 'package.version.changed',
			version: '1.2.3',
		};
		const coordinator = {
			wake: async () => {
				calls.push('wake');
			},
			releaseEvents: async () => [event],
			acknowledgeReleaseEvent: async (id: string) => {
				calls.push(`ack:${id}`);
			},
			enqueue: async (execution: Execution) => {
				calls.push(`enqueue:${execution.operation}`);
				return execution;
			},
		};
		class Service extends AutomationService {
			override async refresh() {
				return scheduled;
			}
			override winget() {
				return f.service;
			}
			override async event(value: AutomationEvent) {
				calls.push(`event:${value.id}`);
			}
		}
		const service = new Service({
			DB: f.service.store.db,
			AUTOMATION: { getByName: () => coordinator },
		} as unknown as AutomationBindings);
		f.gateway.failReleases = true;
		await service.scheduled();
		expect(calls).toEqual(['wake', 'event:released', 'ack:released', 'enqueue:publish']);
		expect(
			(await service.store.activity()).some(row =>
				row.action === 'winget.failed' && row.target.includes('Release API unavailable')
			),
		).toBe(true);
	} finally {
		f.sqlite.close();
	}
});

test('a fresh preview replaces a failed WinGet plan only after checking for its branch and PR', async () => {
	const f = fixture();
	try {
		const old = await f.service.plan(repo, 42);
		f.gateway.failBeforeBranch = true;
		await rejects(f.service.submit(repo, 42, old.digest), /Permission denied/);
		expect(f.gateway.posts).toEqual([]);
		f.gateway.failBeforeBranch = false;
		f.gateway.releaseNotes = 'Corrected release notes';
		const fresh = await f.service.plan(repo, 42);
		expect(fresh.digest).not.toBe(old.digest);
		await rejects(f.service.submit(repo, 42, old.digest), /preview again/);
		const result = await f.service.submit(repo, 42, fresh.digest);
		expect(result.state).toBe('open');
		expect((await f.service.get(old.id))?.plan.digest).toBe(fresh.digest);
		const oldBranch = `winget/${old.packageIdentifier}/${old.version}/${old.digest.slice(0, 16)}`;
		expect(f.gateway.requests.some(path => path.includes(encodeURIComponent(`bot:${oldBranch}`)))).toBe(true);
		expect(f.gateway.requests).toContain(`/repos/bot/winget-pkgs/git/ref/heads/${oldBranch}`);
		expect(f.gateway.posts.filter(path => path.endsWith('/pulls'))).toHaveLength(1);
	} finally {
		f.sqlite.close();
	}
});

test('a changed WinGet plan cannot replace a failed attempt that already created a branch or PR', async () => {
	for (const existing of ['branch', 'pull'] as const) {
		const f = fixture();
		try {
			const old = await f.service.plan(repo, 42);
			f.gateway.tampered = existing === 'branch';
			f.gateway.failAfterPr = existing === 'pull';
			await rejects(f.service.submit(repo, 42, old.digest));
			f.gateway.releaseNotes = 'Changed after attempted submission';
			const fresh = await f.service.plan(repo, 42);
			const posts = f.gateway.posts.length;
			await rejects(f.service.submit(repo, 42, fresh.digest), /previous plan.*branch or pull request/i);
			expect((await f.service.get(old.id))?.plan.digest).toBe(old.digest);
			expect(f.gateway.posts).toHaveLength(posts);
		} finally {
			f.sqlite.close();
		}
	}
});

test('WinGet plan replacement requires an available lease and successful upstream lookup', async () => {
	const f = fixture();
	try {
		const old = await f.service.plan(repo, 42);
		f.gateway.failBeforeBranch = true;
		await rejects(f.service.submit(repo, 42, old.digest));
		f.gateway.failBeforeBranch = false;
		f.gateway.releaseNotes = 'Corrected';
		const fresh = await f.service.plan(repo, 42);
		f.sqlite.run('UPDATE winget_submissions SET lease_until=?', [Date.now() + 60_000]);
		await rejects(f.service.submit(repo, 42, fresh.digest), /already in progress/);
		f.sqlite.run('UPDATE winget_submissions SET lease_until=0');
		f.gateway.failLookup = true;
		await rejects(f.service.submit(repo, 42, fresh.digest), /Lookup unavailable/);
		f.gateway.failLookup = false;
		f.gateway.expireLookup = true;
		await rejects(f.service.submit(repo, 42, fresh.digest), /lease expired/);
		expect((await f.service.get(old.id))?.plan.digest).toBe(old.digest);
		expect(f.gateway.posts).toEqual([]);
	} finally {
		f.sqlite.close();
	}
});

test('a corrected WinGet package identifier updates the failed submission uniqueness key', async () => {
	const f = fixture();
	try {
		const old = await f.service.plan(repo, 42);
		f.gateway.failBeforeBranch = true;
		await rejects(f.service.submit(repo, 42, old.digest));
		f.gateway.failBeforeBranch = false;
		f.gateway.packageIdentifier = 'Example.Corrected';
		const fresh = await f.service.plan(repo, 42);
		await f.service.submit(repo, 42, fresh.digest);
		expect((await f.service.get(old.id))?.plan.packageIdentifier).toBe('Example.Corrected');
		expect(f.sqlite.query('SELECT package,version FROM winget_submissions WHERE id=?').get(old.id)).toEqual({
			package: 'Example.Corrected',
			version: '1.2.3',
		});
	} finally {
		f.sqlite.close();
	}
});
