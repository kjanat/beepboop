import { expect, test } from 'bun:test';
import { widgetConfiguration } from '@root/test/support/repositories.ts';
import { Effect } from 'effect';
import { configurationSchema } from '@/domain/configuration/schema.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';
import { verifyPublication, verifySecondaryPublications } from '@/publication/registries/verify.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { plannedPublicationUrls } from '@/release/domain/publication-urls.ts';
import { referenceProbe } from '@/release/domain/reference-probe.ts';

type Target = Parameters<typeof plannedPublicationUrls>[0];
const run: Target = {
	repository: 'kjanat/git-remote-refs',
	version: '0.1.1',
	configuration: decodeSync(configurationSchema, JSON.parse(widgetConfiguration())),
	operation: 'promote',
	stream: 'main',
	publications: [],
};
const workflow: NonNullable<Execution['workflow']> = { ref: 'master', file: 'release.yml', inputs: {}, required: true };
const crate = 'pkg:cargo/git-remote-refs';
const crateUrl = 'https://crates.io/crates/git-remote-refs/0.1.1';
const release = 'github-release:kjanat/git-remote-refs';
const go = 'pkg:golang/github.com/kjanat/git-remote-refs/go';
const goUrl = 'https://pkg.go.dev/github.com/kjanat/git-remote-refs/go@v0.1.1';
const policy = { phase: 'version', prefix: 'v', aliases: [], signed: true } as const;

test('the selected publication owns the environment link even when the workflow also publishes version tags', () => {
	const refs = { ...policy, aliases: [] };
	const tagged = {
		...run,
		operation: 'github-release',
		moduleTags: [{ id: go, prefix: 'go/v' }],
		workflow: { ...workflow, refs, publications: [release] },
	};
	const github = 'https://github.com/kjanat/git-remote-refs/releases/tag/v0.1.1';
	const tag = 'https://github.com/kjanat/git-remote-refs/tree/v0.1.1';
	expect(plannedPublicationUrls(tagged)).toEqual({
		publicationUrl: github,
		publicationUrls: { [release]: github, 'refs:github-release': tag, [go]: goUrl },
	});
	expect(plannedPublicationUrls({ ...tagged, workflow: { ...workflow, refs, publications: [go] } })).toEqual({
		publicationUrl: goUrl,
		publicationUrls: { [go]: goUrl, 'refs:github-release': tag },
	});
	expect(plannedPublicationUrls({ ...run, workflow: { ...workflow, publications: [crate] } })).toEqual({
		publicationUrl: crateUrl,
		publicationUrls: { [crate]: crateUrl },
	});
});

test('unknown and multiple destinations do not accidentally promote the first link to the environment URL', () => {
	for (const id of [go, 'workflow:smoke']) {
		expect(plannedPublicationUrls({ ...run, workflow: { ...workflow, publications: [crate, id] } })).toEqual({
			publicationUrls: { [crate]: crateUrl, ...(id === go ? { [go]: goUrl } : {}) },
		});
	}
	expect(plannedPublicationUrls({ ...run, workflow })).toEqual({ publicationUrls: {} });
	const { version: _version, ...unversioned } = run;
	expect(plannedPublicationUrls({ ...unversioned, workflow: { ...workflow, publications: [crate] } })).toEqual({
		publicationUrls: {},
	});
});

test('tag prefixes including the empty prefix use the frozen execution policy', () => {
	for (const prefix of ['', 'cli/v']) {
		const refs = { ...policy, aliases: [], prefix };
		const github = `https://github.com/kjanat/git-remote-refs/releases/tag/${prefix}0.1.1`;
		const tag = `https://github.com/kjanat/git-remote-refs/tree/${prefix}0.1.1`;
		expect(plannedPublicationUrls({ ...run, workflow: { ...workflow, refs, publications: [release] } })).toEqual({
			publicationUrls: { [release]: github, 'refs:promote': tag },
			publicationUrl: github,
		});
		expect(plannedPublicationUrls({ ...run, workflow: { ...workflow, refs } })).toEqual({
			publicationUrls: { 'refs:promote': tag },
			publicationUrl: tag,
		});
	}
});

test('package binding selection survives old report IDs and uses the recorded version', () => {
	const published = {
		id: 'cargo:git-remote-refs',
		manager: 'cargo',
		name: 'git-remote-refs',
		version: '0.1.0',
		outcome: 'succeeded',
		required: true,
		url: 'https://index.crates.io/gi/t-/git-remote-refs',
	} as const;
	const execution = { ...run, workflow: { ...workflow, publications: [crate] }, publications: [published] };
	const previousUrl = 'https://crates.io/crates/git-remote-refs/0.1.0';
	expect(plannedPublicationUrls(execution)).toEqual({
		publicationUrls: { [crate]: previousUrl },
		publicationUrl: previousUrl,
	});
	expect(plannedPublicationUrls({ ...run, package: { id: crate, manager: 'cargo' } })).toEqual({
		publicationUrls: { [crate]: crateUrl },
		publicationUrl: crateUrl,
	});
});

test('only declared public registry and manifest pages become destinations', () => {
	const cases: [string, string | undefined][] = [
		['pkg:generic/pypi/widget', 'https://pypi.org/project/widget/0.1.1/'],
		['pkg:npm/widget?repository_url=https%3A%2F%2Fregistry.example.com', undefined],
		[
			'pkg:vscode-extension/octo/widget?repository_url=https%3A%2F%2Fopen-vsx.org',
			'https://open-vsx.org/extension/octo/widget/0.1.1',
		],
		['manifest:octo/bucket/bucket/widget.json', 'https://github.com/octo/bucket/blob/HEAD/bucket/widget.json'],
		['manifest:octo/tap/Formula/tool.rb', 'https://github.com/octo/tap/blob/HEAD/Formula/tool.rb'],
		['manifest:octo/tap/../tool.rb', undefined],
		['manifest:octo/tap/install.sh', undefined],
		['github-release:elsewhere/tool', undefined],
		['pkg:github/elsewhere/tool@v2.0.0', 'https://github.com/elsewhere/tool/releases/tag/v2.0.0'],
	];
	for (const [id, url] of cases) {
		expect(plannedPublicationUrls({ ...run, workflow: { ...workflow, publications: [id] } })).toEqual(
			url ? { publicationUrls: { [id]: url }, publicationUrl: url } : { publicationUrls: {} },
		);
	}
});

test('a per-package execution only selects its assigned package from a broad binding', () => {
	for (const publications of [[crate, go], [crate]]) {
		expect(plannedPublicationUrls({
			...run,
			workflow: { ...workflow, publications },
			package: { id: go, manager: 'go' },
		})).toEqual({ publicationUrls: { [go]: goUrl }, publicationUrl: goUrl });
	}
});

test('an explicitly selected ref uses the same alias as the workflow for a release with build metadata', () => {
	const id = 'refs:promote';
	const refs = { ...policy, phase: 'aliases' as const, aliases: ['minor' as const], prefix: 'cli/v' };
	const execution = { ...run, version: '2.10.0+ci.9', workflow: { ...workflow, refs, publications: [id] } };
	const url = 'https://github.com/kjanat/git-remote-refs/tree/cli/v2.10';
	expect(plannedPublicationUrls(execution)).toEqual({ publicationUrl: url, publicationUrls: { [id]: url } });
	expect(plannedPublicationUrls({ ...execution, version: '2.10.0-rc.1' })).toEqual({ publicationUrls: {} });
});

test('registry matching normalizes the origin and preserves the registry path', () => {
	for (
		const [registry, known] of [
			['HTTPS://Open-VSX.Org:443/', true],
			['https://open-vsx.org/Custom', false],
		] as const
	) {
		const id = 'pkg:vscode-extension/octo/widget?repository_url=' + encodeURIComponent(registry);
		const url = 'https://open-vsx.org/extension/octo/widget/0.1.1';
		expect(plannedPublicationUrls({ ...run, workflow: { ...workflow, publications: [id] } })).toEqual(
			known ? { publicationUrls: { [id]: url }, publicationUrl: url } : { publicationUrls: {} },
		);
	}
});

test('planning and recovery agree on the selected version and registry', async () => {
	for (
		const [id, page, endpoint] of [
			[
				'pkg:generic/pypi/widget@1.2.3',
				'https://pypi.org/project/widget/1.2.3/',
				'https://pypi.org/pypi/widget/1.2.3/json',
			],
			[
				'pkg:vscode-extension/octo/widget@1.2.3?repository_url=https%3A%2F%2Fopen-vsx.org',
				'https://open-vsx.org/extension/octo/widget/1.2.3',
				'https://open-vsx.org/api/octo/widget/1.2.3',
			],
			['pkg:npm/widget@1.2.3?repository_url=https%3A%2F%2Fexample.org', undefined, undefined],
		] as const
	) {
		const planned = plannedPublicationUrls({ ...run, workflow: { ...workflow, publications: [id] } });
		expect(planned.publicationUrl).toBe(page);
		const probe = referenceProbe(id, '2.0.0');
		if (!probe) throw new Error('Expected a recovery probe for ' + id);
		expect(probe.version).toBe('1.2.3');
		expect(probe.identity?.version).toBe('1.2.3');
		const requests: string[] = [];
		const fetcher = async (input: RequestInfo | URL) => {
			requests.push(String(input));
			return new Response(null, { status: 404 });
		};
		const outcome = await Effect.runPromise(verifyPublication(probe, fetcher));
		expect(outcome._tag).toBe(endpoint ? 'Pending' : 'Unverifiable');
		expect(await Effect.runPromise(verifySecondaryPublications(probe, fetcher))).toEqual([]);
		expect(requests).toEqual(endpoint ? [endpoint] : []);
	}
});

test('tag-triggered Cargo links use the crate version', () => {
	const id = 'pkg:cargo/widget';
	const url = 'https://crates.io/crates/widget/1.2.3-beta.1';
	expect(plannedPublicationUrls({ ...run, version: 'v1.2.3-beta.1', workflow: { ...workflow, publications: [id] } }))
		.toEqual({ publicationUrls: { [id]: url }, publicationUrl: url });
});

test('publish selects all stream packages even when only one is required', () => {
	const configuration = structuredClone(run.configuration);
	const stream = configuration.streams.main;
	if (!stream) throw new Error('Expected main stream');
	stream.packages = [crate, 'pkg:npm/widget'];
	stream.required = [crate];
	const publish = { ...run, operation: 'publish', configuration };
	expect(plannedPublicationUrls(publish)).toEqual({
		publicationUrls: { [crate]: crateUrl, 'pkg:npm/widget': 'https://npm.im/package/widget/v/0.1.1' },
	});
	expect(plannedPublicationUrls({ ...publish, workflow: { ...workflow, publications: [crate] } }))
		.toEqual({ publicationUrls: { [crate]: crateUrl }, publicationUrl: crateUrl });
});
