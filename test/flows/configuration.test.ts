import { expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Validator } from '@cfworker/json-schema';
import { discoveredWidget } from '@root/test/support/client.ts';
import type { Reply } from '@root/test/support/http.ts';
import { bearer, field } from '@root/test/support/http.ts';
import { jsonFile, passChecks, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Result, Schema, Struct } from 'effect';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { identityOf, parseIdentity, parseReleaseIdentity, releaseIdentity } from '@/automation/package-identity';
import { workflowSetup } from '@/contract/setup';
import { configurationDrift, configurationSchema, issueMessage } from '@/domain/configuration';
import { validateAgainst } from '@/domain/validate';
import { record } from '@/model';
import { packageIdentity, parsePackageIdentity, purlDefinitions } from '@/package-url';
import { storedConfiguration } from '@/persistence/codecs/configuration';
import { decodeRepositoryV1 } from '@/persistence/codecs/v1';
import { executionId, planIdentity, releaseEventId } from '@/persistence/identity-keys';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';
import { assertCurrent, schemaPath } from '@/tooling/schema/render';

let world: World;
eachWorld(created => {
	world = created;
});

const storedDocument = mutableStruct({
	diagnostics: mutableArray(Schema.String),
	findings: mutableArray(mutableStruct({ code: Schema.String, severity: Schema.String, message: Schema.String })),
	inventory: mutableStruct({
		diagnostics: mutableArray(Schema.String),
		findings: mutableArray(mutableStruct({ code: Schema.String, severity: Schema.String, message: Schema.String })),
	}),
});
const documentRow = mutableStruct({ document: Schema.String });
async function storedRow(id: number): Promise<string> {
	return decodeSync(
		documentRow,
		await world.db.prepare('SELECT document FROM repositories WHERE id=?').bind(id).first(),
	)
		.document;
}
async function stored(id: number): Promise<Decoded<typeof storedDocument>> {
	return decodeSync(storedDocument, JSON.parse(await storedRow(id)));
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
	const legacy = decodeSync(looseStruct({ inventory: looseStruct({}) }), JSON.parse(await storedRow(repository.id)));
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

const widgetSchema = looseStruct({
	streams: looseStruct({
		main: looseStruct({
			promote: looseStruct({ approval: Schema.String, workflow: looseStruct({ file: Schema.String }) }),
		}),
	}),
});
type WidgetDocument = Decoded<typeof widgetSchema>;
function widgetDocument(): WidgetDocument {
	return decodeSync(widgetSchema, JSON.parse(widgetConfiguration()));
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
		const parsed = decodeSync(configurationSchema, value);
		const configuration = parseRepositoryConfiguration(value);
		if (Result.isFailure(configuration)) throw configuration.failure;
		expect(configurationDrift(value, configuration.success)).toEqual([]);
		const encoded = JSON.stringify(parsed);
		expect(JSON.stringify(decodeSync(configurationSchema, parsed))).toBe(encoded);
		expect(JSON.stringify(decodeSync(storedConfiguration, JSON.parse(encoded)))).toBe(encoded);
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
	const planId = await Effect.runPromise(planIdentity(plan, repository));
	expect(planId).toBe('4e4698a1d2eeabb327fb101c304d1bae874a2636ac09a4e43ce0071925e9fa25');
	expect(await Effect.runPromise(executionId(repository.id, 'main', 'promote', `plan:${planId}`))).toBe(
		'f9274d828597fbfa4356186d1739f66ed39439b301b9e632e6705f83bd7de9c1',
	);
	expect(releaseEventId({
		repositoryId: repository.id,
		stream: 'main',
		configurationSha: repository.sha,
		sourceSha: '89abcdef0123456789abcdef0123456789abcdef',
		version: '1.1.0',
		releaseSet: { preparationId: 'p1', group: 'g1', required: [] },
	})).toBe(
		'release:42:main:0123456789abcdef0123456789abcdef01234567:89abcdef0123456789abcdef0123456789abcdef:1.1.0:p1:g1',
	);

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
	expect(safeDecode(configurationSchema, legacy.configuration).success).toBe(false);
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
	const published = new Validator(Result.getOrThrow(record(await Bun.file(schemaPath).json())), '2020-12', false);
	for (const value of await shippedConfigurations()) expect(published.validate(value).errors).toEqual([]);
	for (const value of await documentedFragments()) {
		if (safeDecode(configurationSchema, value).success) expect(published.validate(value).errors).toEqual([]);
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
		expect(safeDecode(configurationSchema, value).success).toBe(false);
	}
});

test('workflow setup rejects unknown keys before normalization in runtime and published schemas', async () => {
	const published = new Validator(Result.getOrThrow(record(await Bun.file(schemaPath).json())), '2020-12', false);
	for (const setup of [{ comands: 'npm publish' }, { file: 'other.yml' }, { existingTrigers: 'preserve' }]) {
		const document = { streams: { main: { promote: { workflow: { file: 'publish.yml', setup } } } } };
		expect(safeDecode(workflowSetup, setup).success).toBe(false);
		expect(safeDecode(configurationSchema, document).success).toBe(false);
		expect(Result.isFailure(parseRepositoryConfiguration(document))).toBe(true);
		expect(published.validate(document).valid).toBe(false);
	}
	expect(decodeSync(workflowSetup, { commands: 'npm publish', triggers: 'dispatchOnly' })).toEqual({
		commands: 'npm publish',
		publicationSteps: {},
		triggers: 'dispatchOnly',
	});
	expect(decodeSync(workflowSetup, {})).toEqual({ commands: '', publicationSteps: {}, triggers: 'review' });
	expect(decodeSync(workflowSetup, { existingTriggers: 'replace-with-dispatch', triggers: 'preserve' })).toEqual({
		commands: '',
		publicationSteps: {},
		triggers: 'dispatchOnly',
	});
});

test('schema:check refuses a hand-edited schema file', async () => {
	await Effect.runPromise(assertCurrent(schemaPath));
	const edited = join(tmpdir(), `beepboop-schema-${crypto.randomUUID()}.json`);
	const published = decodeSync(
		looseStruct({
			properties: looseStruct({
				managers: looseStruct({ items: looseStruct({ enum: mutableArray(Schema.String) }) }),
			}),
		}),
		await Bun.file(schemaPath).json(),
	);
	published.properties.managers.items.enum.push('homebrew');
	await Bun.write(edited, jsonFile(published, '\t'));
	try {
		await expect(Effect.runPromise(assertCurrent(edited))).rejects.toThrow('The configuration schema is stale');
	} finally {
		await rm(edited);
	}
}, 30_000);

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
		name: 'a companion module that discovery never finds',
		codes: ['unknown-reference'],
		edit: stream => {
			stream.companionModules = ['pkg:golang/github.com/octo/widget/go'];
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
		name: 'a companion module that is not a Go module versioned by tags',
		codes: ['companion-module'],
		edit: stream => {
			stream.companionModules = ['pkg:npm/widget'];
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

const finding = mutableStruct({ code: Schema.String, severity: Schema.String, message: Schema.String });
async function refreshed(edit: (configuration: WidgetDocument) => void, message: string) {
	const repository = widget(world.github);
	const configuration = widgetDocument();
	edit(configuration);
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, message);
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	const findings = (await stored(repository.id)).findings.map(entry => decodeSync(finding, entry));
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

const retiredKeys = looseStruct({
	configuration: looseStruct({
		streams: looseStruct({
			main: looseStruct({ promote: looseStruct({ workflow: looseStruct({}) }) }),
		}),
	}),
});
function withRetiredKeys(document: unknown): Decoded<typeof retiredKeys> {
	const parsed = decodeSync(retiredKeys, document);
	parsed.configuration.retired = true;
	parsed.configuration.streams.main.retired = true;
	parsed.configuration.streams.main.promote.workflow.retired = true;
	parsed.findings = [{ code: 'retired-check', severity: 'warning', message: 'A check this version removed' }];
	return parsed;
}

test('stored rows and journal entries with keys this version does not know still read and release', async () => {
	const token = await world.cliSession();
	const repository = await discoveredWidget(world, token);
	const api = bearer(world, token);
	await world.db.prepare('UPDATE repositories SET document=? WHERE id=?')
		.bind(JSON.stringify(withRetiredKeys(JSON.parse(await storedRow(repository.id)))), repository.id).run();
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

test('stored identities crash and outside package input stays a Result', () => {
	const broken = { type: 'npm', name: '' };
	expect(identityOf({ manager: 'npm', name: 'widget', version: '1.0.0' }).name).toBe('widget');
	expect(releaseIdentity('pkg:npm/widget@1.0.0').version).toBe('1.0.0');
	expect(packageIdentity('pkg:npm/widget@1.0.0').name).toBe('widget');
	expect(purlDefinitions.get('npm')?.type).toBe('npm');
	expect(() => identityOf({ manager: 'npm', name: 'widget', identity: broken })).toThrow();
	expect(() => releaseIdentity(broken)).toThrow();
	expect(() => packageIdentity(broken)).toThrow();
	expect(Result.isFailure(parseIdentity({ manager: 'jsr', name: 'widget', version: '1.0.0' }))).toBe(true);
	expect(Result.isFailure(parseReleaseIdentity('pkg:npm/'))).toBe(true);
	expect(Result.isFailure(parsePackageIdentity(broken))).toBe(true);

	const raw: unknown = JSON.parse(widgetConfiguration());
	const edited = decodeSync(
		looseStruct({
			streams: looseStruct({ main: looseStruct({ packages: mutableArray(Schema.String) }) }),
		}),
		raw,
	);
	edited.streams.main.packages = ['pkg:npm/'];
	expect(safeDecode(configurationSchema, edited).success).toBe(false);
	expect(Result.isFailure(parseRepositoryConfiguration(edited))).toBe(true);

	const configuration = decodeSync(configurationSchema, JSON.parse(widgetConfiguration()));
	const main = configuration.streams.main;
	if (main === undefined) throw new Error('Missing main stream');
	main.packages = ['pkg:npm/', 'pkg:npm/widget@1.2.3'];
	const diagnostics = validateAgainst(
		configuration,
		{ packages: [], workflows: [], managers: [], diagnostics: [], publicationOrder: [] },
		{ paths: ['.github/workflows/publish.yml', '.github/workflows/ci.yml'] },
	);
	expect(
		diagnostics.some(entry => entry.code === 'versioned-reference' && entry.message.includes('pkg:npm/widget@1.2.3')),
	)
		.toBe(true);
});

test('the parser and schema agree on tag prefixes with directories', () => {
	const document = (prefix: string) => ({
		streams: {
			main: {
				versionSource: { kind: 'tags', prefix },
				promote: { workflow: { file: 'publish.yml', refs: { phase: 'version', prefix } } },
			},
		},
	});
	for (
		const [prefix, valid] of [
			['tools/v', true],
			['a/b/v', true],
			['../v', false],
			['/v', false],
			['a//v', false],
		] as const
	) {
		expect(Result.isSuccess(parseRepositoryConfiguration(document(prefix)))).toBe(valid);
		expect(safeDecode(configurationSchema, document(prefix)).success).toBe(valid);
	}
});

test('the parser and schema agree on job gates', () => {
	const document = (needsJobs: unknown, mode = 'observe') => ({
		streams: {
			main: {
				promote: { workflow: { file: 'publish.yml' } },
				needs: { 'pkg:cargo/cli': ['pkg:cargo/core'] },
				workflows: {
					release: { file: 'release.yml', mode, ref: 'refs/tags/v*', needs: ['promote'] },
					crates: { file: 'crates.yml', needs: ['release'], needsJobs },
				},
			},
		},
	});
	for (
		const [value, valid] of [
			[document({ release: ['plan', 'build_all', 'Assemble-1'] }), true],
			[document({ promote: ['plan'] }), false],
			[document({ release: ['plan'] }, 'dispatch'), false],
			[document({ release: [] }), false],
			[document({ release: ['1plan'] }), false],
		] as const
	) {
		expect(Result.isSuccess(parseRepositoryConfiguration(value))).toBe(valid);
		expect(safeDecode(configurationSchema, value).success).toBe(valid);
	}
	const parsed = decodeSync(configurationSchema, document({ release: ['plan'] }));
	const encoded = decodeSync(storedConfiguration, parsed).streams.main;
	expect(encoded?.workflows.crates?.needsJobs).toEqual({ release: ['plan'] });
	expect(encoded?.needs).toEqual({ 'pkg:cargo/cli': ['pkg:cargo/core'] });
	const legacy = parseRepositoryConfiguration(document({ release: ['plan'] }));
	if (Result.isFailure(legacy)) throw new Error('The parser rejected a valid job gate');
	expect(configurationDrift(document({ release: ['plan'] }), legacy.success)).toEqual([]);
});

test('the parser and schema agree on operation dependencies, schedules and WinGet settings', () => {
	const document = (workflows: Record<string, unknown>, winget?: unknown) => ({
		streams: { main: { promote: { workflow: { file: 'publish.yml' } }, workflows } },
		...(winget === undefined ? {} : { winget }),
	});
	for (
		const [value, valid] of [
			[document({ build: { file: 'build.yml', needs: ['promote'] } }), true],
			[document({ build: { file: 'build.yml', needs: ['missing'] } }), false],
			[document({ a: { file: 'a.yml', needs: ['b'] }, b: { file: 'b.yml', needs: ['a'] } }), false],
			[document({ nightly: { file: 'nightly.yml', schedule: '0 6 * * 1' } }), true],
			[document({ nightly: { file: 'nightly.yml', schedule: '0 6 * *' } }), false],
			[document({ nightly: { file: 'nightly.yml', schedule: '0 25 * * *' } }), false],
			[document({}, { config: 'winget/widget.json' }), true],
			[document({}, { config: 'winget/widget.json', tagPrefix: 'release-' }), true],
			[document({}, { config: '/winget/widget.json' }), false],
			[document({}, { config: 'winget/../widget.json' }), false],
			[document({}, { config: 'winget/widget.yaml' }), false],
			[document({}, { config: 'winget/widget.json', tagPrefix: 'a/v' }), false],
		] as const
	) {
		expect(Result.isSuccess(parseRepositoryConfiguration(value))).toBe(valid);
		expect(safeDecode(configurationSchema, value).success).toBe(valid);
	}

	const fourFields = parseRepositoryConfiguration(document({ nightly: { file: 'n.yml', schedule: '0 6 * *' } }));
	expect(Result.isFailure(fourFields) && fourFields.failure.message).toBe('Schedules use five-field UTC cron');
	const winget = { config: 'winget/widget.json', tagPrefix: 'v', automatic: false };
	expect(decodeSync(configurationSchema, document({}, { config: 'winget/widget.json' })).winget).toEqual(winget);
	const legacy = parseRepositoryConfiguration(document({}, { config: 'winget/widget.json' }));
	expect(Result.isSuccess(legacy) && legacy.success.winget).toEqual(winget);

	const broken = document({ a: { file: 'a.yml', needs: ['b', 'missing'] }, b: { file: 'b.yml', needs: ['a'] } });
	const legacyBroken = parseRepositoryConfiguration(broken);
	expect(Result.isFailure(legacyBroken) && legacyBroken.failure.message).toBe('Operation dependency cycle');
	const schema = safeDecode(configurationSchema, broken);
	expect(schema.success ? [] : schemaIssues(schema.error).map(issueMessage)).toEqual([
		'streams.main.workflows.a: Operation dependency cycle',
		'streams.main.workflows.a.needs: Unknown dependency missing',
	]);
	const unknown = parseRepositoryConfiguration(document({ build: { file: 'build.yml', needs: ['missing'] } }));
	expect(Result.isFailure(unknown) && unknown.failure.message).toBe('Unknown dependency missing');
});

test('invalid record keys and explicit null stay invalid in the runtime and published schema', async () => {
	const validator = new Validator(await Bun.file(new URL('../../schemas/v1.json', import.meta.url)).json());
	for (
		const value of [
			{ streams: { 'bad key': {} } },
			{ streams: { main: { workflows: { 'bad key': { file: 'ci.yml' } } } } },
			{ extends: null },
			{ streams: { main: { packages: null } } },
			{ streams: { main: { unexpected: true } } },
		]
	) {
		expect(safeDecode(configurationSchema, value).success).toBe(false);
		expect(validator.validate(value).valid).toBe(false);
	}
});
