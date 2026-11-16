import { expect, setSystemTime, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repository } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import {
	ciWorkflow,
	jsonFile,
	licenseText,
	npmManifest,
	passChecks,
	publishWorkflow,
} from '@root/test/support/repositories.ts';
import type { SigningKey } from '@root/test/support/signing.ts';
import { fakeSigner, signingKey } from '@root/test/support/signing.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Fiber, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { excluded, registry } from '@/automation/package-publication';
import type { PackageTagRow } from '@/automation/package-tags';
import {
	packageTagBase,
	packageTagBudget,
	packageTagGroups,
	packageTagPage,
	packageTagPages,
	packageTagRows,
	packageTagWindow,
	taggedReleases,
} from '@/automation/package-tags';
import type { Inventory, Package } from '@/automation/types';
import type { PackageTagView } from '@/contract/views';
import { packageTagPage as pageSchema } from '@/contract/views';
import { configurationDrift, configurationSchema } from '@/domain/configuration';
import { validateAgainst } from '@/domain/validate';
import { storedConfiguration } from '@/persistence/codecs/configuration';
import { decodeSync } from '@/schema';

let world: World;
eachWorld(created => {
	world = created;
});

const commit = 'a'.repeat(40), other = 'b'.repeat(40), oid = 'c'.repeat(40);

function configuration(packageTags: string[]) {
	return jsonFile({
		$schema: 'https://beepboop.kjanat.dev/schema/v1.json',
		managers: ['npm', 'workflow'],
		streams: {
			main: {
				packages: ['pkg:npm/widget'],
				packageTags,
				required: ['pkg:npm/widget'],
				credentials: ['npm-token'],
				prepare: { strategy: 'managed' },
				promote: {
					approval: 'required',
					workflow: {
						file: 'publish.yml',
						publications: ['pkg:npm/widget'],
						refs: { phase: 'version', prefix: 'v', signed: true },
					},
				},
			},
		},
	}, '\t');
}

async function released(packageTags = ['pkg:npm/widget'], fields: Record<string, unknown> = {}) {
	const repository = world.github.create('octo/widget', {
		'package.json': npmManifest('widget', '1.0.0', fields),
		'README.md': '# widget\n',
		LICENSE: licenseText,
		'.github/workflows/publish.yml': publishWorkflow,
		'.github/workflows/ci.yml': ciWorkflow,
		'.github/beepboop.json': configuration(packageTags),
	});
	const first = world.github.head(repository);
	passChecks(repository, first);
	const second = world.github.push(repository, { 'README.md': '# widget\n\nUsage.\n' }, 'Document usage').sha;
	passChecks(repository, second);
	world.github.recordTag(repository, 'v0.9.0', '1'.repeat(40), first, true);
	world.github.recordTag(repository, 'v1.0.0', '2'.repeat(40), second, true);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	const tags = async (apply: boolean) => {
		const results: PackageTagView[] = [];
		let after: string | undefined;
		do {
			const reply = await api('/api/repositories/package-tags', {
				repositoryId: repository.id,
				stream: 'main',
				apply,
				...(after === undefined ? {} : { after }),
			});
			expect(reply.status).toBe(200);
			const page = decodeSync(pageSchema, reply.body);
			results.push(...page.results);
			after = page.next;
		} while (after !== undefined);
		return results;
	};
	return { repository, first, second, api, tags };
}

function verifies(key: SigningKey, raw: string): boolean {
	const dir = mkdtempSync(join(tmpdir(), 'beepboop-package-tag-'));
	try {
		spawnSync('git', ['init', '-q'], { cwd: dir });
		const written = spawnSync('git', ['hash-object', '-t', 'tag', '-w', '--stdin', '--literally'], {
			cwd: dir,
			input: raw,
			encoding: 'utf8',
		});
		return key.verifies(dir, written.stdout.trim());
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function tagObject(repository: Repository, name: string) {
	const ref = repository.refs.get(`tags/${name}`);
	return ref === undefined ? undefined : repository.tagObjects.get(ref);
}

function discovered(manager: 'cargo' | 'npm', name: string): Package {
	return {
		manager,
		name,
		version: '1.0.0',
		manifest: `${name}/${manager === 'npm' ? 'package.json' : 'Cargo.toml'}`,
		versionSource: 'manifest:',
		publication: registry,
		dependencies: [],
	};
}
const discoveredPackages = [
	discovered('cargo', 'tree-sitter-svg'),
	discovered('npm', 'tree-sitter-svg'),
	discovered('cargo', 'svg-data'),
	discovered('cargo', 'svg-tree'),
	discovered('npm', '@kjanat/svg-toolkit'),
];

test('a package tag joins an npm scope to the name the way npm pack names its archive', () => {
	expect(packageTagBase('@kjanat/svg-toolkit')).toBe('kjanat-svg-toolkit');
	expect(packageTagBase('svg-data')).toBe('svg-data');
	expect(
		packageTagGroups(
			['pkg:cargo/tree-sitter-svg', 'pkg:npm/tree-sitter-svg', 'pkg:cargo/svg-data', 'npm:@kjanat/svg-toolkit'],
			'v',
			discoveredPackages,
		).map(group => ({ prefix: group.prefix, references: group.references })),
	).toEqual([
		{ prefix: 'tree-sitter-svg-v', references: ['pkg:cargo/tree-sitter-svg', 'pkg:npm/tree-sitter-svg'] },
		{ prefix: 'svg-data-v', references: ['pkg:cargo/svg-data'] },
		{ prefix: 'kjanat-svg-toolkit-v', references: ['npm:@kjanat/svg-toolkit'] },
	]);
	expect(packageTagGroups(['pkg:cargo/missing'], 'v', discoveredPackages)).toEqual([]);
});

test('package tag rows cover each released version and keep tags on another commit apart', () => {
	const refs = [
		{ name: 'v1.0.0', oid, commit },
		{ name: 'v1', oid, commit },
		{ name: 'svg-data-v1.0.0', oid, commit: other },
		{ name: 'v1.1.0', oid, commit: other },
		{ name: 'svg-data-v1.1.0', oid, commit: other },
	];
	const releases = taggedReleases('v', refs);
	expect(releases).toEqual([{ version: '1.0.0', commit }, { version: '1.1.0', commit: other }]);
	expect(
		packageTagRows(
			packageTagGroups(['pkg:cargo/svg-data', 'pkg:cargo/svg-tree'], 'v', discoveredPackages),
			releases,
			refs,
		).map(
			row => [row.tag, row.state, row.target],
		),
	).toEqual([
		['svg-data-v1.0.0', 'conflict', other],
		['svg-tree-v1.0.0', 'missing', undefined],
		['svg-data-v1.1.0', 'exists', undefined],
		['svg-tree-v1.1.0', 'missing', undefined],
	]);
});

test('a backfill creates signed tags only for the versions each package published', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		const signer = fakeSigner(key);
		world.env.SIGNER = signer;
		const { repository, first, second, tags } = await released();
		expect(await tags(false)).toEqual([
			{ tag: 'widget-v0.9.0', version: '0.9.0', commit: first, outcome: 'unpublished' },
			{ tag: 'widget-v1.0.0', version: '1.0.0', commit: second, outcome: 'publishable' },
		]);
		expect([repository.refs.has('tags/widget-v1.0.0'), signer.calls]).toEqual([false, []]);
		expect(await tags(true)).toEqual([
			{ tag: 'widget-v0.9.0', version: '0.9.0', commit: first, outcome: 'unpublished' },
			{ tag: 'widget-v1.0.0', version: '1.0.0', commit: second, outcome: 'created' },
		]);
		const created = tagObject(repository, 'widget-v1.0.0');
		expect([created?.name, created?.commit, created?.verified]).toEqual(['widget-v1.0.0', second, true]);
		expect(signer.calls).toEqual([{
			data: expect.stringMatching(
				new RegExp(
					`^object ${second}\\ntype commit\\ntag widget-v1\\.0\\.0\\ntagger Release Bot \\(CI\\) <release@example\\.com> \\d+ \\+0000\\n\\nwidget-v1\\.0\\.0\\n$`,
				),
			),
			caller: 'beepboop:octo/widget',
		}]);
		expect(verifies(key, created?.raw ?? '')).toBe(true);
		expect(world.github.tokenPermissions).toContainEqual({ contents: 'write', workflows: 'write' });
		expect(await tags(true)).toEqual([
			{ tag: 'widget-v0.9.0', version: '0.9.0', commit: first, outcome: 'unpublished' },
			{ tag: 'widget-v1.0.0', version: '1.0.0', commit: second, outcome: 'exists' },
		]);
		expect(signer.calls.length).toBe(1);
	} finally {
		key.dispose();
	}
}, 30_000);

test('a backfill never moves a package tag that targets another commit', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key);
		const { repository, first, second, tags } = await released();
		world.github.recordTag(repository, 'widget-v1.0.0', '3'.repeat(40), first, true);
		expect(await tags(true)).toEqual([
			{ tag: 'widget-v0.9.0', version: '0.9.0', commit: first, outcome: 'unpublished' },
			{
				tag: 'widget-v1.0.0',
				version: '1.0.0',
				commit: second,
				outcome: 'conflict',
				reason: `widget-v1.0.0 already targets ${first.slice(0, 12)}`,
			},
		]);
		expect(repository.refs.get('tags/widget-v1.0.0')).toBe('3'.repeat(40));
	} finally {
		key.dispose();
	}
}, 30_000);

test('a backfill without the tag signer creates no tag', async () => {
	const { repository, second, tags } = await released();
	expect(await tags(true)).toContainEqual({
		tag: 'widget-v1.0.0',
		version: '1.0.0',
		commit: second,
		outcome: 'failed',
		reason: 'Package tags need the tag signer',
	});
	expect(repository.refs.has('tags/widget-v1.0.0')).toBe(false);
}, 30_000);

test('a backfill refuses a stream without packageTags', async () => {
	const { repository, api } = await released([]);
	const refused = await api('/api/repositories/package-tags', {
		repositoryId: repository.id,
		stream: 'main',
		apply: false,
	});
	expect([refused.status, decodeSync(Schema.Struct({ error: Schema.String }), refused.body).error]).toEqual([
		422,
		'Stream main names no packageTags',
	]);
}, 30_000);

const widgetPackage: Package = {
	manager: 'npm',
	name: 'widget',
	version: '1.0.0',
	manifest: 'package.json',
	versionSource: 'manifest:package.json',
	publication: registry,
	dependencies: [],
};
const gadgetPackage: Package = { ...widgetPackage, name: 'gadget', manifest: 'gadget/package.json' };
const secretPackage: Package = {
	...widgetPackage,
	name: 'secret',
	manifest: 'secret/package.json',
	publication: excluded('private'),
};
const paths = { paths: ['.github/workflows/publish.yml', '.github/workflows/ci.yml'] };

test('packageTags survive parsing, storage and drift checks', () => {
	const document = JSON.parse(configuration(['pkg:npm/widget']));
	const parsed = decodeSync(configurationSchema, document);
	expect(parsed.streams.main?.packageTags).toEqual(['pkg:npm/widget']);
	const repository = parseRepositoryConfiguration(document);
	if (Result.isFailure(repository)) throw repository.failure;
	expect(repository.success.streams.main?.packageTags).toEqual(['pkg:npm/widget']);
	expect(configurationDrift(document, repository.success)).toEqual([]);
	const encoded = JSON.stringify(parsed);
	expect(JSON.stringify(decodeSync(storedConfiguration, JSON.parse(encoded)))).toBe(encoded);
	document.streams.main.packageTags = 'pkg:npm/widget';
	expect(Result.isFailure(parseRepositoryConfiguration(document))).toBe(true);
});

test('validation blocks packageTags outside the stream packages or its registry and warns without a version tag', () => {
	const inventory: Inventory = {
		packages: [widgetPackage, gadgetPackage, secretPackage],
		workflows: [],
		managers: ['npm'],
		diagnostics: [],
		publicationOrder: [],
	};
	const document = JSON.parse(
		configuration(['pkg:npm/widget', 'pkg:npm/gadget', 'pkg:npm/secret', 'pkg:npm/missing']),
	);
	const found = (value: unknown) =>
		validateAgainst(decodeSync(configurationSchema, value), inventory, paths)
			.filter(entry => entry.message.includes('packageTags') || entry.code === 'package-tag')
			.map(entry => [entry.severity, entry.code, entry.message]);
	expect(found(document)).toEqual([
		['blocking', 'package-tag', 'Stream main packageTags names pkg:npm/gadget, which is not one of its packages'],
		[
			'blocking',
			'package-tag',
			'Stream main packageTags names pkg:npm/secret, which does not publish to its public registry',
		],
		['blocking', 'unknown-reference', 'Stream main packageTags names pkg:npm/missing, which discovery did not find'],
	]);
	document.streams.main.packageTags = ['pkg:npm/widget'];
	delete document.streams.main.promote.workflow.refs;
	expect(found(document)).toEqual([
		['warning', 'package-tag', 'Stream main pushes no version tag, so Beepboop creates no package tags for it'],
	]);
});

test('a tag GitHub cannot verify gets no ref', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key);
		world.github.verifiesTags = false;
		const { repository, second, tags } = await released();
		expect(await tags(true)).toContainEqual({
			tag: 'widget-v1.0.0',
			version: '1.0.0',
			commit: second,
			outcome: 'failed',
			reason: 'GitHub did not verify the signature of widget-v1.0.0 (unsigned)',
		});
		expect(repository.refs.has('tags/widget-v1.0.0')).toBe(false);
	} finally {
		key.dispose();
	}
}, 30_000);

test('a signing key without a name and email creates no tag', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key, { userId: 'release bot' });
		const { repository, second, tags } = await released();
		expect(await tags(true)).toContainEqual({
			tag: 'widget-v1.0.0',
			version: '1.0.0',
			commit: second,
			outcome: 'failed',
			reason: 'The signing key needs a user ID with a name and email',
		});
		expect(repository.refs.has('tags/widget-v1.0.0')).toBe(false);
	} finally {
		key.dispose();
	}
}, 30_000);

test('a registry that does not answer leaves the tag out and says so', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key);
		const { repository, first, second, tags } = await released();
		world.network.serve('registry.npmjs.org', () => new Response('unavailable', { status: 503 }));
		expect(await tags(true)).toEqual([
			{
				tag: 'widget-v0.9.0',
				version: '0.9.0',
				commit: first,
				outcome: 'failed',
				reason: 'The registry did not confirm 0.9.0: pkg:npm/widget is uncertain',
			},
			{
				tag: 'widget-v1.0.0',
				version: '1.0.0',
				commit: second,
				outcome: 'failed',
				reason: 'The registry did not confirm 1.0.0: pkg:npm/widget is uncertain',
			},
		]);
		expect(repository.refs.has('tags/widget-v1.0.0')).toBe(false);
	} finally {
		key.dispose();
	}
}, 30_000);

test('an applied backfill records the created tags in the audit log', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key);
		const { tags } = await released();
		await tags(true);
		const rows = await world.db.prepare('SELECT target FROM audit WHERE action=?').bind('repository.package-tags')
			.all();
		expect(rows.results).toEqual([{ target: 'octo/widget: widget-v1.0.0' }]);
	} finally {
		key.dispose();
	}
}, 30_000);

test('a backfill names an unknown stream and a stream without a version tag', async () => {
	const { repository, api } = await released();
	const refusal = async (stream: string) => {
		const reply = await api('/api/repositories/package-tags', { repositoryId: repository.id, stream, apply: false });
		return [reply.status, decodeSync(Schema.Struct({ error: Schema.String }), reply.body).error];
	};
	expect(await refusal('other')).toEqual([422, 'Unknown stream other']);
	const document = JSON.parse(configuration(['pkg:npm/widget']));
	delete document.streams.main.promote.workflow.refs;
	world.github.push(repository, { '.github/beepboop.json': jsonFile(document, '\t') }, 'Drop the version tag');
	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	expect(await refusal('main')).toEqual([422, 'Stream main pushes no version tag, so its packages get no tags']);
}, 30_000);

test('a stream without a packages list may tag any discovered package', () => {
	const inventory: Inventory = {
		packages: [widgetPackage],
		workflows: [],
		managers: ['npm'],
		diagnostics: [],
		publicationOrder: [],
	};
	const document = JSON.parse(configuration(['pkg:npm/widget']));
	delete document.streams.main.packages;
	expect(
		validateAgainst(decodeSync(configurationSchema, document), inventory, paths).filter(entry =>
			entry.message.includes('packageTags')
		),
	).toEqual([]);
});

test('a backfill refuses a repository without configuration', async () => {
	const plain = world.github.create('octo/plain', { 'README.md': '# plain\n' });
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: 'octo/plain' })).status).toBe(200);
	const refused = await api('/api/repositories/package-tags', { repositoryId: plain.id, stream: 'main', apply: false });
	expect([refused.status, decodeSync(Schema.Struct({ error: Schema.String }), refused.body).error]).toEqual([
		422,
		'Repository not configured',
	]);
}, 30_000);

test('a legacy package reference names its tag after the discovered package', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key);
		const { second, tags } = await released(['npm:widget']);
		expect(await tags(true)).toContainEqual({
			tag: 'widget-v1.0.0',
			version: '1.0.0',
			commit: second,
			outcome: 'created',
		});
	} finally {
		key.dispose();
	}
}, 30_000);

test('a package that publishes to another registry gets no tag from a public namesake', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key);
		const { repository, second, tags } = await released(['pkg:npm/widget'], {
			publishConfig: { registry: 'https://npm.pkg.github.com' },
		});
		expect(await tags(true)).toContainEqual({
			tag: 'widget-v1.0.0',
			version: '1.0.0',
			commit: second,
			outcome: 'unpublished',
		});
		expect(repository.refs.has('tags/widget-v1.0.0')).toBe(false);
	} finally {
		key.dispose();
	}
}, 30_000);

test('a backfill page stops starting checks past its window and names the next page', async () => {
	const key = signingKey('Release Bot (CI) <release@example.com>');
	try {
		world.env.SIGNER = fakeSigner(key);
		const { repository, first, api, tags } = await released();
		for (let minor = 1; minor <= 9; minor++) {
			world.github.recordTag(repository, `v0.${minor}.1`, String(minor).repeat(40), first, true);
		}
		let stalled = false;
		world.network.serve('registry.npmjs.org', request => {
			if (!stalled) {
				stalled = true;
				setSystemTime(new Date(Date.now() + 60_000));
			}
			return world.npm.handle(request);
		});
		const reply = await api('/api/repositories/package-tags', {
			repositoryId: repository.id,
			stream: 'main',
			apply: false,
		});
		const page = decodeSync(pageSchema, reply.body);
		expect(page.results.length).toBeLessThan(11);
		expect(page.next).toBe(page.results.at(-1)?.tag);
		const all = await tags(false);
		expect(all.length).toBe(11);
		expect(new Set(all.map(result => result.tag)).size).toBe(11);
		expect(all.filter(result => result.outcome === 'failed')).toEqual([]);
		const stale = await api('/api/repositories/package-tags', {
			repositoryId: repository.id,
			stream: 'main',
			apply: false,
			after: 'gadget-v1.0.0',
		});
		expect([stale.status, decodeSync(Schema.Struct({ error: Schema.String }), stale.body).error]).toEqual([
			422,
			'gadget-v1.0.0 is missing from the package tags of this stream; run the backfill again',
		]);
	} finally {
		setSystemTime();
		key.dispose();
	}
}, 30_000);

function pageRow(index: number): PackageTagRow {
	return {
		tag: `widget-v1.0.${index}`,
		version: `1.0.${index}`,
		commit,
		probes: [],
		state: 'missing',
	};
}

test('a page checks eight rows at a time and starts none after its window', async () => {
	const rows = Array.from({ length: 10 }, (_, index) => pageRow(index));
	const page = await Effect.runPromise(
		Effect.gen(function*() {
			const fiber = yield* Effect.forkChild(
				packageTagPage(rows, undefined, row =>
					Effect.sleep(packageTagWindow + 1).pipe(
						Effect.as({ tag: row.tag, version: row.version, commit: row.commit, outcome: 'unpublished' as const }),
					)),
			);
			yield* TestClock.adjust(packageTagWindow + 1);
			return yield* Fiber.join(fiber);
		}).pipe(Effect.provide(TestClock.layer())),
	);
	expect(page).toEqual({
		results: rows.slice(0, 8).map(row => ({
			tag: row.tag,
			version: row.version,
			commit: row.commit,
			outcome: 'unpublished',
		})),
		next: 'widget-v1.0.7',
	});
	const rest = await Effect.runPromise(
		packageTagPage(
			rows,
			page.next,
			row =>
				Effect.succeed({ tag: row.tag, version: row.version, commit: row.commit, outcome: 'unpublished' as const }),
		),
	);
	expect(rest).toEqual({
		results: rows.slice(8).map(row => ({
			tag: row.tag,
			version: row.version,
			commit: row.commit,
			outcome: 'unpublished',
		})),
	});
});

test('a release follows the pages until every row has its answer', async () => {
	const rows = Array.from({ length: 10 }, (_, index) => pageRow(index));
	const started: string[] = [];
	const results = await Effect.runPromise(
		Effect.gen(function*() {
			const fiber = yield* Effect.forkChild(
				packageTagPages(rows, row =>
					Effect.sync(() => started.push(row.tag)).pipe(
						Effect.andThen(Effect.sleep(packageTagWindow + 1)),
						Effect.as({ tag: row.tag, version: row.version, commit: row.commit, outcome: 'unpublished' as const }),
					)),
			);
			yield* TestClock.adjust(packageTagWindow + 1);
			yield* TestClock.adjust(packageTagWindow + 1);
			return yield* Fiber.join(fiber);
		}).pipe(Effect.provide(TestClock.layer())),
	);
	expect(results.map(result => result.tag)).toEqual(rows.map(row => row.tag));
	expect(started).toEqual(rows.map(row => row.tag));
});

test('a row still running when the page budget ends reports a failure', async () => {
	const rows = [pageRow(0), pageRow(1)];
	const page = await Effect.runPromise(
		Effect.gen(function*() {
			const fiber = yield* Effect.forkChild(
				packageTagPage(rows, undefined, row =>
					row.tag === 'widget-v1.0.0'
						? Effect.never
						: Effect.succeed({ tag: row.tag, version: row.version, commit: row.commit, outcome: 'exists' as const })),
			);
			yield* TestClock.adjust(packageTagBudget);
			return yield* Fiber.join(fiber);
		}).pipe(Effect.provide(TestClock.layer())),
	);
	expect(page).toEqual({
		results: [
			{
				tag: 'widget-v1.0.0',
				version: '1.0.0',
				commit,
				outcome: 'failed',
				reason: 'The checks ran out of time; run beepboop tags backfill again',
			},
			{ tag: 'widget-v1.0.1', version: '1.0.1', commit, outcome: 'exists' },
		],
	});
});
