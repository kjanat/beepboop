import { expect, test } from 'bun:test';
import { parseRepositoryConfiguration } from '#automation/configuration';
import { RepositoryGateway } from '#automation/github';
import { createManagedPreparation, createReleasePreparation, planIdentity } from '#automation/managed';
import { discover } from '#automation/managers';
import { planReleaseSet } from '#automation/planning';
import type { RepositoryRecord, Snapshot } from '#automation/types';

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
	await expect(createManagedPreparation(repository, 'main', { ...plan, requiresPreparation: true })).rejects.toThrow(
		'lockfiles',
	);
	await expect(createManagedPreparation(repository, 'main', { ...plan, sourceSha: 'b'.repeat(40) })).rejects.toThrow(
		'revision',
	);
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
	await expect(gateway.pullRequest(snapshot, 'release/test', 'prepare', 'body', plan.edits, undefined, async head => {
		checkpoint = head;
		gateway.checkpointed = true;
	})).rejects.toThrow('Interrupted');
	const result = await gateway.resumePreparation(snapshot, 'release/test', 'prepare', 'body', checkpoint);
	expect(result.head).toBe(checkpoint);
	await gateway.resumePreparation(snapshot, 'release/test', 'prepare', 'body', checkpoint);
	expect(gateway.commits).toBe(1);
	expect(gateway.pulls).toBe(1);
	gateway.branch = 'e'.repeat(40);
	await expect(gateway.resumePreparation(snapshot, 'release/test', 'prepare', 'body', checkpoint)).rejects.toThrow(
		'branch changed',
	);
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
		override async call(): Promise<unknown> {
			return {
				merged: this.merged,
				merge_commit_sha: 'd'.repeat(40),
				head: { sha: 'b'.repeat(40) },
				base: { ref: 'main', repo: { id: 1 } },
			};
		}
		override async snapshot() {
			return { ...snapshot, sha: 'd'.repeat(40) };
		}
	}
	const gateway = new PreparedGateway();
	const result = { url: 'https://github.com/example/tool/pull/1', head: 'b'.repeat(40) };
	expect((await gateway.preparedSnapshot('example/tool', 1, result, 'd'.repeat(40))).sha).toBe('d'.repeat(40));
	await expect(gateway.preparedSnapshot('example/tool', 1, result, 'e'.repeat(40))).rejects.toThrow(
		'merged preparation',
	);
	await expect(gateway.preparedSnapshot('example/other', 1, result, 'd'.repeat(40))).rejects.toThrow('PR identity');
	gateway.merged = false;
	await expect(gateway.preparedSnapshot('example/tool', 1, result, 'd'.repeat(40))).rejects.toThrow(
		'merged preparation',
	);
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
