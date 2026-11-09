import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { bearer } from '@root/test/support/http.ts';
import { passChecks, plugin, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { applySetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import type { Element, HTMLElement, HTMLFormElement, HTMLInputElement, HTMLSelectElement } from 'happy-dom';
import { Window } from 'happy-dom';
import { z } from 'zod';
import { parseSetupPlan } from '@/automation/setup-plan';
import { routes } from '@/contract/routes';

// Browser modules are checked separately to keep DOM and Worker Element types apart.
const browserModule = new URL('../../src/ui/browser/setup.ts', import.meta.url).href;
const browser: { setup(form: HTMLFormElement, action: string): Effect.Effect<void, unknown> } = await import(
	browserModule
);
const dom: {
	find<T extends Element>(parent: Element | Window['document'], selector: string, type: { new(): T }): T | undefined;
} = await import(new URL('../../src/ui/browser/dom.ts', import.meta.url).href);
async function act(form: HTMLFormElement, action: string) {
	await Effect.runPromise(browser.setup(form, action));
}
let world: World;
let window: Window;
const globals = [
	'document',
	'HTMLFormElement',
	'HTMLInputElement',
	'HTMLSelectElement',
	'HTMLTextAreaElement',
	'HTMLButtonElement',
] as const;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
eachWorld(created => {
	world = created;
});
beforeEach(async () => {
	window = new Window({ url: `${origin}/repositories` });
	for (const key of globals) {
		descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
	}
	const cookie = await world.adminCookie();
	spyOn(globalThis, 'fetch').mockImplementation(Object.assign((input: string | URL | Request, init?: RequestInit) => {
		if (typeof input === 'string' && input.startsWith('/')) {
			return world.handle(
				new Request(new URL(input, origin), {
					...init,
					headers: { ...init?.headers, Cookie: cookie, Origin: origin },
				}),
			);
		}
		return world.network.fetch(input, init);
	}, { preconnect: fetch.preconnect }));
});
afterEach(async () => {
	await window.happyDOM.close();
	for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
	descriptors.clear();
});
function control<T extends Element>(parent: HTMLElement | Window['document'], title: string, type: { new(): T }): T {
	const label = [...parent.querySelectorAll('label')].find(label =>
		[...label.childNodes].some(node => node.nodeType === 3 && node.textContent === title)
	);
	const control = label && dom.find(label, 'input,select,textarea', type);
	if (!control) throw new Error(`Missing control: ${title}`);
	return control;
}
function changed(control: HTMLInputElement | HTMLSelectElement) {
	control.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
	control.value = value;
	changed(control);
}
function toggle(input: HTMLInputElement, checked: boolean) {
	input.checked = checked;
	changed(input);
}
async function open(repository: string) {
	const form = window.document.createElement('form');
	form.dataset.repository = repository;
	window.document.body.append(form);
	await act(form, '');
	return form;
}
function role(form: HTMLFormElement, name: string): HTMLElement {
	const section = dom.find(form, `[data-workflow-role="${name}"]`, window.HTMLElement);
	if (!section) throw new Error(`Missing ${name} section`);
	return section;
}

test('the dashboard asks for the security key only for a grant the server accepts', async () => {
	const api: {
		elevatedApi(
			route: typeof routes.credentialsGrant,
			input: (proof: string | undefined) => z.input<typeof routes.credentialsGrant.request>,
			prove: Effect.Effect<string>,
		): Effect.Effect<unknown, unknown>;
	} = await import(new URL('../../src/ui/browser/api.ts', import.meta.url).href);
	let prompts = 0;
	const prove = Effect.sync(() => {
		prompts++;
		return 'proof';
	});
	const grant = (repositoryId: number) => (proof: string | undefined) => ({
		proof,
		selection: { alias: 'npm-token', repositoryId, stream: 'main', operation: 'promote', delivery: 'runtime' },
	});
	const unconfigured = widget(world.github, { configured: false });
	const session = bearer(world, await world.cliSession());
	await session('/api/repositories/discover', { repository: unconfigured.name });
	const refused = await Effect.runPromise(
		Effect.flip(api.elevatedApi(routes.credentialsGrant, grant(unconfigured.id), prove)),
	);
	expect(refused).toMatchObject({ status: 422, message: 'Repository not configured' });
	expect(prompts).toBe(0);

	world.github.push(unconfigured, { '.github/beepboop.json': widgetConfiguration() }, 'Configure releases');
	await session('/api/repositories/discover', { repository: unconfigured.name });
	await world.sealCredential('npm-token');
	await world.elevate();
	expect(await Effect.runPromise(api.elevatedApi(routes.credentialsGrant, grant(unconfigured.id), prove))).toEqual({
		granted: true,
	});
	expect(prompts).toBe(1);
});

test('new publishing workflows get editable filenames, jobs and triggers automatically', async () => {
	widget(world.github, { configured: false });
	const form = await open('octo/widget');
	const publishing = role(form, 'promote');
	change(control(publishing, 'Publishing workflow', window.HTMLSelectElement), 'new');
	const filename = control(publishing, 'Workflow file (you can rename it)', window.HTMLInputElement);
	expect(filename.value).toBe('release-widget.yml');
	expect(control(publishing, 'Which job publishes these packages?', window.HTMLSelectElement).disabled).toBe(true);
	expect(control(publishing, 'Who starts this workflow?', window.HTMLSelectElement).disabled).toBe(true);
	expect(control(publishing, 'Shell commands that publish the selected packages', window.HTMLTextAreaElement).value)
		.toBe('beepboop publish');
	expect(publishing.textContent).toContain(
		'A lone beepboop publish line publishes Cargo, npm and PyPI packages through Beepboop.',
	);
	expect(publishing.textContent).toContain('Do not paste workflow YAML');
	filename.value = 'release-my-way.yml';
	filename.dispatchEvent(new window.Event('input', { bubbles: true }));
	await act(form, 'preview');
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
	expect(form.querySelector('.setup-result')?.textContent).toContain('.github/workflows/release-my-way.yml');
	const commands = control(publishing, 'Shell commands that publish the selected packages', window.HTMLTextAreaElement);
	commands.value = 'npm publish --access public';
	commands.dispatchEvent(new window.Event('input', { bubbles: true }));
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(true);
	await expect(act(form, 'apply')).rejects.toThrow('Preview these choices again');
});

test('managed preparation hides and disables all job and command inputs', async () => {
	widget(world.github, { configured: false });
	const form = await open('octo/widget');
	const preparing = role(form, 'prepare');
	const mode = control(preparing, 'How should release changes be prepared?', window.HTMLSelectElement);
	change(mode, 'new');
	change(mode, '');
	for (const input of preparing.querySelectorAll('input,textarea,select')) {
		if (input === mode) continue;
		expect(input.hasAttribute('disabled')).toBe(true);
		expect(input.closest('[hidden]')).not.toBeNull();
	}
	expect(preparing.textContent).toContain('Only the publishing workflow is needed.');
	const override = control(form, 'Actions revision override (optional)', window.HTMLInputElement);
	expect(override.closest('details')?.hasAttribute('open')).toBe(false);
	expect(form.textContent).not.toContain('Keep unchanged;');
});

test('existing workflows ask for a job only when the choice is ambiguous', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/workflows/other.yml': `name: Other
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  ship:
    runs-on: ubuntu-latest
    steps:
      - id: publish
        name: Publish to npm
        run: npm publish
`,
	}, 'Add a workflow with two jobs');
	const form = await open(repository.name);
	const publishing = role(form, 'promote');
	change(control(publishing, 'Publishing workflow', window.HTMLSelectElement), 'other.yml');
	const job = control(publishing, 'Which job publishes these packages?', window.HTMLSelectElement);
	expect(job.disabled).toBe(false);
	expect(publishing.textContent).toContain('A job is a named group of steps');
	change(job, 'ship');
	expect(control(publishing, 'Publishing step for widget', window.HTMLSelectElement).value).toBe('publish');
	expect(control(publishing, 'Shell commands that publish the selected packages', window.HTMLTextAreaElement).disabled)
		.toBe(true);
	expect(control(publishing, 'Who starts this workflow?', window.HTMLSelectElement).disabled).toBe(false);
	change(control(publishing, 'Publishing workflow', window.HTMLSelectElement), 'publish.yml');
	expect(job.disabled).toBe(true);
	expect(publishing.textContent).toContain('Using the publish job');
});

test('mapping one existing publishing step to multiple packages requires explicit choices', async () => {
	const repository = world.github.create('octo/packages', {
		'packages/a/package.json': '{"name":"package-a","version":"1.0.0"}',
		'packages/b/package.json': '{"name":"package-b","version":"1.0.0"}',
		'.github/workflows/publish.yml': `name: Publish
on: workflow_dispatch
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - id: publish_a
        name: Publish A
        run: ./scripts/publish-a.sh
`,
	});
	const form = await open(repository.name);
	const publishing = role(form, 'promote');
	change(control(publishing, 'Publishing workflow', window.HTMLSelectElement), 'publish.yml');
	const mapping = (name: string) => control(publishing, `Publishing step for ${name}`, window.HTMLSelectElement);
	const commands = control(publishing, 'Shell commands that publish the selected packages', window.HTMLTextAreaElement);
	expect(mapping('package-a').value).toBe('');
	expect(mapping('package-b').value).toBe('');
	expect(commands.required).toBe(true);
	expect(commands.disabled).toBe(false);

	// A single-package suggestion must not become an explicit mapping after adding packages again.
	const packageB = control(form, 'package-b (packages/b/package.json)', window.HTMLInputElement);
	toggle(packageB, false);
	expect(mapping('package-a').value).toBe('publish_a');
	toggle(packageB, true);
	expect(mapping('package-a').value).toBe('');
	expect(mapping('package-b').value).toBe('');

	change(mapping('package-a'), 'publish_a');
	expect(commands.required).toBe(true);
	change(mapping('package-b'), 'publish_a');
	expect(commands.disabled).toBe(true);
	const group = control(form, 'Release group name', window.HTMLInputElement);
	group.dispatchEvent(new window.Event('input', { bubbles: true }));
	expect(mapping('package-a').value).toBe('publish_a');
	expect(mapping('package-b').value).toBe('publish_a');
	await act(form, 'preview');
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
});

test('Cargo setup creates one workflow with preparation and publishing jobs', async () => {
	const repository = world.github.create('octo/crates', {
		'Cargo.toml': '[package]\nname = "my-crate"\nversion = "1.0.0"\nedition = "2024"\n',
		'Cargo.lock': '# Lockfile\n',
		'src/lib.rs': '',
	});
	const form = await open(repository.name);
	const publishing = role(form, 'promote'), preparing = role(form, 'prepare');
	expect(control(publishing, 'Workflow file (you can rename it)', window.HTMLInputElement).value).toBe(
		'release-my-crate.yml',
	);
	expect(control(preparing, 'How should release changes be prepared?', window.HTMLSelectElement).value).toBe('same');
	expect(control(preparing, 'Workflow file (you can rename it)', window.HTMLInputElement).disabled).toBe(true);
	expect(
		control(preparing, 'Shell commands to update lockfiles and check the release', window.HTMLTextAreaElement).value,
	).toContain('cargo check --workspace');
	await act(form, 'preview');
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
	await act(form, 'apply');
	expect(repository.pulls).toHaveLength(1);
	const head = world.github.resolve(repository, 'automation/onboarding');
	const tree = repository.trees.get(head.tree);
	expect([...tree?.keys() ?? []].filter(path => path.startsWith('.github/workflows/'))).toEqual([
		'.github/workflows/release-my-crate.yml',
	]);
	const workflow = world.github.file(repository, '.github/workflows/release-my-crate.yml', 'automation/onboarding')
		?? '';
	expect(workflow).toContain("inputs.beepboop_operation == 'prepare'");
	expect(workflow).toContain("inputs.beepboop_operation == 'publish'");
	expect(workflow).toContain('uses: kjanat/beepboop/actions/publish@v1');
	const binding = z.object({ file: z.string(), inputs: z.object({ beepboop_operation: z.string() }) });
	const configuration = z.object({
		streams: z.object({
			main: z.object({
				prepare: z.object({ workflow: binding }),
				promote: z.object({ workflow: binding }),
			}),
		}),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'));
	expect(configuration.streams.main.prepare.workflow.inputs.beepboop_operation).toBe('prepare');
	expect(configuration.streams.main.promote.workflow.inputs.beepboop_operation).toBe('publish');
	await act(form, 'preview');
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
	world.github.merge(repository, 1);
	const configured = await open(repository.name);
	expect(
		control(role(configured, 'prepare'), 'How should release changes be prepared?', window.HTMLSelectElement).value,
	).toBe('same');
	await act(configured, 'preview');
	expect(configured.querySelector('.setup-result')?.textContent).toContain('No file changes needed.');
	world.github.push(repository, {
		'.github/workflows/release-my-crate.yml': workflow.replace("== 'publish'", "== 'prepare'"),
	}, 'Change the publication job condition');
	await act(configured, 'preview');
	expect(configured.querySelector('.setup-result')?.textContent).toContain(
		'shared workflows need separate preparation and publication jobs guarded by beepboop_operation',
	);
	expect(configured.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(true);
});

test('extension manifests require explicit publishing commands instead of npm suggestions', async () => {
	world.github.create('octo/extension', {
		'package.json': JSON.stringify({
			name: 'extension',
			publisher: 'octo',
			version: '1.0.0',
			engines: { vscode: '^1.80.0' },
		}),
	});
	const form = await open('octo/extension');
	const publishing = role(form, 'promote');
	const commands = control(publishing, 'Shell commands that publish the selected packages', window.HTMLTextAreaElement);
	expect(commands.value).toBe('');
	expect(commands.required).toBe(true);
	expect(commands.placeholder).not.toContain('npm publish');
	await expect(act(form, 'preview')).rejects.toThrow('Enter the shell commands that publish these packages.');
});

test('generated npm targets require explicit commands, including alongside ordinary packages', async () => {
	const repository = world.github.create('octo/generated', {
		'Cargo.toml': '[workspace]\nmembers = []\n[workspace.package]\nversion = "1.0.0"\n',
		'npm/targets.json': JSON.stringify({
			scope: '@octo',
			facade: '@octo/widget',
			targets: [{ pkg: 'widget-linux-x64' }, { pkg: 'widget-darwin-arm64' }],
		}),
		'packages/ordinary/package.json': '{"name":"ordinary","version":"1.0.0"}',
	});
	const form = await open(repository.name);
	const publishing = role(form, 'promote'), preparing = role(form, 'prepare');
	const commands = control(publishing, 'Shell commands that publish the selected packages', window.HTMLTextAreaElement);
	const ordinary = control(form, 'ordinary (packages/ordinary/package.json)', window.HTMLInputElement);
	const targets = ['@octo/widget-linux-x64', '@octo/widget-darwin-arm64', '@octo/widget'].map(name =>
		control(form, `${name} (npm/targets.json)`, window.HTMLInputElement)
	);
	expect(commands.value).toBe('');
	expect(commands.required).toBe(true);
	await expect(act(form, 'preview')).rejects.toThrow('Enter the shell commands that publish these packages.');
	toggle(ordinary, false);
	expect(commands.value).toBe('');
	expect(commands.required).toBe(true);
	for (const target of targets) toggle(target, false);
	toggle(ordinary, true);
	expect(commands.value).toBe('beepboop publish');
	for (const target of targets) toggle(target, true);
	expect(commands.value).toBe('');

	change(control(preparing, 'How should release changes be prepared?', window.HTMLSelectElement), 'new');
	const checks = control(
		preparing,
		'Shell commands to update lockfiles and check the release',
		window.HTMLTextAreaElement,
	);
	expect(checks.value).toBe('');
	expect(checks.required).toBe(true);
	commands.value = './scripts/generate-npm.sh\n./scripts/publish-npm.sh';
	commands.dispatchEvent(new window.Event('input', { bubbles: true }));
	await expect(act(form, 'preview')).rejects.toThrow('Enter the shell commands that prepare and check the release.');
	checks.value = './scripts/prepare-npm.sh';
	checks.dispatchEvent(new window.Event('input', { bubbles: true }));
	await act(form, 'preview');
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
	await act(form, 'apply');
	expect(world.github.file(repository, '.github/workflows/release-generated.yml', 'automation/onboarding'))
		.toContain('./scripts/generate-npm.sh\n');
	expect(world.github.file(repository, '.github/workflows/release-generated.yml', 'automation/onboarding'))
		.toContain('./scripts/publish-npm.sh');
	expect(world.github.file(repository, '.github/workflows/prepare-generated.yml', 'automation/onboarding'))
		.toContain('./scripts/prepare-npm.sh');
});

test('existing shared Go workflows do not require replacement preparation commands', async () => {
	const repository = world.github.create('octo/tagged', { 'go.mod': 'module github.com/octo/tagged\n\ngo 1.26\n' });
	const api = bearer(world, await world.cliSession());
	const choices = {
		streams: [{
			name: 'main',
			packages: ['pkg:golang/github.com/octo/tagged'],
			required: [],
			versioning: 'workspace',
			prepare: { file: 'release.yml', job: 'check', commands: 'go test ./...' },
			promote: { file: 'release.yml', job: 'ship', commands: 'goreleaser release' },
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	expect(
		(await applySetup(api, repository.name, plan, plan.choices)).status,
	).toBe(200);
	world.github.merge(repository, 1);
	const form = await open(repository.name);
	const preparing = role(form, 'prepare');
	const commands = control(
		preparing,
		'Shell commands to update lockfiles and check the release',
		window.HTMLTextAreaElement,
	);
	expect(control(preparing, 'How should release changes be prepared?', window.HTMLSelectElement).value).toBe('same');
	expect(commands.value).toBe('go test ./...');
	expect(commands.required).toBe(false);
	expect(commands.disabled).toBe(true);
	await act(form, 'preview');
	expect(form.querySelector('.setup-result')?.textContent).toContain('No file changes needed.');
});

test('an accidentally added release group can be disabled without losing existing choices', async () => {
	widget(world.github, { configured: false });
	const form = await open('octo/widget');
	const add = [...form.querySelectorAll('button')].find(button => button.textContent === 'Add another release group');
	if (!add) throw new Error('Missing add group button');
	add.click();
	const enabled = control(form, 'Include this release group', window.HTMLInputElement);
	toggle(enabled, false);
	// happy-dom does not propagate fieldset disabling to descendant validity checks.
	expect(enabled.closest('fieldset')?.querySelector('.setup-group-body')?.hasAttribute('disabled')).toBe(true);
	await act(form, 'preview');
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
});

for (const locked of [false, true]) {
	test(`switching publishing workflows resets unavailable shared preparation (locked=${locked})`, async () => {
		const repository = widget(world.github, { configured: false });
		if (locked) world.github.push(repository, { 'package-lock.json': '{"lockfileVersion":3}\n' }, 'Add a lockfile');
		const form = await open('octo/widget');
		const publishing = role(form, 'promote'), preparing = role(form, 'prepare');
		const publication = control(publishing, 'Publishing workflow', window.HTMLSelectElement);
		const preparation = control(preparing, 'How should release changes be prepared?', window.HTMLSelectElement);
		change(publication, 'new');
		change(preparation, 'same');
		change(publication, 'publish.yml');
		expect([...preparation.options].find(option => option.value === 'same')?.disabled).toBe(true);
		expect(preparation.value).toBe(locked ? 'new' : '');
		if (!locked) expect(preparing.textContent).toContain('Only the publishing workflow is needed.');
		await act(form, 'preview');
		expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
	});
}

test('an observed stream rejects a package its workflows do not publish', async () => {
	const repository = world.github.create('octo/pair', {
		'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
		'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
		'.github/workflows/release.yml':
			"name: Release\non:\n  push: { tags: ['v*'] }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm --prefix packages/a publish\n",
	});
	passChecks(repository, world.github.head(repository));
	const form = await open('octo/pair');
	await act(form, 'preview');
	expect(form.querySelector('.setup-result')?.textContent).toContain('"mode": "observe"');
	control(form, 'a (packages/a/package.json)', window.HTMLInputElement).checked = false;
	control(form, 'b (packages/b/package.json)', window.HTMLInputElement).checked = true;
	await expect(act(form, 'preview')).rejects.toThrow('not published by the observed workflows');
});

test('an observed branch publisher without publication checks keeps its proposed packages', async () => {
	const repository = world.github.create('octo/branchy', {
		'package.json': JSON.stringify({ name: 'branchy', version: '1.0.0' }),
		'.github/workflows/release.yml':
			'name: Release\non:\n  push: { branches: [release] }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n',
	});
	passChecks(repository, world.github.head(repository));
	const form = await open('octo/branchy');
	await act(form, 'preview');
	expect(form.querySelector('.setup-result')?.textContent).toContain('"mode": "observe"');
});

test('an inferred stream keeps its workflow until observation is cleared', async () => {
	plugin(world.github);
	const form = await open('octo/plugin');
	const keep = control(
		form,
		'Keep release.yml with their own triggers; Beepboop observes their runs and publications',
		window.HTMLInputElement,
	);
	expect(keep.checked).toBe(true);
	expect(role(form, 'promote').hidden).toBe(true);
	expect(role(form, 'prepare').hidden).toBe(true);
	expect(role(form, 'promote').hasAttribute('disabled')).toBe(true);
	await act(form, 'preview');
	expect(form.querySelector('button[value="apply"]')?.hasAttribute('disabled')).toBe(false);
	expect(form.querySelector('.setup-result')?.textContent).toContain('"mode": "observe"');
	toggle(keep, false);
	expect(role(form, 'promote').hidden).toBe(false);
	expect(role(form, 'promote').hasAttribute('disabled')).toBe(false);
	await expect(act(form, 'preview')).rejects.toThrow('Select at least one package to release.');
});
