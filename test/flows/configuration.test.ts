import { afterEach, beforeEach, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Validator } from '@cfworker/json-schema';
import { z } from 'zod';
import { planIdentity } from '@/automation/managed';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { configurationDrift, configurationSchema } from '@/domain/configuration';
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
	return [await read('.github/beepboop.json'), ...presets, JSON.parse(widgetConfiguration('merge')), {}];
}
async function documentedFragments(): Promise<unknown[]> {
	return jsonBlocks(await Bun.file(new URL('docs/automation.md', root)).text());
}

test('parsing a parsed configuration returns it unchanged, and stored copies decode to the same value', async () => {
	for (const value of await shippedConfigurations()) {
		const parsed = configurationSchema.parse(value);
		expect(configurationDrift(value, parseRepositoryConfiguration(value))).toEqual([]);
		const encoded = JSON.stringify(parsed);
		expect(JSON.stringify(configurationSchema.parse(parsed))).toBe(encoded);
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

test('refresh records schema drift as a warning while the current parser keeps releasing', async () => {
	const repository = widget(world.github);
	const configuration = widgetDocument();
	configuration.streams.main.workflows = { prepare: { file: 'publish.yml' } };
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Shadow prepare');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());

	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	expect(diagnostics(discovered)).toEqual([]);
	const document = await stored(repository.id);
	expect(document.diagnostics).toEqual([]);
	expect(document.findings).toEqual([{
		code: 'configuration-drift',
		severity: 'warning',
		message:
			'The configuration schema rejects streams.main.workflows.prepare: prepare is configured under prepare.workflow',
	}]);
	const plan = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	expect(plan.status).toBe(200);
});

test('editors validate with the published schema and refuse what refresh refuses', async () => {
	const published = new Validator(record(await Bun.file(schemaPath).json()), '2020-12', false);
	for (const value of await shippedConfigurations()) expect(published.validate(value).errors).toEqual([]);
	for (const value of await documentedFragments()) {
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
interface Finding {
	name: string;
	codes: string[];
	edit: (stream: Stream) => void;
}
const lateFailures: Finding[] = [
	{
		name: 'a stream package that discovery never finds',
		codes: ['unknown-reference'],
		edit: stream => {
			stream.packages = ['pkg:npm/widget', 'pkg:npm/gadget'];
		},
	},
	{
		name: 'a promotion whose workflow file is missing',
		codes: ['binding-missing'],
		edit: stream => {
			stream.promote.workflow.file = 'release.yml';
		},
	},
	{
		name: 'a promotion dependency whose workflow cannot be dispatched',
		codes: ['binding-not-dispatchable'],
		edit: stream => {
			stream.promote.workflow.needs = ['lint'];
			stream.workflows = { lint: { file: 'ci.yml' } };
		},
	},
	{
		name: 'a promotion with a wildcard ref',
		codes: ['wildcard-ref'],
		edit: stream => {
			stream.promote.workflow.ref = 'release/*';
		},
	},
	{
		name: 'a per-package workflow without a package input',
		codes: ['each-package-input'],
		edit: stream => {
			stream.workflows = { mirror: { file: 'publish.yml', each: 'package', needs: ['promote'] } };
		},
	},
	{
		name: 'a version file missing from the tree',
		codes: ['version-file-missing'],
		edit: stream => {
			stream.versionFiles = [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }];
		},
	},
];
const workingConfigurations: Finding[] = [
	{
		name: 'a workflow preparation strategy without a workflow',
		codes: ['configuration-drift'],
		edit: stream => {
			stream.prepare = { strategy: 'workflow' };
		},
	},
	{
		name: 'a versioned package reference',
		codes: ['versioned-reference'],
		edit: stream => {
			stream.packages = ['pkg:npm/widget@1.0.0'];
		},
	},
	{
		name: 'a custom operation whose workflow file is missing',
		codes: ['binding-missing'],
		edit: stream => {
			stream.workflows = { lint: { file: 'lint.yml' } };
		},
	},
	{
		name: 'a custom operation served by observation through begin',
		codes: ['binding-not-dispatchable', 'wildcard-ref'],
		edit: stream => {
			stream.workflows = { lint: { file: 'ci.yml', ref: 'release/*' } };
		},
	},
	{
		name: 'a required publication no release group can cover',
		codes: ['required-uncovered'],
		edit: stream => {
			stream.versioning = 'independent';
			stream.required = ['pkg:npm/widget', 'pkg:npm/gadget'];
		},
	},
	{
		name: 'a required publication only the promotion run reports',
		codes: ['required-uncovered'],
		edit: stream => {
			stream.required = ['pkg:npm/widget', 'pkg:github/octo/widget'];
		},
	},
];

const finding = z.object({ code: z.string(), severity: z.string(), message: z.string() });
async function refreshed(edit: (configuration: WidgetDocument) => void, message: string) {
	const repository = widget(world.github);
	const configuration = widgetDocument();
	edit(configuration);
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, message);
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	const findings = (await stored(repository.id)).findings.map(entry => finding.parse(entry));
	const plan = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	return { discovered, findings, plan };
}
for (const failure of lateFailures) {
	test(`refresh blocks ${failure.name}`, async () => {
		const { discovered, findings, plan } = await refreshed(
			configuration => failure.edit(configuration.streams.main),
			failure.name,
		);
		const blocking = findings.filter(entry => entry.severity === 'blocking');
		expect(blocking.map(entry => entry.code)).toEqual(failure.codes);
		expect(diagnostics(discovered)).toEqual(blocking.map(entry => entry.message));
		expect(plan.status).toBe(422);
		expect(field(field(plan.body, 'problem'), 'diagnostics')).toEqual(
			blocking.map(entry => expect.objectContaining({ code: entry.code, message: entry.message })),
		);
	});
}
for (const working of workingConfigurations) {
	test(`refresh warns about ${working.name} and keeps planning`, async () => {
		const { discovered, findings, plan } = await refreshed(
			configuration => working.edit(configuration.streams.main),
			working.name,
		);
		expect(findings.filter(entry => entry.severity === 'blocking')).toEqual([]);
		expect(findings.map(entry => entry.code)).toEqual(working.codes);
		expect(diagnostics(discovered)).toEqual([]);
		expect(plan.status).toBe(200);
	});
}

test('refresh finds bindings by path when the workflow manager is excluded', async () => {
	const { findings, plan } = await refreshed(configuration => {
		configuration.managers = ['npm'];
	}, 'Skip workflow discovery');
	expect(findings).toEqual([]);
	expect(plan.status).toBe(200);
});

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

const retiredKeys = z.looseObject({
	configuration: z.looseObject({
		streams: z.looseObject({
			main: z.looseObject({ promote: z.looseObject({ workflow: z.looseObject({}) }) }),
		}),
	}),
});
function withRetiredKeys(document: unknown): z.output<typeof retiredKeys> {
	const parsed = retiredKeys.parse(document);
	parsed.configuration.retired = true;
	parsed.configuration.streams.main.retired = true;
	parsed.configuration.streams.main.promote.workflow.retired = true;
	parsed.findings = [{ code: 'retired-check', severity: 'warning', message: 'A check this version removed' }];
	return parsed;
}

test('stored rows and journal entries with keys this version does not know still read and release', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	const row = z.object({ document: z.string() }).parse(
		await world.db.prepare('SELECT document FROM repositories WHERE id=?').bind(repository.id).first(),
	);
	await world.db.prepare('UPDATE repositories SET document=? WHERE id=?')
		.bind(JSON.stringify(withRetiredKeys(JSON.parse(row.document))), repository.id).run();
	await world.db.prepare('INSERT INTO grants(id,alias,repository_id,document) VALUES(?,?,?,?)').bind(
		'grant-1',
		'npm-token',
		repository.id,
		JSON.stringify({
			id: 'grant-1',
			alias: 'npm-token',
			repositoryId: repository.id,
			repository: repository.name,
			operation: 'promote',
			workflow: 'publish.yml',
			ref: 'refs/heads/main',
			delivery: 'runtime',
			retired: true,
		}),
	).run();

	const listed = await api('/api/repositories');
	expect(listed.status).toBe(200);
	expect(Array.isArray(listed.body) ? listed.body.map(entry => typeof field(entry, 'configuration')) : []).toEqual([
		'object',
	]);
	const credentials = await api('/api/credentials');
	expect(credentials.status).toBe(200);
	expect(field(credentials.body, 'grants')).toEqual([expect.objectContaining({ id: 'grant-1' })]);

	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	expect(plan.status).toBe(200);
	const prepared = await api('/api/releases/prepare', {
		...request,
		sourceSha: field(plan.body, 'sourceSha'),
		planId: field(plan.body, 'planId'),
	});
	expect(prepared.status).toBe(200);
	const storage = world.coordinators.instance(String(repository.id)).storage;
	const key = `execution:${String(field(prepared.body, 'id'))}`;
	await storage.put(key, withRetiredKeys(await storage.get(key)));
	await world.wait(20_000);
	expect(repository.pulls.length).toBe(1);
});
