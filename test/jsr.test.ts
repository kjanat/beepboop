import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { completion, createExecution, validatePublicationIdentity } from '@/automation/execution';
import { discover, planRelease, resolvePublished, verifyPublication } from '@/automation/managers';
import { packageId } from '@/automation/package-identity';
import type { Publication, RepositoryRecord, Snapshot } from '@/automation/types';

const snapshot: Snapshot = {
	repository: { id: 1, name: 'kjanat/beepboop', defaultBranch: 'master' },
	sha: 'a'.repeat(40),
	files: {
		'package.json': '{"name":"beepboop","private":true}',
		'packages/cli/package.json': '{"name":"@kjanat/beepboop","version":"1.0.0"}',
		'packages/cli/jsr.json': '{"name":"@kjanat/beepboop","version":"1.0.0","exports":"./mod.ts"}',
	},
};
const id = 'pkg:generic/%40kjanat/beepboop?repository_url=https:%2F%2Fjsr.io';
const publication: Publication = {
	id,
	manager: 'jsr',
	name: '@kjanat/beepboop',
	version: '1.0.0',
	required: true,
	outcome: 'succeeded',
};
const meta = { scope: 'kjanat', name: 'beepboop', latest: '1.0.0', versions: { '1.0.0': {} } };
const version = {
	exports: { '.': './mod.ts' },
	manifest: { '/mod.ts': { size: 12, checksum: `sha256-${'a'.repeat(64)}` } },
};

test('npm and JSR are distinct identities with synchronized release edits', () => {
	const inventory = discover(snapshot);
	expect(inventory.packages.filter(p => p.publish).map(packageId)).toEqual(['pkg:npm/%40kjanat/beepboop', id]);
	const plan = planRelease(snapshot, inventory, '1.1.0', ['pkg:npm/%40kjanat/beepboop', id]);
	expect(plan.edits.map(edit => [edit.path, JSON.parse(edit.after).version])).toEqual([
		['packages/cli/package.json', '1.1.0'],
		['packages/cli/jsr.json', '1.1.0'],
	]);
});
test('JSR discovery diagnoses malformed manifests without losing other packages', () => {
	const inventory = discover({
		...snapshot,
		files: { ...snapshot.files, 'broken/jsr.json': '{', 'invalid/jsr.json': '{"name":"unscoped"}' },
	});
	expect(inventory.packages.filter(p => p.manager === 'jsr')).toHaveLength(1);
	expect(inventory.diagnostics).toContain('broken/jsr.json: invalid JSR manifest');
	expect(inventory.diagnostics).toContain('invalid/jsr.json: invalid JSR manifest');
});
test('JSR latest resolves metadata and rejects yanked or mismatched packages', async () => {
	const inventory = discover(snapshot, ['jsr']);
	const result = await resolvePublished(inventory, async () => Response.json(meta));
	expect(result.packages[0]?.published).toBe('1.0.0');
	const failed = await resolvePublished(inventory, async () => Response.json({ ...meta, name: 'different' }));
	expect(failed.packages[0]?.publicationStatus).toBe('failed');
	const yanked = await resolvePublished(
		inventory,
		async () => Response.json({ ...meta, versions: { '1.0.0': { yanked: true } } }),
	);
	expect(yanked.packages[0]?.publicationStatus).toBe('failed');
});
test('JSR verification requires a published, unyanked version and hashes immutable metadata', async () => {
	const request = async (url: string | URL | Request) =>
		Response.json(String(url).endsWith('/meta.json') ? meta : version);
	const result = await verifyPublication(publication, request);
	expect(result.outcome).toBe('succeeded');
	expect(result.digest).toMatch(/^sha256-[a-f0-9]{64}$/);
	expect((await verifyPublication({ ...publication, digest: 'different' }, request)).outcome).toBe('failed');
	expect((await verifyPublication(publication, async () => Response.json({ ...meta, versions: {} }))).outcome).toBe(
		'pending',
	);
	expect(
		(await verifyPublication(
			publication,
			async () => Response.json({ ...meta, versions: { '1.0.0': { yanked: true } } }),
		)).outcome,
	).toBe('failed');
	expect((await verifyPublication(publication, async () => new Response('', { status: 404 }))).outcome).toBe('pending');
	expect((await verifyPublication(publication, async () => new Response('', { status: 503 }))).outcome).toBe(
		'uncertain',
	);
	expect(
		(await verifyPublication(
			publication,
			async url => Response.json(String(url).endsWith('/meta.json') ? meta : { manifest: {}, exports: {} }),
		)).outcome,
	).toBe('failed');
});
test('this repository configuration dispatches preparation and requires both registries after approval', async () => {
	const files = { ...snapshot.files };
	for (
		const path of ['.github/beepboop.json', '.github/workflows/prepare-cli.yml', '.github/workflows/publish-cli.yml']
	) {
		files[path] = await readFile(path, 'utf8');
		if (path.endsWith('.yml')) {
			expect(parseYaml(files[path])['run-name']).toBe(`Release operation \${{ inputs.beepboop_execution_id }}`);
		}
	}
	const configuration = parseRepositoryConfiguration(JSON.parse(files['.github/beepboop.json'] ?? '{}'));
	const repository: RepositoryRecord = {
		...snapshot.repository,
		sha: snapshot.sha,
		inventory: discover({ ...snapshot, files }),
		diagnostics: [],
		presetShas: {},
		updatedAt: 0,
		configuration,
	};
	const prepare = await createExecution(repository, 'cli', 'prepare', 'release:1.0.0', '1.0.0');
	expect(prepare.workflow?.file).toBe('prepare-cli.yml');
	const release = await createExecution(repository, 'cli', 'promote', 'release:1.0.0', '1.0.0');
	expect(release.state).toBe('blocked');
	expect(() => validatePublicationIdentity(release, { ...publication, version: '2.0.0' })).toThrow('version');
	release.publications = [publication];
	expect(completion(release, true)).toBe('blocked');
	release.publications.push({ ...publication, id: 'pkg:npm/%40kjanat/beepboop', manager: 'npm' });
	expect(completion(release, true)).toBe('succeeded');
	release.publications[0] = { ...publication, outcome: 'failed' };
	expect(completion(release, true)).toBe('failed');
});
