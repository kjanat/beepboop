import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { completion, mergePublications, validatePublicationIdentity } from '@/automation/execution';
import { discover } from '@/automation/managers';
import { identifyExecution, matchesPackage, packageId, packageUrl } from '@/automation/package-identity';
import { planReleaseSet } from '@/automation/planning';
import { Store } from '@/automation/store';
import type { Execution, Package, Publication, RepositoryRecord, Snapshot } from '@/automation/types';
import { packageIdentity, packageKey, purl } from '@/package-url';

const snapshot: Snapshot = {
	repository: { id: 1, name: 'Owner/Repo', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: { 'package.json': '{"name":"@Scope/MixedCase","version":"1.0.0"}' },
};
const publication: Publication = {
	id: 'npm:@Scope/MixedCase',
	manager: 'npm',
	name: '@Scope/MixedCase',
	version: '1.0.0',
	outcome: 'succeeded',
	required: true,
};

test('discovery stores components and selection keys preserve legacy npm case', () => {
	const [pkg] = discover(snapshot, ['npm']).packages;
	expect(pkg?.identity).toEqual({ type: 'npm', namespace: '@Scope', name: 'MixedCase', version: '1.0.0' });
	if (!pkg) throw Error('Missing package');
	expect(packageId(pkg)).toBe('pkg:npm/%40Scope/MixedCase');
	expect(matchesPackage('npm:@Scope/MixedCase', pkg)).toBe(true);
	expect(matchesPackage('pkg:npm/%40Scope/MixedCase', pkg)).toBe(true);
	expect(matchesPackage('pkg:npm/%40scope/mixedcase', pkg)).toBe(false);
});

test('registry, platform and subpath stay part of identity; version alone is removed for selection', () => {
	const identity = packageIdentity(
		'pkg:vscode-extension/MS-Python/Python@1.0?platform=linux-x64&repository_url=https:%2F%2Fopen-vsx.org#lib',
	);
	expect(purl(identity)).toBe(
		'pkg:vscode-extension/ms-python/python@1.0?platform=linux-x64&repository_url=https:%2F%2Fopen-vsx.org#lib',
	);
	expect(packageKey(identity)).not.toBe(
		packageKey({ ...identity, qualifiers: { ...identity.qualifiers, platform: 'darwin-arm64' } }),
	);
	expect(packageKey(identity)).toBe(packageKey({ ...identity, version: '2.0' }));
	expect(() => packageIdentity({ type: 'pypi', namespace: 'invalid', name: 'django' })).toThrow();
	expect(packageIdentity({ type: 'pypi', name: 'Django_Allauth' }).name).toBe('django-allauth');
});

test('canonical and legacy aliases cannot select one package twice or escape a stream', () => {
	const inventory = discover(snapshot, ['npm']);
	const canonical = 'pkg:npm/%40Scope/MixedCase';
	const group = { id: 'one', packages: [canonical], version: '1.1.0' };
	const planned = planReleaseSet(snapshot, inventory, { groups: [group] }, ['npm:@Scope/MixedCase']);
	expect(planned.groups[0]?.packages).toEqual([canonical]);
	expect(() =>
		planReleaseSet(snapshot, inventory, {
			groups: [group, { ...group, id: 'two', packages: ['npm:@Scope/MixedCase'] }],
		})
	).toThrow('more than once');
	expect(() => planReleaseSet(snapshot, inventory, { groups: [group] }, ['pkg:npm/other'])).toThrow('outside');
});

test('publication gates and merge recognize both forms without accepting another package', () => {
	const execution = {
		repository: 'owner/repo',
		operation: 'publish',
		publications: [publication],
		configuration: { streams: { main: { required: ['pkg:npm/%40Scope/MixedCase'] } } },
		stream: 'main',
	} as unknown as Execution;
	expect(completion(execution, true)).toBe('succeeded');
	expect(mergePublications([publication], [{ ...publication, id: 'pkg:npm/%40Scope/MixedCase', outcome: 'pending' }]))
		.toHaveLength(1);
	expect(
		mergePublications([publication], [{ ...publication, id: 'pkg:npm/%40Scope/MixedCase', outcome: 'pending' }])[0]
			?.outcome,
	).toBe('succeeded');
	expect(() => validatePublicationIdentity(execution, { ...publication, id: 'pkg:npm/another' })).toThrow('identity');
	validatePublicationIdentity(execution, { ...publication, id: 'pkg:npm/%40Scope/MixedCase' });
	expect(identifyExecution(execution).publications[0]?.identity?.namespace).toBe('@Scope');
	expect(identifyExecution(execution).publications[0]?.id).toBe('pkg:npm/%40Scope/MixedCase');
});

test('D1 reads legacy documents and persists structured identities and qualifiers', async () => {
	const sqlite = new Database(':memory:');
	sqlite.exec('CREATE TABLE repositories(id INTEGER PRIMARY KEY,name TEXT,document TEXT,updated_at INTEGER)');
	const db = {
		prepare(sql: string) {
			return {
				bind(...values: (string | number)[]) {
					return {
						async first() {
							return sqlite.query(sql).get(...values);
						},
						async run() {
							return sqlite.query(sql).run(...values);
						},
					};
				},
			};
		},
	} as unknown as D1Database;
	try {
		const store = new Store(db);
		const legacy: RepositoryRecord = {
			...snapshot.repository,
			sha: snapshot.sha,
			inventory: discover(snapshot, ['npm']),
			presetShas: {},
			diagnostics: [],
			updatedAt: 1,
		};
		for (const pkg of legacy.inventory.packages) delete pkg.identity;
		legacy.inventory.publicationOrder = ['npm:@Scope/MixedCase'];
		sqlite.query('INSERT INTO repositories VALUES(?,?,?,?)').run(1, legacy.name, JSON.stringify(legacy), 1);
		const restored = await store.repository(1);
		expect(restored?.inventory.packages[0]?.identity?.name).toBe('MixedCase');
		expect(restored?.inventory.publicationOrder).toEqual(['pkg:npm/%40Scope/MixedCase']);
		if (!restored) throw Error('Missing repository');
		const pkg = restored.inventory.packages[0] as Package;
		pkg.identity = packageIdentity({
			...pkg.identity as NonNullable<Package['identity']>,
			qualifiers: { repository_url: 'https://registry.example' },
			subpath: 'src',
		});
		await store.putRepository(restored);
		const stored = sqlite.query('SELECT document FROM repositories WHERE id=1').get() as { document: string };
		const saved = JSON.parse(stored.document) as RepositoryRecord;
		expect(packageUrl(saved.inventory.packages[0] as Package)).toBe(
			'pkg:npm/%40Scope/MixedCase@1.0.0?repository_url=https:%2F%2Fregistry.example#src',
		);
	} finally {
		sqlite.close();
	}
});
