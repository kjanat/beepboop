import { afterEach, beforeEach, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Validator } from '@cfworker/json-schema';
import { z } from 'zod';
import { planIdentity } from '@/automation/managed';
import { configurationSchema } from '@/domain/configuration';
import { storedConfiguration } from '@/persistence/codecs/configuration';
import { record } from '@/model';
import { decodeRepositoryV1 } from '@/persistence/codecs/v1';
import { assertCurrent, schemaPath } from '@/tooling/schema/render';
import { bearer, field, type Reply } from '../support/http.ts';
import { passChecks, widget, widgetConfiguration } from '../support/repositories.ts';
import { World } from '../support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

const storedDocument = z.object({
	diagnostics: z.array(z.string()),
	findings: z.array(z.object({ code: z.string(), severity: z.string(), message: z.string() })),
	inventory: z.object({
		diagnostics: z.array(z.string()),
		findings: z.array(z.object({ code: z.string(), severity: z.string(), message: z.string() })),
	}),
});
async function stored(id: number): Promise<z.output<typeof storedDocument>> {
	const row = await world.db.prepare('SELECT document FROM repositories WHERE id=?').bind(id).first<
		{ document: string }
	>();
	if (!row) throw new Error(`Repository ${id} is not stored`);
	return storedDocument.parse(JSON.parse(row.document));
}
function diagnostics(reply: Reply): unknown {
	return field(reply.body, 'diagnostics');
}

test('a registry outage is a warning that neither blocks releases nor reaches the deployed row shape', async () => {
	const repository = widget(world.github);
	world.network.serve('registry.npmjs.org', () => new Response('unavailable', { status: 503 }));
	const api = bearer(world, await world.cliSession());

	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	expect(diagnostics(discovered)).toEqual([]);

	const document = await stored(repository.id);
	expect(document.diagnostics).toEqual([]);
	const lookup = document.inventory.findings.filter(entry => entry.code === 'lookup-failed');
	expect(lookup.length).toBe(1);
	expect(lookup[0]?.severity).toBe('warning');
	expect(document.inventory.diagnostics).toEqual(document.inventory.findings.map(entry => entry.message));

	const plan = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	expect(plan.status).toBe(200);
});

test('rows written before typed diagnostics still read as blocking', async () => {
	const repository = widget(world.github);
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	const row = await world.db.prepare('SELECT document FROM repositories WHERE id=?').bind(repository.id).first<
		{ document: string }
	>();
	if (!row) throw new Error('Repository is not stored');
	const legacy = z.looseObject({ inventory: z.looseObject({}) }).parse(JSON.parse(row.document));
	delete legacy.findings;
	delete legacy.inventory.findings;
	legacy.diagnostics = ['Configuration invalid'];
	await world.db.prepare('UPDATE repositories SET document=? WHERE id=?').bind(JSON.stringify(legacy), repository.id)
		.run();

	const listed = await api('/api/repositories');
	expect(listed.status).toBe(200);
	expect(Array.isArray(listed.body) ? listed.body.map(entry => field(entry, 'diagnostics')) : undefined).toEqual([[
		'Configuration invalid',
	]]);
	const plan = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	expect(plan.status).toBe(422);
});

function jsonBlocks(markdown: string): unknown[] {
	return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].flatMap(([, body]) => {
		const value: unknown = JSON.parse(body ?? 'null');
		return typeof value === 'object' && value !== null && !Array.isArray(value) ? [value] : [];
	});
}

const widgetSchema = z.looseObject({
	streams: z.looseObject({
		main: z.looseObject({
			promote: z.looseObject({ approval: z.string(), workflow: z.looseObject({ file: z.string() }) }),
		}),
	}),
});
type WidgetDocument = z.output<typeof widgetSchema>;
function widgetDocument(): WidgetDocument {
	return widgetSchema.parse(JSON.parse(widgetConfiguration()));
}

const root = new URL('../../', import.meta.url);
async function shippedConfigurations(): Promise<unknown[]> {
	const read = (path: string): Promise<unknown> => Bun.file(new URL(path, root)).json();
	const presets = await Promise.all(
		['default', 'github-action', 'maintenance', 'npm', 'rust-workspace'].map(name => read(`presets/${name}.json`)),
	);
	return [
		await read('.github/beepboop.json'),
		...presets,
		...jsonBlocks(await Bun.file(new URL('docs/automation.md', root)).text()),
		JSON.parse(widgetConfiguration('merge')),
		{},
	];
}

test('parsing a parsed configuration returns it unchanged, and stored copies decode to the same value', async () => {
	for (const value of await shippedConfigurations()) {
		const parsed = configurationSchema.safeParse(value);
		if (!parsed.success) continue;
		const encoded = JSON.stringify(parsed.data);
		expect(JSON.stringify(configurationSchema.parse(parsed.data))).toBe(encoded);
		expect(JSON.stringify(storedConfiguration.parse(JSON.parse(encoded)))).toBe(encoded);
	}
});

const storedRepository = {
	'id': 42,
	'name': 'octo/widget',
	'defaultBranch': 'main',
	'sha': '0123456789abcdef0123456789abcdef01234567',
	'configuration': {
		'winget': {
			'config': 'winget.json',
			'tagPrefix': 'v',
			'automatic': false,
		},
		'extends': [],
		'managers': [
			'npm',
			'workflow',
		],
		'streams': {
			'main': {
				'versionFiles': [
					{
						'path': 'VERSION',
						'format': 'text',
						'prefix': 'v=',
						'suffix': '\n',
						'template': '{version}',
					},
				],
				'packages': [
					'pkg:npm/widget',
				],
				'versioning': 'workspace',
				'concurrency': 'queue',
				'prepare': {
					'strategy': 'managed',
					'version': 'manual',
				},
				'promote': {
					'approval': 'merge',
					'workflow': {
						'outputs': [
							{
								'id': 'bin',
								'kind': 'binary',
							},
						],
						'refs': {
							'phase': 'version',
							'prefix': 'v',
							'aliases': [],
							'signed': true,
						},
						'publications': [
							'pkg:npm/widget',
						],
						'file': 'publish.yml',
						'ref': 'main',
						'inputs': {
							'channel': 'stable',
						},
						'required': true,
					},
				},
				'workflows': {
					'mirror': {
						'artifactInputs': [
							{
								'operation': 'promote',
								'output': 'bin',
							},
						],
						'platform': {
							'os': 'linux',
							'arch': 'x64',
						},
						'needs': [
							'promote',
						],
						'schedule': '0 6 * * 1',
						'file': 'mirror.yml',
						'inputs': {},
						'required': false,
					},
				},
				'required': [
					'pkg:npm/widget',
				],
				'credentials': [
					'npm-token',
				],
				'channels': {
					'stable': 'latest',
					'prerelease': 'next',
				},
			},
		},
		'subscriptions': [
			{
				'id': 'upstream',
				'sourceStream': 'main',
				'source': 'octo/core',
				'event': 'release',
				'stream': 'main',
				'operation': 'mirror',
			},
		],
	},
	'presetShas': {},
	'inventory': {
		'packages': [],
		'workflows': [],
		'managers': [
			'npm',
		],
		'diagnostics': [],
		'publicationOrder': [],
	},
	'diagnostics': [],
	'updatedAt': 0,
};

test('stored repositories keep their plan identity and decode under the configuration shape', async () => {
	const repository = decodeRepositoryV1(structuredClone(storedRepository));
	const plan = {
		version: '1.1.0',
		sourceSha: storedRepository.sha,
		edits: [],
		packages: [],
		diagnostics: [],
		requiresPreparation: true,
	};
	expect(await planIdentity(plan, repository)).toBe('4e4698a1d2eeabb327fb101c304d1bae874a2636ac09a4e43ce0071925e9fa25');

	const { configuration } = storedRepository;
	const legacy = {
		...storedRepository,
		configuration: {
			...configuration,
			subscriptions: configuration.subscriptions.map(subscription => ({ ...subscription, workflow: 'ci.yml' })),
			streams: {
				main: {
					...configuration.streams.main,
					workflows: {
						...configuration.streams.main.workflows,
						prepare: { file: 'mirror.yml', inputs: {}, required: true },
					},
				},
			},
		},
	};
	expect(decodeRepositoryV1(legacy).configuration?.subscriptions[0]).toMatchObject({ workflow: 'ci.yml' });
	expect(configurationSchema.safeParse(legacy.configuration).success).toBe(false);
});

test('refresh refuses a workflow named after a reserved operation', async () => {
	const repository = widget(world.github);
	const configuration = widgetDocument();
	configuration.streams.main.workflows = { prepare: { file: 'publish.yml' } };
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Shadow prepare');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());

	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	const findings = (await stored(repository.id)).findings;
	expect(findings.map(entry => [entry.code, entry.severity])).toEqual([['reserved-operation', 'blocking']]);
	expect(diagnostics(discovered)).toEqual([
		'streams.main.workflows.prepare: prepare is configured under prepare.workflow',
	]);
	const plan = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	expect(plan.status).toBe(422);
});

test('editors validate with the published schema and refuse what refresh refuses', async () => {
	const published = new Validator(record(await Bun.file(schemaPath).json()), '2020-12', false);
	for (const value of await shippedConfigurations()) {
		if (configurationSchema.safeParse(value).success) expect(published.validate(value).errors).toEqual([]);
	}
	for (
		const value of [
			{ streams: { main: { workflows: { publish: { file: 'nested/publish.yml' } } } } },
			{ extends: ['owner/presets'] },
			{ streams: { main: { promote: { approval: 'sometimes' } } } },
			{ subscriptions: [{ id: 'hook', source: 'octo/tool', event: 'workflow_run', stream: 'main', operation: 'x' }] },
		]
	) {
		expect(published.validate(value).valid).toBe(false);
		expect(configurationSchema.safeParse(value).success).toBe(false);
	}
});

test('schema:check refuses a hand-edited schema file', async () => {
	await assertCurrent(schemaPath);
	const edited = join(tmpdir(), `beepboop-schema-${crypto.randomUUID()}.json`);
	const published = z.looseObject({
		properties: z.looseObject({
			managers: z.looseObject({ items: z.looseObject({ enum: z.array(z.string()) }) }),
		}),
	}).parse(await Bun.file(schemaPath).json());
	published.properties.managers.items.enum.push('homebrew');
	await Bun.write(edited, `${JSON.stringify(published, null, '\t')}\n`);
	try {
		await expect(assertCurrent(edited)).rejects.toThrow('The configuration schema is stale');
	} finally {
		await rm(edited);
	}
});

type Stream = WidgetDocument['streams']['main'];
interface LateFailure {
	name: string;
	code: string;
	edit: (stream: Stream) => void;
}
const lateFailures: LateFailure[] = [
	{
		name: 'a workflow preparation strategy without a workflow',
		code: 'binding-missing',
		edit: stream => {
			stream.prepare = { strategy: 'workflow' };
		},
	},
	{
		name: 'a stream package that discovery never finds',
		code: 'unknown-reference',
		edit: stream => {
			stream.packages = ['pkg:npm/widget', 'pkg:npm/gadget'];
		},
	},
	{
		name: 'a versioned package reference',
		code: 'versioned-reference',
		edit: stream => {
			stream.packages = ['pkg:npm/widget@1.0.0'];
		},
	},
	{
		name: 'a binding whose workflow file is missing',
		code: 'binding-missing',
		edit: stream => {
			stream.promote.workflow.file = 'release.yml';
		},
	},
	{
		name: 'a binding whose workflow cannot be dispatched',
		code: 'binding-not-dispatchable',
		edit: stream => {
			stream.workflows = { lint: { file: 'ci.yml' } };
		},
	},
	{
		name: 'a dispatch binding with a wildcard ref',
		code: 'wildcard-ref',
		edit: stream => {
			stream.promote.workflow.ref = 'release/*';
		},
	},
	{
		name: 'a per-package workflow without a package input',
		code: 'each-package-input',
		edit: stream => {
			stream.workflows = { mirror: { file: 'publish.yml', each: 'package', needs: ['promote'] } };
		},
	},
	{
		name: 'a required publication no release group can cover',
		code: 'required-uncovered',
		edit: stream => {
			stream.versioning = 'independent';
			stream.required = ['pkg:npm/widget', 'pkg:npm/gadget'];
		},
	},
	{
		name: 'a version file missing from the tree',
		code: 'version-file-missing',
		edit: stream => {
			stream.versionFiles = [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }];
		},
	},
	{
		name: 'a required publication no operation reports',
		code: 'required-uncovered',
		edit: stream => {
			stream.required = ['pkg:npm/widget', 'pkg:github/octo/widget'];
		},
	},
];

const finding = z.object({ code: z.string(), severity: z.string(), message: z.string() });
for (const failure of lateFailures) {
	test(`refresh blocks ${failure.name}`, async () => {
		const repository = widget(world.github);
		const configuration = widgetDocument();
		failure.edit(configuration.streams.main);
		world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, failure.name);
		passChecks(repository, world.github.head(repository));
		const api = bearer(world, await world.cliSession());

		const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
		expect(discovered.status).toBe(200);
		const blocking = (await stored(repository.id)).findings.map(entry => finding.parse(entry)).filter(entry =>
			entry.severity === 'blocking'
		);
		expect(blocking.map(entry => entry.code)).toEqual([failure.code]);
		expect(diagnostics(discovered)).toEqual(blocking.map(entry => entry.message));

		const plan = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
		expect(plan.status).toBe(422);
		expect(field(field(plan.body, 'problem'), 'diagnostics')).toEqual(
			blocking.map(entry => expect.objectContaining({ code: entry.code, message: entry.message })),
		);
	});
}

test('setup preview blocks a proposal that refresh would refuse', async () => {
	const repository = widget(world.github);
	const configuration = widgetDocument();
	configuration.streams.main.versionFiles = [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }];
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Missing version file');
	const api = bearer(world, await world.cliSession());

	const preview = await api('/api/repositories/setup/preview', { repository: 'octo/widget' });
	expect(preview.status).toBe(200);
	expect(field(preview.body, 'blockers')).toEqual(
		expect.arrayContaining(['Stream main edits VERSION, which does not exist']),
	);
});

test('setup preview names each schema problem in an invalid configuration', async () => {
	const repository = widget(world.github);
	const configuration = widgetDocument();
	configuration.streams.main.promote.approval = 'sometimes';
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Bad approval');
	const api = bearer(world, await world.cliSession());

	const preview = await api('/api/repositories/setup/preview', { repository: 'octo/widget' });
	expect(preview.status).toBe(422);
	expect(field(field(preview.body, 'problem'), 'diagnostics')).toEqual([
		expect.objectContaining({
			code: 'invalid-configuration',
			subject: { kind: 'file', path: '.github/beepboop.json' },
		}),
	]);
	expect(field(preview.body, 'error')).toContain('streams.main.promote.approval');
});
