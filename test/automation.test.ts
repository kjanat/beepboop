import { describe, expect, test } from 'bun:test';
import { parseRepositoryConfiguration, resolveConfiguration } from '#automation/configuration';
import { completion, createExecution, mergePublications } from '#automation/execution';
import { discover, planRelease, publicationOrder, verifyPublication } from '#automation/managers';
import { onboardingConfiguration } from '#automation/onboarding';
import type { Publication, RepositoryRecord, Snapshot } from '#automation/types';
import { parseGrant } from '#automation/vault';

const snapshot: Snapshot = {
	repository: { id: 91, name: 'example/seventh', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: {
		'Cargo.toml':
			'[workspace]\nmembers = ["crates/*"]\nexclude = ["crates/ignored"]\n[workspace.package]\nversion = "1.0.0"\n[workspace.dependencies]\ncore = { path = "crates/core", version = "1.0.0" }\n',
		'crates/core/Cargo.toml': '[package]\nname = "core"\nversion.workspace = true\n',
		'crates/cli/Cargo.toml':
			'[package]\nname = "cli"\nversion.workspace = true\n[dependencies]\ncore.workspace = true\n',
		'crates/ignored/Cargo.toml': '[package]\nname = "ignored"\nversion = "8.0.0"\n',
		'package.json': '{"name":"root","private":true,"version":"1.0.0","workspaces":["packages/*"]}\n',
		'packages/one/package.json': '{"name":"one","version":"1.0.0"}\n',
		'packages/two/package.json': '{"name":"two","version":"1.0.0","dependencies":{"one":"^1.0.0"}}\n',
		'.github/workflows/release.yml':
			'name: Release\non:\n  workflow_dispatch:\n    inputs:\n      beepboop_execution_id: {type: string}\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps: [{run: cargo publish}]\n',
	},
};
function repository(): RepositoryRecord {
	return {
		id: 91,
		name: 'example/seventh',
		defaultBranch: 'main',
		sha: snapshot.sha,
		configuration: parseRepositoryConfiguration({
			streams: { main: { workflows: { publish: { file: 'release.yml' } }, required: ['npm:one'] } },
		}),
		presetShas: {},
		inventory: discover(snapshot),
		diagnostics: [],
		updatedAt: 1,
	};
}
const publication: Publication = {
	id: 'npm:one',
	manager: 'npm',
	name: 'one',
	version: '1.0.0',
	outcome: 'succeeded',
	required: true,
	digest: 'sha512-abc',
};

describe('repository configuration', () => {
	test('rejects unknown fields and automatic promotion', () => {
		expect(() => parseRepositoryConfiguration({ typo: true })).toThrow('unknown');
		expect(() => parseRepositoryConfiguration({ streams: { main: { promote: { approval: 'none' } } } })).toThrow(
			'approval',
		);
	});
	test('merges named objects and replaces arrays in preset order', async () => {
		const result = await resolveConfiguration(
			{
				extends: ['github>example/presets:base'],
				streams: { main: { required: ['npm'], channels: { prerelease: 'alpha' } } },
			},
			async () => ({
				sha: 'b'.repeat(40),
				value: {
					streams: {
						main: { required: ['cargo'], channels: { stable: 'stable', prerelease: 'next' } },
					},
				},
			}),
		);
		expect(result.configuration.streams.main?.required).toEqual(['npm']);
		expect(result.configuration.streams.main?.channels).toEqual({
			stable: 'stable',
			prerelease: 'alpha',
		});
		expect(result.presetShas['github>example/presets:base']).toBe('b'.repeat(40));
	});
	test('rejects cycles, invalid workflow paths and inherited unknown fields', async () => {
		await expect(
			resolveConfiguration({ extends: ['github>example/presets:base'] }, async () => ({
				sha: 'b'.repeat(40),
				value: { extends: ['github>example/presets:base'] },
			})),
		).rejects.toThrow('cycle');
		expect(() =>
			parseRepositoryConfiguration({
				streams: { main: { workflows: { publish: { file: '../release.yml' } } } },
			})
		).toThrow('filename');
		await expect(
			resolveConfiguration({ extends: ['github>example/presets:base'] }, async () => ({
				sha: 'b'.repeat(40),
				value: { typo: true },
			})),
		).rejects.toThrow('unknown');
	});
});
describe('ecosystem discovery and version planning', () => {
	test('discovers a seventh repository without hardcoded identities', () => {
		const inventory = discover(snapshot);
		expect(inventory.packages.map((p) => p.name).sort()).toEqual([
			'cli',
			'core',
			'one',
			'root',
			'two',
		]);
		expect(inventory.publicationOrder.indexOf('cargo:core')).toBeLessThan(
			inventory.publicationOrder.indexOf('cargo:cli'),
		);
		expect(inventory.publicationOrder.indexOf('npm:one')).toBeLessThan(
			inventory.publicationOrder.indexOf('npm:two'),
		);
		expect(inventory.workflows[0]?.dispatchInputs).toEqual(['beepboop_execution_id']);
		expect(
			parseRepositoryConfiguration(onboardingConfiguration(inventory)).streams.main?.workflows
				.release?.file,
		).toBe('release.yml');
	});
	test('updates inherited Cargo version and npm internal dependencies', () => {
		const plan = planRelease(snapshot, discover(snapshot), 'v1.1.0-alpha.1');
		expect(plan.edits.find((e) => e.path === 'Cargo.toml')?.after).toContain(
			'version = "1.1.0-alpha.1"',
		);
		expect(plan.edits.find((e) => e.path === 'Cargo.toml')?.after).toContain(
			'version = "1.1.0-alpha.1" }',
		);
		expect(
			JSON.parse(plan.edits.find((e) => e.path === 'packages/two/package.json')?.after ?? '{}')
				.dependencies.one,
		).toBe('^1.1.0-alpha.1');
		expect(plan.edits.some((e) => e.path === 'crates/cli/Cargo.toml')).toBe(false);
	});
	test('requires repository preparation for lockfiles', () => {
		const withLock = { ...snapshot, files: { ...snapshot.files, 'Cargo.lock': '' } };
		expect(planRelease(withLock, discover(withLock), '1.1.0').requiresPreparation).toBe(true);
	});
	test('detects publication dependency cycles', () => {
		const packages = discover(snapshot).packages.filter((p) => p.manager === 'cargo');
		const core = packages.find((p) => p.name === 'core');
		if (core) core.dependencies = ['cli'];
		expect(() => publicationOrder(packages)).toThrow('cycle');
	});
	test('supports independent npm stream selection', () => {
		const plan = planRelease(snapshot, discover(snapshot), '2.0.0', ['npm:one']);
		expect(plan.packages.map((p) => p.name)).toEqual(['one']);
		expect(plan.edits.map((e) => e.path)).toEqual([
			'packages/one/package.json',
			'packages/two/package.json',
		]);
		expect(
			JSON.parse(plan.edits.find((e) => e.path === 'packages/two/package.json')?.after ?? '{}')
				.version,
		).toBe('1.0.0');
	});
});
describe('execution contracts', () => {
	test('deduplicates event identity and snapshots configuration', async () => {
		const repo = repository(),
			execution = await createExecution(repo, 'main', 'publish', 'delivery-1');
		expect((await createExecution(repo, 'main', 'publish', 'delivery-1')).id).toBe(execution.id);
		if (repo.configuration?.streams.main) repo.configuration.streams.main.required = [];
		expect(execution.configuration.streams.main?.required).toEqual(['npm:one']);
	});
	test('required publications block premature completion', async () => {
		const execution = await createExecution(repository(), 'main', 'publish', 'event');
		expect(completion(execution, true)).toBe('blocked');
		execution.publications = [
			publication,
			{ ...publication, id: 'optional', required: false, outcome: 'failed' },
		];
		expect(completion(execution, true)).toBe('succeeded');
		expect(completion(execution, false)).toBe('failed');
	});
	test('retains successful results and rejects changed identities', () => {
		expect(
			mergePublications([publication], [{ ...publication, outcome: 'pending' }])[0]?.outcome,
		).toBe('succeeded');
		expect(() => mergePublications([publication], [{ ...publication, digest: 'sha512-other' }])).toThrow('identity');
	});
});
describe('publication verification and grants', () => {
	test('matches npm version and integrity', async () => {
		const request = async () => Response.json({ name: 'one', version: '1.0.0', dist: { integrity: 'sha512-abc' } });
		expect((await verifyPublication(publication, request)).outcome).toBe('succeeded');
		expect(
			(await verifyPublication({ ...publication, digest: 'sha512-other' }, request)).outcome,
		).toBe('failed');
	});
	test('distinguishes missing versions and registry failures', async () => {
		expect(
			(await verifyPublication(publication, async () => new Response(null, { status: 404 })))
				.outcome,
		).toBe('pending');
		expect(
			(await verifyPublication(publication, async () => new Response(null, { status: 503 })))
				.outcome,
		).toBe('uncertain');
	});
	test('requires explicit grant boundaries', () => {
		const grant = {
			id: 'npm-main',
			alias: 'npm',
			repositoryId: 91,
			repository: 'example/seventh',
			operation: 'publish',
			workflow: 'release.yml',
			ref: 'refs/heads/main',
			delivery: 'runtime',
		};
		expect(parseGrant(grant).repositoryId).toBe(91);
		expect(() => parseGrant({ ...grant, delivery: 'environment' })).toThrow('Secret name');
		expect(() => parseGrant({ ...grant, workflow: '../release.yml' })).toThrow('Invalid');
	});
});

describe('migration and orchestration contracts', () => {
	test('observes existing workflows without adding dispatch inputs', async () => {
		const repo = repository();
		if (!repo.configuration?.streams.main) throw Error('fixture');
		repo.configuration.streams.main.workflows.publish = {
			file: 'release.yml',
			mode: 'observe',
			ref: 'refs/tags/v*',
		};
		repo.inventory.workflows = repo.inventory.workflows.map((w) => ({
			...w,
			events: ['push'],
			dispatchInputs: [],
		}));
		expect((await createExecution(repo, 'main', 'publish', 'run:1', '1.0.0', true)).state).toBe(
			'pending',
		);
		await expect(createExecution(repo, 'main', 'publish', 'manual:1')).rejects.toThrow(
			'workflow_dispatch',
		);
	});
	test('rejects missing dependencies and cycles', () => {
		expect(() =>
			parseRepositoryConfiguration({
				streams: { main: { workflows: { a: { file: 'a.yml', needs: ['missing'] } } } },
			})
		).toThrow('Unknown dependency');
		expect(() =>
			parseRepositoryConfiguration({
				streams: {
					main: {
						workflows: { a: { file: 'a.yml', needs: ['b'] }, b: { file: 'b.yml', needs: ['a'] } },
					},
				},
			})
		).toThrow('cycle');
	});
	test('accepts UTC maintenance schedules and rejects second-level schedules', () => {
		const configuration = {
			streams: {
				maintenance: {
					versioning: 'none',
					workflows: { refresh: { file: 'refresh.yml', schedule: '17 6 * * *' } },
				},
			},
		};
		expect(
			parseRepositoryConfiguration(configuration).streams.maintenance?.workflows.refresh?.schedule,
		).toBe('17 6 * * *');
		configuration.streams.maintenance.workflows.refresh.schedule = '* * * * * *';
		expect(() => parseRepositoryConfiguration(configuration)).toThrow('five-field');
	});
	test('discovers generated npm targets and excludes experimental targets from required defaults', () => {
		const source = {
			...snapshot,
			files: {
				...snapshot.files,
				'packaging/npm/targets.json': JSON.stringify({
					scope: '@example',
					facade: 'example-cli',
					targets: [{ pkg: 'linux-x64' }, { pkg: 'freebsd-arm64', experimental: true }],
				}),
			},
		};
		const inventory = discover(source);
		expect(inventory.packages.find((p) => p.name === '@example/freebsd-arm64')?.optional).toBe(
			true,
		);
		expect(inventory.packages.find((p) => p.name === 'example-cli')?.dependencies).toEqual([
			'@example/linux-x64',
			'@example/freebsd-arm64',
		]);
		const config = parseRepositoryConfiguration(onboardingConfiguration(inventory));
		expect(config.streams.main?.required).toContain('npm:@example/linux-x64');
		expect(config.streams.main?.required).not.toContain('npm:@example/freebsd-arm64');
	});
	test('does not treat a VSCode extension as an npm publication', () => {
		const source = {
			...snapshot,
			files: {
				...snapshot.files,
				'extensions/editor/package.json': JSON.stringify({
					name: 'editor-extension',
					version: '1.0.0',
					engines: { vscode: '^1.0.0' },
				}),
			},
		};
		expect(discover(source).packages.find((p) => p.name === 'editor-extension')?.publish).toBe(
			false,
		);
	});
	test('OCI verifier checks manifest bytes and rejects arbitrary registries', async () => {
		const { verifyImage } = await import('#automation/oci');
		const content = '{"schemaVersion":2}';
		const digest = `sha256:${
			Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))),
				(b) => b.toString(16).padStart(2, '0'),
			).join('')
		}`;
		const image: Publication = {
			id: 'image',
			manager: 'oci',
			name: 'ghcr.io/example/image',
			version: '1.0.0',
			digest,
			outcome: 'pending',
			required: true,
		};
		expect(
			(
				await verifyImage(
					image,
					async () => new Response(content, { headers: { 'docker-content-digest': digest } }),
				)
			).outcome,
		).toBe('succeeded');
		expect(
			(
				await verifyImage({ ...image, name: 'attacker.invalid/example/image' }, async () => {
					throw Error('must not fetch');
				})
			).outcome,
		).toBe('failed');
		expect(
			(
				await verifyImage(
					image,
					async () => new Response('different', { headers: { 'docker-content-digest': digest } }),
				)
			).outcome,
		).toBe('failed');
	});
});

test('Cargo dependency constraints retain their operator and reject compound ranges', () => {
	for (const operator of ['^', '~', '=']) {
		const fixture = {
			...snapshot,
			files: {
				...snapshot.files,
				'Cargo.toml': (snapshot.files['Cargo.toml'] ?? '').replace(
					'version = "1.0.0" }',
					`version = "${operator}1.0.0" }`,
				),
			},
		};
		expect(
			planRelease(fixture, discover(fixture), '1.1.0').edits.find((e) => e.path === 'Cargo.toml')
				?.after,
		).toContain(`version = "${operator}1.1.0" }`);
	}
	const fixture = {
		...snapshot,
		files: {
			...snapshot.files,
			'Cargo.toml': (snapshot.files['Cargo.toml'] ?? '').replace(
				'version = "1.0.0" }',
				'version = ">=1.0.0, <2.0.0" }',
			),
		},
	};
	expect(() => planRelease(fixture, discover(fixture), '1.1.0')).toThrow('Cannot safely update');
});

test('preparation can delegate version edits to an existing workflow', () => {
	expect(
		parseRepositoryConfiguration({
			streams: { main: { prepare: { strategy: 'workflow', workflow: { file: 'prepare.yml' } } } },
		}).streams.main?.prepare.strategy,
	).toBe('workflow');
});
