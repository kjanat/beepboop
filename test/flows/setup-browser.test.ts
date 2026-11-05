import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Effect } from 'effect';
import {
	Window,
	type Element,
	type HTMLElement,
	type HTMLFormElement,
	type HTMLInputElement,
	type HTMLSelectElement,
} from 'happy-dom';
import { z } from 'zod';
import { widget } from '@root/test/support/repositories.ts';
import { origin, World } from '@root/test/support/world.ts';
// Browser modules are checked separately to keep DOM and Worker Element types apart.
const browserModule = new URL('../../src/ui/browser/setup.ts', import.meta.url).href;
const browser: { setup(form: HTMLFormElement, action: string): Effect.Effect<void, unknown> } = await import(
	browserModule
);
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
beforeEach(async () => {
	world = await World.create();
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
	world.dispose();
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
	const control = label?.querySelector('input,select,textarea');
	if (!(control instanceof type)) throw new Error(`Missing control: ${title}`);
	return control;
}
function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
	control.value = value;
	control.dispatchEvent(new window.Event('change', { bubbles: true }));
}
async function open(repository: string) {
	const form = window.document.createElement('form');
	form.dataset.repository = repository;
	window.document.body.append(form);
	await act(form, '');
	return form;
}
function role(form: HTMLFormElement, name: string): HTMLElement {
	const node = form.querySelector(`[data-workflow-role="${name}"]`);
	if (!(node instanceof window.HTMLElement)) throw new Error(`Missing ${name} section`);
	return node;
}

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
		.toBe('npm publish');
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
	expect(form.checkValidity()).toBe(true);
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
	expect(workflow).toContain("cargo publish --package 'my-crate'");
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
