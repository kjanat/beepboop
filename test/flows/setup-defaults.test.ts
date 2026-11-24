import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PromptEngine } from '@kjanat/dreamcli';
import { savedClient } from '@root/test/support/cli.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { FakeGitHub, Repository } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { plugin, widget } from '@root/test/support/repositories.ts';
import { applyChoices, discoverSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect, Predicate } from 'effect';
import type { HTMLFormElement } from 'happy-dom';
import { Window } from 'happy-dom';
import { app } from '@/cli/main';
import {
	choicesEditors,
	choicesFields,
	streamEditors,
	streamFields,
	workflowEditors,
	workflowFields,
} from '@/setup/editing/fields.ts';

const browser: { setup(form: HTMLFormElement, action: string): Effect.Effect<void, unknown> } = await import(
	new URL('../../src/ui/browser/setup.ts', import.meta.url).href
);

const previewPath = '/api/repositories/setup/preview';
const globals = [
	'document',
	'HTMLFormElement',
	'HTMLInputElement',
	'HTMLSelectElement',
	'HTMLTextAreaElement',
	'HTMLButtonElement',
] as const;

let world: World;
let directory: string;
let window: Window;
let sent: { source: 'dashboard' | 'cli'; choices: unknown }[] = [];
const descriptors = new Map<string, PropertyDescriptor | undefined>();
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-defaults-', created => {
	directory = created;
});
beforeEach(async () => {
	sent = [];
	window = new Window({ url: `${origin}/repositories` });
	for (const key of globals) {
		descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
	}
	const cookie = await world.adminCookie();
	const record = (source: 'dashboard' | 'cli', path: string, init?: RequestInit) => {
		if (!path.endsWith(previewPath) || typeof init?.body !== 'string') return;
		const body: unknown = JSON.parse(init.body);
		if (Predicate.isObject(body) && 'choices' in body) sent.push({ source, choices: body.choices });
	};
	const network = world.network.fetch;
	spyOn(globalThis, 'fetch').mockImplementation(Object.assign((input: string | URL | Request, init?: RequestInit) => {
		if (typeof input === 'string' && input.startsWith('/')) {
			record('dashboard', input, init);
			return world.handle(
				new Request(new URL(input, origin), { ...init, headers: { ...init?.headers, Cookie: cookie, Origin: origin } }),
			);
		}
		record('cli', input instanceof Request ? input.url : String(input), init);
		return network(input, init);
	}, { preconnect: fetch.preconnect }));
	await savedClient(world, directory);
});
afterEach(async () => {
	await window.happyDOM.close();
	for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
	descriptors.clear();
});

const declined = new Set([
	'Open or refresh the setup PR with this proposal? Answer no to choose the setup yourself.',
	'Open or refresh the setup PR with these exact changes?',
]);
const accepting: PromptEngine = {
	async promptOne(config) {
		if (config.kind === 'select') return { answered: true, value: config.choices[0].value };
		if (config.kind === 'confirm') {
			return { answered: true, value: declined.has(config.message) ? false : config.default ?? true };
		}
		if (config.kind === 'input') return { answered: true, value: config.default ?? '' };
		throw new Error(`No default answer for ${config.kind}: ${config.message}`);
	},
};

async function dashboardDefaults(repository: string): Promise<unknown> {
	const form = window.document.createElement('form');
	form.dataset.repository = repository;
	window.document.body.append(form);
	await Effect.runPromise(browser.setup(form, ''));
	await Effect.runPromise(browser.setup(form, 'preview'));
	return sent.filter(entry => entry.source === 'dashboard').at(-1)?.choices;
}

async function cliDefaults(repository: string): Promise<unknown> {
	const result = await app.execute(['adopt', repository], { prompter: accepting, isTTY: true, color: false, env: {} });
	expect(result.stderr.join('')).toBe('');
	return sent.filter(entry => entry.source === 'cli').at(-1)?.choices;
}

function fields(choices: unknown): [string, unknown][] {
	if (!Predicate.isObject(choices)) return [];
	const streams = Array.isArray(choices.streams) ? choices.streams.filter(Predicate.isObject) : [];
	return [
		...choicesFields.filter(field => field !== 'streams').map((field): [string, unknown] => [field, choices[field]]),
		...streams.flatMap(stream =>
			streamFields.flatMap((field): [string, unknown][] => {
				const value = stream[field];
				const path = `${String(stream.name)}.${field}`;
				if ((field !== 'prepare' && field !== 'promote') || !Predicate.isObject(value)) return [[path, value]];
				return workflowFields.map(entry => [`${path}.${entry}`, value[entry]]);
			})
		),
	];
}

const repositories: [string, (github: FakeGitHub) => Repository][] = [
	['an npm package with a publishing workflow', github => widget(github, { configured: false })],
	['a configured npm package', github => widget(github)],
	['a crate with a release binary', github =>
		github.create('octo/tool', {
			'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n\n[dependencies]\nnix = "0.30"\n',
			'src/main.rs': 'fn main() {}\n',
		})],
	['a tag-triggered release workflow', plugin],
	['one package with a single publishing step', github =>
		github.create('octo/single', {
			'package.json': '{"name":"single","version":"1.0.0"}',
			'.github/workflows/publish.yml':
				'name: Publish\non: workflow_dispatch\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - id: publish\n        name: Publish to npm\n        run: npm publish\n',
		})],
	['a workflow with automatic triggers and two jobs', github =>
		github.create('octo/pushed', {
			'package.json': '{"name":"pushed","version":"1.0.0"}',
			'.github/workflows/release.yml':
				'name: Release\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - id: publish\n        name: Publish\n        run: npm publish\n',
		})],
	['a workflow that already runs Beepboop in several jobs', refsRepository],
];

function refsRepository(github: FakeGitHub): Repository {
	return github.create('octo/refs', {
		'Cargo.toml': '[package]\nname = "git-remote-refs"\nversion = "0.1.0"\nedition = "2024"\nlicense = "MIT"\n',
		'package.json': '{"name":"git-remote-refs","version":"0.1.0","license":"MIT"}\n',
		'.github/workflows/publish.yml': readFileSync(
			join(import.meta.dir, '../fixtures/workflows/multi-job-publish.yml'),
			'utf8',
		),
	});
}

async function expectSameDefaults(repository: string) {
	const dashboard = fields(await dashboardDefaults(repository));
	const cli = fields(await cliDefaults(repository));
	expect(dashboard.length).toBeGreaterThan(0);
	expect(cli).toEqual(dashboard);
}

for (const [name, create] of repositories) {
	test(`the CLI and the dashboard default every setup field alike for ${name}`, async () => {
		await expectSameDefaults(create(world.github).name);
	});
}

test('the CLI and the dashboard keep a saved trigger handover of an automatic workflow', async () => {
	const repository = world.github.create('octo/shipped', {
		'package.json': '{"name":"shipped","version":"1.0.0"}',
		'.github/workflows/ship.yml':
			'on: push\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - id: publish_existing\n        name: Publish\n        run: npm publish\n',
	});
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	await applyChoices(api, repository.name, {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/shipped'],
			required: ['pkg:npm/shipped'],
			versioning: 'workspace',
			promote: {
				file: 'ship.yml',
				job: 'ship',
				triggers: 'dispatchOnly',
				commands: '',
				publicationSteps: { 'pkg:npm/shipped': 'publish_existing' },
			},
		}],
	});
	await expectSameDefaults(repository.name);
	expect(fields(sent.at(-1)?.choices)).toContainEqual(['main.promote.triggers', 'dispatchOnly']);
});

test('the setup editors declare an editor for every setup choice field', () => {
	expect(Object.keys(choicesEditors).sort()).toEqual([...choicesFields].sort());
	expect(Object.keys(streamEditors).sort()).toEqual([...streamFields].sort());
	expect(Object.keys(workflowEditors).sort()).toEqual([...workflowFields].sort());
});

test('the CLI suggests the one publishing step of a chosen workflow for one package, as the dashboard does', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/workflows/other.yml':
			'name: Other\non: workflow_dispatch\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - id: publish\n        name: Publish to npm\n        run: npm publish\n',
	}, 'Add a second publishing workflow');
	const asked: { message: string; first: string }[] = [];
	const prompter: PromptEngine = {
		async promptOne(config) {
			if (config.kind !== 'select') return accepting.promptOne(config);
			asked.push({ message: config.message, first: config.choices[0].value });
			const chosen = config.message.endsWith(': publish packages') ? 'other.yml' : config.choices[0].value;
			return { answered: true, value: chosen };
		},
	};
	await app.execute(['adopt', repository.name], { prompter, isTTY: true, color: false, env: {} });
	expect(asked.find(entry => entry.message.startsWith('Existing step that publishes'))?.first).toBe('publish');
});
