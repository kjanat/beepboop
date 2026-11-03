import { describe, expect, test } from 'bun:test';
import schema from '@root/schemas/v1.json' with { type: 'json' };
import { edgeFetch } from '@root/test/edge-fetch';
import { managerNames, parseRepositoryConfiguration } from '@/automation/configuration';
import { RepositoryGateway } from '@/automation/github';
import {
	canVerifyPublication,
	discover,
	observedVersion,
	planRelease,
	resolvePublished,
	verifyPublication,
	versionsInFiles,
} from '@/automation/managers';
import { managerRegistry } from '@/automation/managers/builtins';
import { escapeModule, isGoPseudoVersion, splitModulePath } from '@/automation/managers/go';
import { directory } from '@/automation/managers/helpers';
import { latestTag, tagPrefix, tagQueries } from '@/automation/managers/tags';
import type { Publication, Snapshot } from '@/automation/types';

function repository(name: string, files: Record<string, string>, tags?: string[]): Snapshot {
	return {
		repository: { id: 5, name, defaultBranch: 'master' },
		sha: 'f'.repeat(40),
		files,
		...(tags ? { tags } : {}),
	};
}
function packages(snapshot: Snapshot, managers: Parameters<typeof discover>[1] = ['go', 'goreleaser']) {
	return discover(snapshot, managers).packages;
}

test('Go pseudo-versions are distinct from release tags', () => {
	expect(isGoPseudoVersion('2.0.0-20260102030405-012345abcdef')).toBe(true);
	expect(isGoPseudoVersion('v1.2.4-0.20260102030405-012345abcdef')).toBe(true);
	expect(isGoPseudoVersion('1.17.0')).toBe(false);
	expect(isGoPseudoVersion('2.0.0-rc.1')).toBe(false);
});

describe('go module discovery', () => {
	test('a root module takes its version from v tags', () => {
		const snapshot = repository('example/tool', {
			'go.mod':
				'module github.com/example/tool // comment\n\ngo 1.24\n\nrequire (\n\tgithub.com/example/tool/sub v0.1.0\n\tgolang.org/x/mod v0.20.0 // indirect\n)\nrequire gopkg.in/yaml.v3 v3.0.1\n',
		}, ['v1.2.0', 'v1.10.0-rc.1', 'v1.9.3', 'v2.0.0', 'v1.11.0+build', 'v1.12', 'vv1.13.0', 'sub/v4.0.0', 'release']);
		const [pkg] = packages(snapshot);
		expect(pkg).toEqual({
			manager: 'go',
			name: 'github.com/example/tool',
			version: '1.10.0-rc.1',
			manifest: 'go.mod',
			versionSource: 'tags:v',
			publish: true,
			dependencies: [],
		});
		expect(discover(snapshot, ['go']).managers).toEqual(['go']);
	});
	test('a module in a subdirectory takes its version from directory-prefixed tags', () => {
		const snapshot = repository('kjanat/gpg-signing-service', {
			'client/go.mod': 'module github.com/kjanat/gpg-signing-service/client\n',
		}, ['v1.2.0', 'client/v0.3.0', 'client/v0.4.0']);
		expect(packages(snapshot)).toEqual([{
			manager: 'go',
			name: 'github.com/kjanat/gpg-signing-service/client',
			version: '0.4.0',
			manifest: 'client/go.mod',
			versionSource: 'tags:client/v',
			publish: true,
			dependencies: [],
		}]);
	});
	test('an untagged module keeps no version', () => {
		const [pkg] = packages(repository('kjanat/gpg-signing-service', {
			'client/go.mod': 'module github.com/kjanat/gpg-signing-service/client\n',
		}, ['v1.0.1', 'v1.2.0']));
		expect(pkg?.version).toBeUndefined();
		expect(pkg?.publish).toBe(true);
		const [missing] = packages(repository('kjanat/gpg-signing-service', {
			'client/go.mod': 'module github.com/kjanat/gpg-signing-service/client\n',
		}));
		expect(missing?.version).toBeUndefined();
	});
	test('major version modules accept only their major from the major branch or a major subdirectory', () => {
		const tags = ['v1.9.0', 'v2.1.0', 'v3.0.0', 'tools/v2.3.0', 'tools/v1.0.0'];
		const branch = packages(repository('o/r', { 'go.mod': 'module github.com/o/r/v2\n' }, tags))[0];
		expect([branch?.version, branch?.versionSource, branch?.publish]).toEqual(['2.1.0', 'tags:v', true]);
		const subdirectory = packages(repository('o/r', { 'v3/go.mod': 'module github.com/o/r/v3\n' }, tags))[0];
		expect([subdirectory?.version, subdirectory?.versionSource, subdirectory?.publish]).toEqual([
			'3.0.0',
			'tags:v',
			true,
		]);
		const nested = packages(repository('o/r', { 'tools/v2/go.mod': 'module github.com/o/r/tools/v2\n' }, tags))[0];
		expect([nested?.version, nested?.versionSource, nested?.publish]).toEqual(['2.3.0', 'tags:tools/v', true]);
		const unreleased = packages(repository('o/r', { 'go.mod': 'module github.com/o/r/v4\n' }, tags))[0];
		expect([unreleased?.version, unreleased?.publish]).toEqual([undefined, true]);
	});
	test('modules outside the repository or at the wrong location do not publish', () => {
		const found = packages(repository('kjanat/actionlint', {
			'go.mod': 'module actionlint.kjanat.dev/v2\n',
			'analyzers/go.mod': 'module actionlint.kjanat.dev/v2/analyzers\n',
			'tools/plugin-contract/go.mod': 'module actionlint.kjanat.dev/tools/plugin-contract\n',
			'examples/plugin/go.mod': 'module example.com/plugin\n',
			'.github/actions/npm-packages/go.mod': 'module npm-packages\n',
			'fork/go.mod': 'module github.com/rhysd/actionlint/fork\n',
			'moved/go.mod': 'module github.com/kjanat/actionlint/elsewhere\n',
			'legacy/go.mod': 'module github.com/kjanat/actionlint/legacy/v1\n',
		}, ['v1.17.0', 'tools/plugin-contract/v0.2.0']));
		expect(Object.fromEntries(found.map(pkg => [pkg.name, [pkg.publish, pkg.version, pkg.versionSource]]))).toEqual({
			'npm-packages': [false, undefined, 'tags:.github/actions/npm-packages/v'],
			'actionlint.kjanat.dev/v2/analyzers': [false, undefined, 'tags:analyzers/v'],
			'example.com/plugin': [false, undefined, 'tags:examples/plugin/v'],
			'github.com/rhysd/actionlint/fork': [false, undefined, 'tags:fork/v'],
			'actionlint.kjanat.dev/v2': [true, undefined, 'tags:v'],
			'github.com/kjanat/actionlint/legacy/v1': [false, undefined, 'tags:legacy/v'],
			'github.com/kjanat/actionlint/elsewhere': [false, undefined, 'tags:moved/v'],
			'actionlint.kjanat.dev/tools/plugin-contract': [true, '0.2.0', 'tags:tools/plugin-contract/v'],
		});
	});
	test('vanity modules without a root module derive the repository root from their directory', () => {
		const found = packages(repository('o/r', {
			'sub/go.mod': 'module go.example.dev/r/sub\n',
			'lib/v2/go.mod': 'module go.example.dev/r/lib/v2\n',
			'v3/go.mod': 'module go.example.dev/r/v3\n',
			'other/go.mod': 'module go.example.dev/r/different\n',
		}, ['sub/v1.0.0', 'lib/v2.0.1', 'v3.1.0']));
		expect(Object.fromEntries(found.map(pkg => [pkg.name, [pkg.publish, pkg.version]]))).toEqual({
			'go.example.dev/r/lib/v2': [true, '2.0.1'],
			'go.example.dev/r/different': [false, undefined],
			'go.example.dev/r/sub': [true, '1.0.0'],
			'go.example.dev/r/v3': [true, '3.1.0'],
		});
	});
	test('module paths split their major version the way the go command does', () => {
		expect(splitModulePath('github.com/o/r')).toEqual({ prefix: 'github.com/o/r', majors: [0, 1] });
		expect(splitModulePath('github.com/o/r/v12')).toEqual({ prefix: 'github.com/o/r', majors: [12], suffix: 'v12' });
		expect(splitModulePath('gopkg.in/yaml.v3')).toEqual({ prefix: 'gopkg.in/yaml.v3', majors: [3] });
		expect(splitModulePath('github.com/o/r/v1')).toBeUndefined();
		expect(splitModulePath('github.com/o/r/v02')).toBeUndefined();
		expect(splitModulePath('github.com/o/r/v1.2')).toBeUndefined();
		expect(splitModulePath('local/module')).toBeUndefined();
		expect(splitModulePath('github.com//r')).toBeUndefined();
	});
	test('a quoted module path and in-repository requirements become dependencies', () => {
		const found = discover(
			repository('o/r', {
				'go.mod': 'module "github.com/o/r"\nrequire github.com/o/r/lib v1.0.0\n',
				'lib/go.mod': 'module `github.com/o/r/lib`\n',
			}),
			['go'],
		);
		expect(found.packages.map(pkg => [pkg.name, pkg.dependencies])).toEqual([
			['github.com/o/r', ['github.com/o/r/lib']],
			['github.com/o/r/lib', []],
		]);
		expect(found.publicationOrder).toEqual(['go:github.com/o/r/lib', 'go:github.com/o/r']);
	});
	test('a go.mod without a module directive is reported', () => {
		const found = discover(repository('o/r', { 'go.mod': 'go 1.24\n' }), ['go']);
		expect(found.packages).toEqual([]);
		expect(found.managers).toEqual([]);
		expect(found.diagnostics).toEqual(['go.mod: cannot safely discover configuration']);
	});
});

describe('goreleaser discovery', () => {
	test('a configuration names its project and takes its version from v tags', () => {
		const found = discover(
			repository('kjanat/actionlint', {
				'.goreleaser.yaml': 'version: 2\nproject_name: actionlint\nrelease:\n  draft: true\n',
				'go.mod': 'module actionlint.kjanat.dev/v2\n',
			}, ['v1', 'v1.16.1', 'v1.17.0', 'v1.17']),
			['goreleaser'],
		);
		expect(found.managers).toEqual(['goreleaser']);
		expect(found.packages).toEqual([{
			manager: 'goreleaser',
			name: 'actionlint',
			version: '1.17.0',
			manifest: '.goreleaser.yaml',
			versionSource: 'tags:v',
			publish: true,
			dependencies: [],
		}]);
	});
	test('the project name falls back like goreleaser does', () => {
		const name = (files: Record<string, string>, repositoryName = 'o/fallback') =>
			discover(repository(repositoryName, files), ['goreleaser']).packages.map(pkg => pkg.name);
		expect(name({ '.goreleaser.yml': 'builds: []\n', 'Cargo.toml': '[package]\nname = "crate"\n' })).toEqual([
			'crate',
		]);
		expect(name({ 'goreleaser.yml': 'release:\n  github:\n    name: from-github\n', 'Cargo.toml': '[workspace]\n' }))
			.toEqual(['from-github']);
		expect(name({ 'goreleaser.yaml': 'release:\n  gitlab:\n    name: from-gitlab\n', 'Cargo.toml': '[' })).toEqual([
			'from-gitlab',
		]);
		expect(name({ '.config/goreleaser.yaml': 'release:\n  gitea:\n    name: from-gitea\n' })).toEqual(['from-gitea']);
		expect(name({ '.goreleaser.yaml': 'version: 2\n', 'go.mod': 'module example.dev/tools/v2\n' })).toEqual(['v2']);
		expect(name({ '.goreleaser.yaml': 'version: 2\n' })).toEqual(['fallback']);
		const bare = discover(repository('bare', { '.goreleaser.yaml': 'version: 2\n' }), ['goreleaser']);
		expect(bare.packages).toEqual([]);
		expect(bare.diagnostics).toEqual(['.goreleaser.yaml: project_name cannot be derived']);
	});
	test('release.disable controls publication and an untagged project keeps no version', () => {
		const found = (disable: string) =>
			discover(repository('o/r', { '.goreleaser.yaml': `project_name: tool\nrelease:\n  disable: ${disable}\n` }), [
				'goreleaser',
			]);
		expect(found('true').packages[0]?.publish).toBe(false);
		expect(found('"true"').packages[0]?.publish).toBe(false);
		expect(found('false').packages[0]?.publish).toBe(true);
		const templated = found('"{{ .Env.SKIP }}"');
		expect(templated.packages[0]?.publish).toBe(true);
		expect(templated.packages[0]?.version).toBeUndefined();
		expect(templated.diagnostics).toEqual(['.goreleaser.yaml: release.disable is a template; publication assumed']);
	});
	test('invalid and nested configurations are handled', () => {
		const found = discover(
			repository('o/r', {
				'.goreleaser.yml': 'a: [',
				'sub/.goreleaser.yml': 'project_name: nested\n',
			}),
			['goreleaser'],
		);
		expect(found.packages).toEqual([]);
		expect(found.diagnostics).toEqual(['.goreleaser.yml: cannot safely discover configuration']);
	});
});

describe('tag version helpers', () => {
	test('tag queries cover every module and configuration with the fewest prefixes', () => {
		expect(tagQueries(['client/go.mod', 'package.json'])).toEqual(['client/']);
		expect(tagQueries(['tools/v2/go.mod', 'v3/go.mod', 'a/b/go.mod'])).toEqual(['']);
		expect(tagQueries(['tools/v2/go.mod', 'a/b/go.mod'])).toEqual(['a/b/', 'tools/']);
		expect(tagQueries(['.goreleaser.yaml', 'client/go.mod'])).toEqual(['']);
		expect(tagQueries(['Cargo.toml'])).toEqual([]);
	});
	test('latest tags compare semantically and ignore other prefixes', () => {
		expect(latestTag(['v1.9.0', 'v1.10.0', 'x/v9.0.0', 'v1.10.0-rc.1', 'bogus'], 'v')).toBe('1.10.0');
		expect(latestTag(['1.0.0', 'v2.0.0'], '')).toBe('2.0.0');
		expect(latestTag(['v1'], 'v')).toBeUndefined();
		expect(latestTag([], 'v')).toBeUndefined();
		expect(tagPrefix('tags:client/v')).toBe('client/v');
		expect(tagPrefix('go.mod#module')).toBeUndefined();
	});
});

describe('go and goreleaser publication', () => {
	const module: Publication = {
		id: 'go:github.com/BurntSushi/toml',
		manager: 'go',
		name: 'github.com/BurntSushi/toml',
		version: '1.3.2-RC',
		outcome: 'pending',
		required: true,
	};
	test('module paths escape uppercase letters for the proxy', async () => {
		expect(escapeModule('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml');
		const proxy = edgeFetch(() => Response.json({ Version: 'v1.3.2-RC', Origin: { Hash: 'a'.repeat(40) } }));
		const result = await verifyPublication(module, proxy.fetch);
		expect(proxy.urls).toEqual(['https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/v1.3.2-!r!c.info']);
		expect(result).toEqual({
			...module,
			outcome: 'succeeded',
			digest: 'a'.repeat(40),
			url: 'https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/v1.3.2-!r!c.info',
		});
	});
	test('module verification distinguishes missing, wrong and unavailable versions', async () => {
		const outcome = async (response: () => Response, publication = module) =>
			(await verifyPublication(publication, edgeFetch(response).fetch)).outcome;
		expect(await outcome(() => new Response('not found', { status: 404 }))).toBe('pending');
		expect(await outcome(() => new Response('gone', { status: 410 }))).toBe('pending');
		expect(await outcome(() => new Response(null, { status: 503 }))).toBe('uncertain');
		expect(await outcome(() => new Response('{', { status: 200 }))).toBe('uncertain');
		expect(await outcome(() => Response.json({ Version: 'v1.3.3' }))).toBe('failed');
		expect(await outcome(() => Response.json({ Version: 'v1.3.2-RC' }))).toBe('succeeded');
		expect(await outcome(() => Response.json({ Version: 'v1.3.2-RC' }), { ...module, digest: 'b'.repeat(40) })).toBe(
			'uncertain',
		);
		expect(
			await outcome(() => Response.json({ Version: 'v1.3.2-RC', Origin: { Hash: 'a'.repeat(40) } }), {
				...module,
				digest: 'b'.repeat(40),
			}),
		).toBe('failed');
	});
	const binary: Publication = {
		id: 'goreleaser:actionlint',
		manager: 'goreleaser',
		name: 'actionlint',
		version: '1.17.0',
		outcome: 'pending',
		required: true,
	};
	const release = (body: unknown) => {
		const paths: string[] = [];
		return {
			paths,
			context: {
				repository: 'kjanat/actionlint',
				github: async (path: string) => {
					paths.push(path);
					if (body instanceof Error) throw body;
					return body;
				},
			},
		};
	};
	const unexpected = async (): Promise<Response> => {
		throw new Error('Unexpected registry request');
	};
	test('goreleaser verification requires a published release with uploaded assets', async () => {
		expect(canVerifyPublication('goreleaser')).toBe(true);
		const published = release({
			tag_name: 'v1.17.0',
			draft: false,
			assets: [{ state: 'uploaded' }, { state: 'uploaded' }],
		});
		expect(await verifyPublication(binary, unexpected, published.context)).toEqual({
			...binary,
			outcome: 'succeeded',
			url: 'https://github.com/kjanat/actionlint/releases/tag/v1.17.0',
		});
		expect(published.paths).toEqual(['/repos/kjanat/actionlint/releases/tags/v1.17.0']);
		const outcome = async (body: unknown) =>
			(await verifyPublication(binary, unexpected, release(body).context)).outcome;
		expect(await outcome(null)).toBe('pending');
		expect(await outcome({ tag_name: 'v1.17.0', draft: true, assets: [{ state: 'uploaded' }] })).toBe('pending');
		expect(await outcome({ tag_name: 'v1.17.0', draft: false, assets: [] })).toBe('pending');
		expect(await outcome({ tag_name: 'v1.17.0', draft: false, assets: [{ state: 'starter' }] })).toBe('pending');
		expect(await outcome({ tag_name: 'v1.16.0', draft: false, assets: [{ state: 'uploaded' }] })).toBe('failed');
		expect(await outcome(new Error('GitHub HTTP 500'))).toBe('uncertain');
		expect((await verifyPublication(binary, unexpected)).outcome).toBe('uncertain');
	});
});

describe('published registry versions', () => {
	const snapshot = repository('kjanat/actionlint', {
		'Cargo.toml': '[package]\nname = "actionlint-extension-api"\nversion = "0.1.0"\n',
		'distribution/npm/facade/package.json': '{"name":"@kjanat/actionlint","version":"0.0.0"}',
		'package.json': '{"name":"actionlint","version":"0.0.0","private":true,"workspaces":["distribution/npm/*"]}',
		'go.mod': 'module actionlint.kjanat.dev/v2\n',
		'.goreleaser.yaml': 'project_name: actionlint\n',
	}, ['v1.17.0']);
	test('npm dist-tags and crates.io stable versions replace placeholder manifests', async () => {
		const registry = edgeFetch(url =>
			url.startsWith('https://registry.npmjs.org/')
				? Response.json({ latest: '1.17.0', next: '1.18.0-rc.1' })
				: url.startsWith('https://proxy.golang.org/')
				? Response.json({ Version: url.includes('/v2/') ? 'v2.0.0-20260102030405-012345abcdef' : 'v1.17.0' })
				: Response.json({ crate: { max_stable_version: '0.2.0', max_version: '0.3.0-alpha.1' } })
		);
		const inventory = await resolvePublished(discover(snapshot), registry.fetch);
		expect(registry.urls.sort()).toEqual([
			'https://crates.io/api/v1/crates/actionlint-extension-api',
			'https://proxy.golang.org/actionlint.kjanat.dev/@latest',
			'https://proxy.golang.org/actionlint.kjanat.dev/v2/@latest',
			'https://registry.npmjs.org/-/package/%40kjanat%2Factionlint/dist-tags',
		]);
		expect(
			Object.fromEntries(inventory.packages.map(pkg => [`${pkg.manager}:${pkg.name}`, [pkg.version, pkg.published]])),
		)
			.toEqual({
				'cargo:actionlint-extension-api': ['0.1.0', '0.2.0'],
				'npm:@kjanat/actionlint': ['0.0.0', '1.17.0'],
				'npm:actionlint': ['0.0.0', undefined],
				'goreleaser:actionlint': ['1.17.0', undefined],
				'go:actionlint.kjanat.dev/v2': [undefined, '2.0.0-20260102030405-012345abcdef'],
			});
		expect(inventory.diagnostics).toEqual([]);
	});
	test('Go discovery queries current and unversioned module paths without conflating versions', async () => {
		const registry = edgeFetch(url =>
			Response.json({ Version: url.includes('/v2/') ? 'v2.0.0-20260102030405-012345abcdef' : 'v1.17.0' })
		);
		const inventory = await resolvePublished(discover(snapshot, ['go']), registry.fetch);
		expect(inventory.packages[0]?.publicationStatus).toBe('published');
		expect(inventory.packages[0]?.published).toBe('2.0.0-20260102030405-012345abcdef');
		expect(inventory.packages[0]?.previousModule).toEqual({ name: 'actionlint.kjanat.dev', version: '1.17.0' });
		expect(inventory.packages[0]?.version).toBeUndefined();
	});
	test('Go lookup distinguishes absence, failure and wrong-major responses', async () => {
		for (const [status, expected] of [[404, 'missing'], [503, 'failed']] as const) {
			const inventory = await resolvePublished(discover(snapshot, ['go']), async () => new Response(null, { status }));
			expect(inventory.packages[0]?.publicationStatus).toBe(expected);
			expect(inventory.packages[0]?.published).toBeUndefined();
		}
		const inventory = await resolvePublished(
			discover(snapshot, ['go']),
			async () => Response.json({ Version: 'v1.17.0' }),
		);
		expect(inventory.packages[0]?.publicationStatus).toBe('failed');
		expect(inventory.packages[0]?.published).toBeUndefined();
		expect(inventory.packages[0]?.previousModule?.version).toBe('1.17.0');
	});
	test('Go proxy requests escape module case and skip non-publishable modules', async () => {
		const registry = edgeFetch(() => Response.json({ Version: 'v1.2.3' }));
		const inventory = await resolvePublished(
			discover(
				repository('o/r', {
					'go.mod': 'module Example.dev/Tool\n',
					'.github/tool/go.mod': 'module internal-tool\n',
				}),
				['go'],
			),
			registry.fetch,
		);
		expect(registry.urls).toEqual(['https://proxy.golang.org/!example.dev/!tool/@latest']);
		expect(inventory.packages.find(p => p.name === 'internal-tool')?.publicationStatus).toBe('unchecked');
	});

	test('crates with only prereleases report their newest version', async () => {
		const inventory = await resolvePublished(
			discover(snapshot, ['cargo']),
			edgeFetch(() => Response.json({ crate: { max_stable_version: null, max_version: '0.3.0-alpha.1' } })).fetch,
		);
		expect(inventory.packages[0]?.published).toBe('0.3.0-alpha.1');
	});
	test('missing packages, registry failures and invalid answers keep the manifest version', async () => {
		const inventory = await resolvePublished(
			discover(snapshot, ['cargo', 'npm']),
			async url => {
				if (String(url).startsWith('https://crates.io/')) return new Response(null, { status: 404 });
				return new Response(null, { status: 401 });
			},
		);
		expect(inventory.packages.map(pkg => pkg.published)).toEqual([undefined, undefined, undefined]);
		expect(inventory.diagnostics).toEqual([
			'cargo:actionlint-extension-api: HTTP 404 from https://crates.io/api/v1/crates/actionlint-extension-api',
			'npm:@kjanat/actionlint: HTTP 401 from https://registry.npmjs.org/-/package/%40kjanat%2Factionlint/dist-tags',
		]);
		const offline = await resolvePublished(discover(snapshot, ['npm']), async () => {
			throw new TypeError('fetch failed');
		});
		expect(offline.diagnostics).toEqual([
			'npm:@kjanat/actionlint: request failed from https://registry.npmjs.org/-/package/%40kjanat%2Factionlint/dist-tags',
		]);
		const invalid = await resolvePublished(discover(snapshot, ['npm']), async () => Response.json({ latest: 'x' }));
		expect(invalid.diagnostics).toEqual([
			'npm:@kjanat/actionlint: no valid version from https://registry.npmjs.org/-/package/%40kjanat%2Factionlint/dist-tags',
		]);
	});
	test('lookups run in parallel batches on the unbound fetch', async () => {
		const files: Record<string, string> = {
			'package.json': '{"name":"root","private":true,"version":"0.0.0","workspaces":["p/*"]}',
		};
		for (let i = 0; i < 10; i++) files[`p/${i}/package.json`] = `{"name":"pkg-${i}","version":"0.0.0"}`;
		let active = 0, peak = 0;
		const registry = edgeFetch(() => Response.json({ latest: '1.0.0' }));
		const inventory = await resolvePublished(discover(repository('o/r', files), ['npm']), async (input, init) => {
			active++;
			peak = Math.max(peak, active);
			await Bun.sleep(1);
			active--;
			return registry.fetch(input, init);
		});
		expect(registry.urls).toHaveLength(10);
		expect(peak).toBe(8);
		expect(inventory.packages.filter(pkg => pkg.published === '1.0.0')).toHaveLength(10);
	});
});

describe('tag-versioned release planning', () => {
	const snapshot = repository('o/r', {
		'go.mod': 'module github.com/o/r\n',
		'.goreleaser.yaml': 'project_name: tool\n',
	}, ['v1.4.0']);
	test('tag sources carry no file edits and bump from the latest tag', () => {
		const plan = planRelease(snapshot, discover(snapshot), { bump: 'minor' });
		expect(plan.version).toBe('1.5.0');
		expect(plan.edits).toEqual([]);
		expect(plan.packages.map(pkg => `${pkg.manager}:${pkg.name}`)).toEqual(['goreleaser:tool', 'go:github.com/o/r']);
		expect(() => planRelease(snapshot, discover(snapshot), { bump: 'minor' }, ['go:github.com/o/r'])).toThrow(
			'share a version source',
		);
	});
	test('an unreleased module needs an explicit first version', () => {
		const untagged = { ...snapshot, tags: [] };
		expect(() => planRelease(untagged, discover(untagged), { bump: 'patch' })).toThrow(
			'Select an explicit version for the first release',
		);
		expect(planRelease(untagged, discover(untagged), '0.1.0').version).toBe('0.1.0');
		const mixed = repository('o/r', {
			'go.mod': 'module github.com/o/r\n',
			'package.json': '{"name":"tool","version":"0.2.0"}',
		});
		expect(planRelease(mixed, discover(mixed), '0.3.0').edits.map(edit => edit.path)).toEqual(['package.json']);
		expect(() => planRelease(mixed, discover(mixed), '0.1.0')).toThrow('newer');
	});
});

describe('manager names', () => {
	test('the schema, parser and registry list the same managers', () => {
		expect([...schema.properties.managers.items.enum].sort()).toEqual([...managerNames].sort());
		expect([...managerRegistry.names()].sort()).toEqual([...managerNames].sort());
		expect(parseRepositoryConfiguration({ managers: ['go', 'goreleaser'] }).managers).toEqual(['go', 'goreleaser']);
		expect(() => parseRepositoryConfiguration({ managers: ['golang'] })).toThrow();
	});
});

describe('gateway tag discovery and verification', () => {
	class SnapshotGateway extends RepositoryGateway {
		requests: string[] = [];
		tokens = 0;
		constructor(private paths: string[]) {
			super({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' }, 1);
		}
		override async token() {
			this.tokens++;
			return 'fixture';
		}
		override async file(_name: string, path: string) {
			return path.endsWith('go.mod') ? `module github.com/kjanat/gpg-signing-service/${directory(path)}\n` : '';
		}
		override async call(path: string): Promise<unknown> {
			this.requests.push(path);
			if (path === '/repos/kjanat/gpg-signing-service') return { default_branch: 'master' };
			if (path.includes('/commits/')) return { sha: 'a'.repeat(40) };
			if (path.includes('/git/trees/')) {
				return { tree: this.paths.map(path => ({ type: 'blob', mode: '100644', path })) };
			}
			if (path.endsWith('/git/matching-refs/tags/client/')) {
				return [{ ref: 'refs/tags/client/v0.1.0' }, { ref: 'refs/tags/client/v0.2.0' }];
			}
			if (path.endsWith('/git/matching-refs/tags/odd%20dir/')) return null;
			if (path.endsWith('/releases/tags/v1.2.0')) return { tag_name: 'v1.2.0' };
			throw new Error(`Unexpected fixture request ${path}`);
		}
	}
	test('snapshots fetch go.mod files and tags for their prefixes', async () => {
		const gateway = new SnapshotGateway(['client/go.mod', 'odd dir/go.mod', 'vendor/x/go.mod', 'README.md']);
		const snapshot = await gateway.snapshot('kjanat/gpg-signing-service', 1);
		expect(Object.keys(snapshot.files).sort()).toEqual(['client/go.mod', 'odd dir/go.mod']);
		expect(snapshot.tags).toEqual(['client/v0.1.0', 'client/v0.2.0']);
		expect(gateway.requests.filter(path => path.includes('matching-refs')).sort()).toEqual([
			'/repos/kjanat/gpg-signing-service/git/matching-refs/tags/client/',
			'/repos/kjanat/gpg-signing-service/git/matching-refs/tags/odd%20dir/',
		]);
		expect(discover(snapshot, ['go']).packages[0]?.version).toBe('0.2.0');
	});
	test('snapshots without Go or goreleaser files skip tag requests', async () => {
		const gateway = new SnapshotGateway(['README.md']);
		const snapshot = await gateway.snapshot('kjanat/gpg-signing-service', 1);
		expect(snapshot.tags).toBeUndefined();
		expect(gateway.requests.some(path => path.includes('matching-refs'))).toBe(false);
	});
	test('verification contexts create one installation token on first use', async () => {
		const gateway = new SnapshotGateway([]);
		const context = gateway.verification('kjanat/gpg-signing-service', 1);
		expect(gateway.tokens).toBe(0);
		expect(context.repository).toBe('kjanat/gpg-signing-service');
		expect(await context.github('/repos/kjanat/gpg-signing-service/releases/tags/v1.2.0')).toEqual({
			tag_name: 'v1.2.0',
		});
		await context.github('/repos/kjanat/gpg-signing-service/releases/tags/v1.2.0');
		expect(gateway.tokens).toBe(1);
	});
});

describe('observed tag versions', () => {
	const snapshot = repository('o/r', {
		'go.mod': 'module github.com/o/r\n',
		'client/go.mod': 'module github.com/o/r/client\n',
		'package.json': '{"name":"tool","version":"0.0.0"}',
	});
	const found = discover(snapshot).packages;
	const version = (name: string, tag: string) => {
		const pkg = found.find(entry => entry.name === name);
		return pkg && observedVersion(pkg, tag);
	};
	test('tag-versioned packages take the observed tag when it carries their prefix', () => {
		expect(version('github.com/o/r', 'v1.2.0')).toBe('1.2.0');
		expect(version('github.com/o/r/client', 'v1.2.0')).toBeUndefined();
		expect(version('github.com/o/r/client', 'client/v0.3.0')).toBe('0.3.0');
		expect(version('tool', 'v1.2.0')).toBe('0.0.0');
	});
});

describe('file-versioned planning selection', () => {
	test('only file-versioned publishable packages select manifest edits', () => {
		const tagOnly = repository('o/r', { 'client/go.mod': 'module github.com/o/r/client\n' });
		expect(versionsInFiles(discover(tagOnly))).toBe(false);
		const mixed = repository('o/r', {
			'go.mod': 'module github.com/o/r\n',
			'package.json': '{"name":"a","version":"1.0.0"}',
		});
		expect(versionsInFiles(discover(mixed))).toBe(true);
		const privateOnly = repository('o/r', { 'package.json': '{"name":"a","version":"1.0.0","private":true}' });
		expect(versionsInFiles(discover(privateOnly))).toBe(false);
	});
});
