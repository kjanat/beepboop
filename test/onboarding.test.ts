import { describe, expect, test } from 'bun:test';
import schema from '@root/schemas/v1.json' with { type: 'json' };
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { formatJson } from '@/automation/json';
import { discover, resolvePublished } from '@/automation/managers';
import { onboardingBody, onboardingConfiguration, onboardingReferences } from '@/automation/onboarding';
import type { Snapshot } from '@/automation/types';

function repository(name: string, files: Record<string, string>, tags?: string[]): Snapshot {
	return {
		repository: { id: 7, name, defaultBranch: 'master' },
		sha: 'c'.repeat(40),
		files,
		...(tags ? { tags } : {}),
	};
}
function workflow(name: string, on: string, steps = '[{run: make}]'): string {
	return `name: ${name}\non:\n${on}\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps: ${steps}\n`;
}
function onboard(snapshot: Snapshot) {
	const inventory = discover(snapshot);
	return {
		configuration: onboardingConfiguration(snapshot, inventory),
		body: onboardingBody(snapshot, inventory),
	};
}
function ref(on: string): string | undefined {
	const snapshot = repository('example/refs', { '.github/workflows/release.yml': workflow('Release', on) });
	return onboardingConfiguration(snapshot, discover(snapshot)).streams.main.workflows.release?.ref;
}

const gpgSigningService = repository('kjanat/gpg-signing-service', {
	'package.json': '{"name":"gpg-signing-service","version":"1.2.0","private":true}\n',
	'client/go.mod': 'module github.com/kjanat/gpg-signing-service/client\n\ngo 1.26\n',
	'.github/workflows/ci.yml': workflow('CI', '  push:\n    branches: [master]'),
	'.github/workflows/release.yml': workflow(
		'Release',
		'  push:\n    tags: ["v*.*.*"]\n  workflow_dispatch:\n    inputs:\n      tag:\n        type: string\n        required: true',
		'\n      - uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64\n        with:\n          files: |\n            dist/gpg-sign-linux-amd64\n            dist/checksums.txt',
	),
}, ['v1.0.0', 'v1.0.1', 'v1.1.0', 'v1.1.1', 'v1.1.2', 'v1.2.0']);

describe('onboarding JSON formatting', () => {
	test('collapses the managers array of the gpg-signing-service onboarding file', () => {
		expect(formatJson({
			$schema: 'https://beepboop.kjanat.dev/schema/v1.json',
			managers: ['github-release', 'npm', 'workflow'],
			streams: {
				main: {
					versioning: 'workspace',
					prepare: { version: 'manual' },
					promote: { approval: 'required' },
					workflows: { release: { file: 'release.yml', mode: 'observe', ref: 'refs/tags/*' } },
					required: [],
				},
			},
		})).toBe(`{
  "$schema": "https://beepboop.kjanat.dev/schema/v1.json",
  "managers": ["github-release", "npm", "workflow"],
  "streams": {
    "main": {
      "versioning": "workspace",
      "prepare": {
        "version": "manual"
      },
      "promote": {
        "approval": "required"
      },
      "workflows": {
        "release": {
          "file": "release.yml",
          "mode": "observe",
          "ref": "refs/tags/*"
        }
      },
      "required": []
    }
  }
}
`);
	});
	test('inlines scalar arrays up to 80 columns including indent, key and comma', () => {
		expect(formatJson({ a: ['x'.repeat(69)] })).toBe(`{\n  "a": ["${'x'.repeat(69)}"]\n}\n`);
		expect(formatJson({ a: ['x'.repeat(70)] })).toBe(`{\n  "a": [\n    "${'x'.repeat(70)}"\n  ]\n}\n`);
		expect(formatJson({ a: ['x'.repeat(68)], b: 1 })).toBe(`{\n  "a": ["${'x'.repeat(68)}"],\n  "b": 1\n}\n`);
		expect(formatJson({ a: ['x'.repeat(69)], b: 1 })).toBe(
			`{\n  "a": [\n    "${'x'.repeat(69)}"\n  ],\n  "b": 1\n}\n`,
		);
		expect(formatJson([1, true, null, 'a'])).toBe('[1, true, null, "a"]\n');
	});
	test('expands objects and non-scalar arrays and keeps empty containers short', () => {
		expect(formatJson({})).toBe('{}\n');
		expect(formatJson([])).toBe('[]\n');
		expect(formatJson('text')).toBe('"text"\n');
		expect(formatJson({ skipped: undefined, items: [{ id: 'a' }, [1], {}, []] })).toBe(
			'{\n  "items": [\n    {\n      "id": "a"\n    },\n    [1],\n    {},\n    []\n  ]\n}\n',
		);
	});
});

describe('onboarding configuration', () => {
	test('describes the gpg-signing-service release workflow without unbacked claims', () => {
		const { configuration } = onboard(gpgSigningService);
		expect(formatJson(configuration)).toBe(`{
  "$schema": "https://beepboop.kjanat.dev/schema/v1.json",
  "managers": ["github-release", "go", "workflow"],
  "streams": {
    "main": {
      "versioning": "workspace",
      "versionSource": {
        "kind": "tags",
        "prefix": "v"
      },
      "prepare": {
        "version": "manual"
      },
      "workflows": {
        "release": {
          "file": "release.yml",
          "mode": "observe",
          "ref": "refs/tags/v*"
        }
      },
      "required": ["pkg:github/kjanat/gpg-signing-service"]
    }
  }
}
`);
		const parsed = parseRepositoryConfiguration(configuration);
		expect(parsed.managers).toEqual(['github-release', 'go', 'workflow']);
		expect(parsed.streams.main?.versionSource).toEqual({ kind: 'tags', prefix: 'v' });
	});
	test('narrows observation refs to the workflow triggers', () => {
		expect(ref('  release:\n    types: [published]\n  push:\n    tags: ["v*"]')).toBe('refs/tags/*');
		expect(ref('  push:\n    tags: ["v1.0.0"]')).toBe('refs/tags/v1.0.0');
		expect(ref('  push:\n    tags: ["v*", "v2-*", "!v0*"]')).toBe('refs/tags/v*');
		expect(ref('  push:\n    tags: ["v*", "release-*"]')).toBe('refs/tags/*');
		expect(ref('  push:\n    tags: ["..*"]')).toBe('refs/tags/*');
		expect(ref('  push:\n    branches: [main]')).toBe('refs/heads/main');
		expect(ref('  push:\n    branches: ["release/**"]')).toBe('refs/heads/release/*');
		expect(ref('  workflow_dispatch:')).toBeUndefined();
	});
	test('takes the tag version prefix only from one unambiguous wildcard pattern', () => {
		const prefix = (files: Record<string, string>) => {
			const snapshot = repository('example/prefix', files);
			return onboardingConfiguration(snapshot, discover(snapshot)).streams.main.versionSource;
		};
		expect(prefix({ '.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["*"]') })).toEqual({
			kind: 'tags',
			prefix: '',
		});
		expect(
			prefix({
				'.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["v*"]'),
				'.github/workflows/publish.yml': workflow('Publish', '  push:\n    tags: ["release-*"]'),
			}),
		).toBeUndefined();
		expect(prefix({ '.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["releases/v*"]') }))
			.toBeUndefined();
		expect(prefix({ '.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["v1.0.0"]') }))
			.toBeUndefined();
		expect(
			prefix({
				'package.json': '{"name":"tool","version":"1.0.0"}',
				'.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["v*"]'),
			}),
		).toBeUndefined();
	});
	test('chooses versioning from publishable versions and tag triggers', () => {
		const versioning = (files: Record<string, string>) => {
			const snapshot = repository('example/versions', files);
			return onboardingConfiguration(snapshot, discover(snapshot)).streams.main.versioning;
		};
		expect(versioning({ 'package.json': '{"name":"tool","version":"1.0.0"}' })).toBe('workspace');
		expect(
			versioning({
				'package.json': '{"name":"tool","version":"1.0.0","workspaces":["packages/*"]}',
				'packages/core/package.json': '{"name":"core","version":"2.0.0"}',
			}),
		).toBe('independent');
		expect(versioning({ 'package.json': '{"name":"site","version":"1.0.0","private":true}' })).toBe('none');
	});
	test('omits package managers that publish nothing and keeps the rest', () => {
		const snapshot = repository('example/mixed', {
			'Cargo.toml': '[package]\nname = "core"\nversion = "1.0.0"\n',
			'package.json': '{"name":"site","version":"1.0.0","private":true}',
		});
		const { configuration, body } = onboard(snapshot);
		expect(configuration.managers).toEqual(['cargo']);
		expect(configuration.streams.main.required).toEqual(['pkg:cargo/core']);
		expect(body).toContain('- `npm` is omitted. Its packages in `package.json` are unpublishable.');
		expect(body).toContain('  - `pkg:cargo/core` from `Cargo.toml`.');
		expect(body).toContain('Every publishable package carries version `1.0.0`.');
	});
	test('leaves GitHub release requirements of independent streams to review', () => {
		const files = {
			'package.json': '{"name":"tool","version":"1.0.0","workspaces":["packages/*"]}',
			'packages/core/package.json': '{"name":"core","version":"2.0.0"}',
		};
		const plain = onboard(repository('example/independent', files));
		expect(plain.configuration.streams.main.required).toEqual(['pkg:npm/tool', 'pkg:npm/core']);
		expect(plain.body).toContain('- Assign independently versioned packages to their release streams.');
		expect(plain.body).toContain('Publishable packages carry versions `1.0.0`, `2.0.0`.');
		expect(plain.body).not.toContain('creates a GitHub release');
		const released = onboard(repository('example/independent', {
			...files,
			'.github/workflows/release.yml': workflow('Release', '  workflow_dispatch:', '[{run: gh release create v1}]'),
		}));
		expect(released.configuration.streams.main.required).toEqual(['pkg:npm/tool', 'pkg:npm/core']);
		expect(released.body).toContain(
			'- `release.yml` creates a GitHub release. Add `pkg:github/example/independent` to the `publications` of the operation that publishes it.',
		);
	});
	test('reports an empty repository without inventing values', () => {
		const { configuration, body } = onboard(repository('example/empty', {
			'.github/workflows/ci.yml': workflow('CI', '  push:'),
		}));
		expect(configuration).toEqual({
			$schema: 'https://beepboop.kjanat.dev/schema/v1.json',
			managers: ['workflow'],
			streams: { main: { versioning: 'none', prepare: { version: 'manual' }, workflows: {}, required: [] } },
		});
		expect(onboardingConfiguration(repository('example/none', {}), discover(repository('example/none', {}))).managers)
			.toEqual([]);
		expect(body).toContain('No publishable package or tag trigger carries a version.');
		expect(body).toContain('  - No workflow name mentions publish, release, deploy or promote.');
		expect(body).toContain('  - Nothing publishable was found.');
		expect(onboardingBody(repository('example/none', {}), discover(repository('example/none', {})))).toContain(
			'Discovered at the inspected revision: none.',
		);
	});
});

describe('tag-versioned packages', () => {
	const goreleaser = 'version: 2\nproject_name: actionlint\nrelease:\n  draft: true\n';
	test('an actionlint-like repository requires its released goreleaser project and reviews its unreleased module', async () => {
		const snapshot = repository('kjanat/actionlint', {
			'.goreleaser.yaml': goreleaser,
			'go.mod': 'module actionlint.kjanat.dev/v2\n',
			'analyzers/go.mod': 'module actionlint.kjanat.dev/v2/analyzers\n',
			'package.json': '{"name":"actionlint","version":"0.0.0","private":true,"workspaces":["distribution/npm/*"]}',
			'distribution/npm/facade/package.json': '{"name":"@kjanat/actionlint","version":"0.0.0"}',
			'.github/workflows/release.yml': workflow('Release', '  release:\n    types: [published]'),
		}, ['v1', 'v1.16.1', 'v1.17', 'v1.17.0']);
		const inventory = await resolvePublished(discover(snapshot), async () => Response.json({ latest: '1.17.0' }));
		const configuration = onboardingConfiguration(snapshot, inventory);
		const body = onboardingBody(snapshot, inventory);
		expect(configuration.managers).toEqual(['github-release', 'go', 'goreleaser', 'npm', 'workflow']);
		expect(configuration.streams.main).toEqual({
			versioning: 'workspace',
			prepare: { version: 'manual' },
			workflows: { release: { file: 'release.yml', mode: 'observe', ref: 'refs/tags/*' } },
			required: ['pkg:npm/%40kjanat/actionlint', 'pkg:github/kjanat/actionlint'],
		});
		expect(body).toContain('| npm | @kjanat/actionlint | 1.17.0 (manifest 0.0.0) | yes |');
		expect(body).toContain('| goreleaser | actionlint | 1.17.0 | yes |');
		expect(body).toContain('| go | actionlint.kjanat.dev/v2/analyzers | unreleased | no |');
		expect(body).toContain('Released publishable packages carry version `1.17.0`.');
		expect(body).toContain(
			'- `pkg:golang/actionlint.kjanat.dev/v2` has no release tag starting with `v`. Add it to `streams.main.required` after its first tagged release.',
		);
	});
	test('released tag-versioned packages need a workflow on their tags', () => {
		const files = { '.goreleaser.yaml': goreleaser, 'tools/go.mod': 'module github.com/kjanat/actionlint/tools\n' };
		const tags = ['v1.17.0', 'tools/v0.2.0'];
		const covered = onboard(repository('kjanat/actionlint', {
			...files,
			'.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["v*", "tools/v*"]'),
		}, tags));
		expect(covered.configuration.streams.main.required).toEqual([
			'pkg:github/kjanat/actionlint',
			'pkg:golang/github.com/kjanat/actionlint/tools',
		]);
		const root = onboard(repository('kjanat/actionlint', {
			...files,
			'.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["*"]'),
		}, tags));
		expect(root.configuration.streams.main.required).toEqual(['pkg:github/kjanat/actionlint']);
		expect(root.body).toContain(
			'- `pkg:golang/github.com/kjanat/actionlint/tools` takes its version from tags starting with `tools/v`. No bound workflow runs on those tags.',
		);
		const deep = onboard(repository('kjanat/actionlint', {
			...files,
			'.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["**"]'),
		}, tags));
		expect(deep.configuration.streams.main.required).toEqual([
			'pkg:github/kjanat/actionlint',
			'pkg:golang/github.com/kjanat/actionlint/tools',
		]);
		const prefixed = onboard(repository('kjanat/actionlint', {
			...files,
			'.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["tools/v1.*"]'),
		}, tags));
		expect(prefixed.configuration.streams.main.required).toEqual(['pkg:golang/github.com/kjanat/actionlint/tools']);
	});
	test('the stream version source comes from package tags without a tag trigger', () => {
		const tagged = onboard(repository('o/r', { 'go.mod': 'module github.com/o/r\n' }, ['v0.4.0']));
		expect(tagged.configuration.streams.main.versionSource).toEqual({ kind: 'tags', prefix: 'v' });
		expect(tagged.body).toContain(
			'- `streams.main.versionSource` reads the current version from tags starting with `v`. The prefix comes from the tag versions of `pkg:golang/github.com/o/r`.',
		);
		expect(tagged.body).toContain('Every publishable package carries version `0.4.0`.');
		const untagged = onboard(repository('o/r', { 'go.mod': 'module github.com/o/r\n' }));
		expect(untagged.body).toContain('No publishable package has a release.');
		const nested = onboard(repository('o/r', { 'sub/go.mod': 'module github.com/o/r/sub\n' }));
		expect(nested.configuration.streams.main.versionSource).toBeUndefined();
	});
});

describe('workflow release discovery', () => {
	test('detects GitHub release creation from release actions and the gh CLI', () => {
		const creates = (steps: string) => {
			const snapshot = repository('example/release', {
				'.github/workflows/release.yml': workflow('Release', '  workflow_dispatch:', steps),
			});
			const inventory = discover(snapshot);
			return { flag: inventory.workflows[0]?.createsRelease, managers: inventory.managers };
		};
		expect(creates('[{uses: softprops/action-gh-release@v2}]')).toEqual({
			flag: true,
			managers: ['github-release', 'workflow'],
		});
		expect(creates('[{uses: ncipollo/release-action@v1}]').flag).toBe(true);
		expect(creates('[{run: gh release create "$TAG" dist/*}]').flag).toBe(true);
		expect(creates('[{run: gh pr list}]')).toEqual({ flag: undefined, managers: ['workflow'] });
		const reusable = repository('example/release', {
			'.github/workflows/release.yml':
				'name: Release\non: workflow_dispatch\njobs:\n  release:\n    uses: $/.github/workflows/build.yml\n',
		});
		expect(discover(reusable).workflows[0]?.createsRelease).toBeUndefined();
	});
	test('keeps tag and branch trigger patterns', () => {
		const snapshot = repository('example/patterns', {
			'.github/workflows/release.yml': workflow('Release', '  push:\n    tags: ["v*.*.*"]\n    branches: [main]'),
		});
		const [found] = discover(snapshot).workflows;
		expect(found?.tagPatterns).toEqual(['v*.*.*']);
		expect(found?.branchPatterns).toEqual(['main']);
	});
});

describe('onboarding pull request body', () => {
	test('links the schema and existing guide sections', async () => {
		const { configuration, body } = onboard(gpgSigningService);
		expect(onboardingReferences[0]?.url).toBe(configuration.$schema);
		expect(schema.$id).toBe(configuration.$schema);
		for (const reference of onboardingReferences) expect(body).toContain(`- ${reference.label}: ${reference.url}`);
		for (const reference of onboardingReferences.slice(1)) {
			const match = /\/blob\/master\/(docs\/[\w-]+\.md)#([\w-]+)$/.exec(reference.url);
			expect(match).not.toBeNull();
			const source = await Bun.file(new URL(`../${match?.[1]}`, import.meta.url)).text();
			const anchors = [...source.matchAll(/^#+ (.+)$/gm)].map(heading =>
				(heading[1] ?? '').toLowerCase().replace(/[^\w\- ]/g, '').replaceAll(' ', '-')
			);
			expect(anchors).toContain(match?.[2] ?? '');
		}
	});
	test('states which values came from which files and what remains for review', () => {
		const { body } = onboard(gpgSigningService);
		expect(body).toContain('- `npm` is omitted. Its packages in `package.json` are unpublishable.');
		expect(body).toContain('No publishable package has a release. Tag-triggered workflows carry the version.');
		expect(body).toContain('| go | github.com/kjanat/gpg-signing-service/client | unreleased | yes |');
		expect(body).toContain(
			'- `pkg:golang/github.com/kjanat/gpg-signing-service/client` has no release tag starting with `client/v`. Add it to `streams.main.required` after its first tagged release.',
		);
		expect(body).toContain(
			'- `streams.main.versionSource` reads the current version from tags starting with `v`. The prefix comes from `on.push.tags` in `release.yml`.',
		);
		expect(body).toContain('  - `release`: `release.yml`. `ref` `refs/tags/v*` covers `on.push.tags` `v*.*.*`.');
		expect(body).toContain('  - `pkg:github/kjanat/gpg-signing-service` from the release step in `release.yml`.');
		expect(body).toContain(
			'- `release.yml` also runs on `workflow_dispatch`. Those runs start on a branch and fall outside `refs/tags/v*`.',
		);
		expect(body).toContain('- Bind `promote.workflow` to gate releases on approval.');
		expect(body).toContain('Files attached to a GitHub release do not count.');
		expect(body).not.toContain('Assign independently versioned packages');
		const unfiltered = repository('example/manual', {
			'.github/workflows/release.yml': workflow('Release', '  workflow_dispatch:'),
		});
		expect(onboardingBody(unfiltered, discover(unfiltered))).toContain(
			'  - `release`: `release.yml`. It has no tag or branch filter. Default-branch runs count.',
		);
	});
});

test('private manifests without a version are discovered and explained in setup', () => {
	const snapshot = repository('kjanat/beepboop', {
		'package.json': '{"name":"beepboop","private":true,"bin":{"beepboop":"src/cli/cli.ts"}}',
	});
	const inventory = discover(snapshot);
	expect(inventory.managers).toContain('npm');
	expect(inventory.packages[0]).toMatchObject({
		name: 'beepboop',
		manifest: 'package.json',
		publish: false,
		identity: { type: 'npm', name: 'beepboop' },
	});
	expect(inventory.packages[0]?.version).toBeUndefined();
	expect(onboardingBody(snapshot, inventory)).toContain('beepboop');
	expect(onboardingConfiguration(snapshot, inventory).streams.main.required).toEqual([]);
});
