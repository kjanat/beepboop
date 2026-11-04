import { z } from 'zod';
import { publishable } from '@/automation/package-publication';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices, SetupPlan, SetupWorkflow } from '@/automation/setup-types';
import { oneOf } from '@/model';
import { api, find, show } from '@/ui/browser/dom';
import { packageLabel } from '@/ui/package-label';

const setupPlan = z.unknown().transform(parseSetupPlan);
const sessions = new WeakMap<
	HTMLFormElement,
	{ plan: SetupPlan; choices: () => SetupChoices; reviewed?: string; takeOver?: string }
>();
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.textContent = text;
	return node;
}
function label(parent: HTMLElement, title: string, control: HTMLElement) {
	const wrapper = element('label', title);
	if (control instanceof HTMLInputElement && control.type === 'checkbox') {
		wrapper.className = 'check';
		wrapper.prepend(control);
	} else wrapper.append(control);
	parent.append(wrapper);
}
function text(parent: HTMLElement, title: string, value = '', multiline = false) {
	const control = multiline ? element('textarea') : element('input');
	control.value = value;
	label(parent, title, control);
	return control;
}
function select(parent: HTMLElement, title: string, entries: [string, string][], value: string) {
	const control = element('select');
	for (const [key, title] of entries) control.add(new Option(title, key));
	control.value = value;
	label(parent, title, control);
	return control;
}
function checks(parent: HTMLElement, title: string, entries: [string, string][], selected: string[]) {
	const fieldset = element('fieldset');
	fieldset.append(element('legend', title));
	const controls = entries.map(([value, title]) => {
		const control = element('input');
		control.type = 'checkbox';
		control.value = value;
		control.checked = selected.includes(value);
		label(fieldset, title, control);
		return control;
	});
	parent.append(fieldset);
	return () => controls.filter(control => control.checked).map(control => control.value);
}
function workflow(
	parent: HTMLElement,
	role: 'prepare' | 'promote',
	plan: SetupPlan,
	choice?: SetupWorkflow,
): () => SetupWorkflow | undefined {
	const box = element('fieldset');
	box.append(element('legend', role === 'prepare' ? 'Preparation workflow' : 'Publication workflow'));
	const file = select(box, 'Workflow', [
		['', 'Select a workflow'],
		...plan.workflows.map((w): [string, string] => [w.file, `${w.file} (${w.events.join(', ')})`]),
		['new', 'Create a workflow'],
	], choice?.file ?? '');
	const newFile = text(box, 'New workflow filename', '');
	if (newFile.parentElement) newFile.parentElement.hidden = file.value !== 'new';
	newFile.required = file.value === 'new';
	const job = select(box, 'Job', [['', 'Select a job']], '');
	const mappings = element('div');
	const mappingControls = new Map<string, HTMLSelectElement>();
	const refresh = () => {
		if (newFile.parentElement) newFile.parentElement.hidden = file.value !== 'new';
		newFile.required = file.value === 'new';
		const evidence = plan.workflows.find(w => w.file === file.value);
		job.replaceChildren(new Option(file.value === 'new' ? role : 'Select a job', file.value === 'new' ? role : ''));
		for (const name of evidence?.jobs ?? []) job.add(new Option(name, name));
		job.value = choice?.file === file.value && choice.job
			? choice.job
			: evidence?.jobs.length === 1
			? evidence.jobs[0] ?? ''
			: file.value === 'new'
			? role
			: '';
		refreshMappings();
	};
	const refreshMappings = () => {
		const evidence = plan.workflows.find(w => w.file === file.value);
		mappings.replaceChildren();
		mappingControls.clear();
		if (role === 'promote' && !evidence?.reportingJobs.includes(job.value)) {
			mappings.append(
				element('p', 'Select the command step publishing each package. For new commands below, leave this empty.'),
			);
			for (const pkg of plan.inventory.packages.filter(pkg => publishable(pkg))) {
				// The API returns canonical identities; no display-only identifier reconstruction.
				const id = plan.inventory.packages.indexOf(pkg);
				const purl = plan.packageIds[id];
				if (!purl) continue;
				mappingControls.set(
					purl,
					select(mappings, pkg.name, [
						['', 'New publication commands'],
						...(evidence?.steps ?? []).filter(step => step.job === job.value).map((step): [string, string] => [
							step.id,
							`${step.job} / ${step.label}`,
						]),
					], choice?.publicationSteps[purl] ?? ''),
				);
			}
		}
	};
	job.addEventListener('change', refreshMappings);
	file.addEventListener('change', refresh);
	refresh();
	const triggers = select(box, 'Trigger handover', [['review', 'Keep unchanged; flag conflicts for review'], [
		'dispatchOnly',
		'Use Beepboop dispatch only (replace existing triggers)',
	], ['preserve', 'Preserve existing triggers (requires compatible integration)']], choice?.triggers ?? 'review');
	const commands = text(
		box,
		role === 'prepare'
			? 'Preparation commands, if integration must be added (install, lockfile updates, build, tests)'
			: 'Publication commands, if a new publishing step is needed',
		choice?.commands ?? '',
		true,
	);
	box.append(mappings);
	parent.append(box);
	return () =>
		file.value
			? {
				file: file.value === 'new' ? newFile.value : file.value,
				job: job.value || undefined,
				triggers: oneOf(triggers.value, ['review', 'dispatchOnly', 'preserve'], 'Invalid trigger handover'),
				commands: commands.value,
				publicationSteps: Object.fromEntries(
					[...mappingControls].filter(([, control]) => control.value).map(([id, control]) => [id, control.value]),
				),
			}
			: undefined;
}
function editor(form: HTMLFormElement, plan: SetupPlan) {
	form.replaceChildren();
	form.append(
		element('h3', 'Configure release streams'),
		element('p', 'Choose packages and workflows. Preview the exact changes before opening or refreshing the setup PR.'),
	);
	const revision = text(
		form,
		'Beepboop Actions version or commit (default v1)',
		plan.choices.actionsRevision ?? '',
	);
	const streams = element('div');
	form.append(streams);
	const readers: (() => SetupChoices['streams'][number])[] = [];
	const add = (value: SetupChoices['streams'][number]) => {
		const box = element('fieldset');
		box.append(element('legend', 'Release stream'));
		const enabled = element('input');
		enabled.type = 'checkbox';
		enabled.checked = true;
		label(box, 'Include this stream in the proposal', enabled);
		const name = text(box, 'Stream name', value.name);
		name.required = true;
		if (name instanceof HTMLInputElement) name.pattern = '[a-z][a-z0-9-]{0,63}';
		enabled.addEventListener('change', () => {
			name.required = enabled.checked;
		});
		const versioning = select(box, 'Versioning', [['workspace', 'One version for the stream'], [
			'independent',
			'Independent package versions',
		], ['none', 'No version']], value.versioning);
		const entries = plan.inventory.packages.flatMap((pkg, index): [string, string][] =>
			publishable(pkg)
				? [[
					plan.packageIds[index] ?? '',
					`${packageLabel(plan.packageIds[index] ?? '')} (${pkg.manifest})`,
				]]
				: []
		);
		const packages = checks(box, 'Packages', entries, value.packages);
		const prepare = workflow(box, 'prepare', plan, value.prepare),
			promote = workflow(box, 'promote', plan, value.promote);
		streams.append(box);
		readers.push(() => ({
			name: enabled.checked ? name.value : '',
			versioning: oneOf(versioning.value, ['workspace', 'independent', 'none'], 'Invalid versioning'),
			packages: packages(),
			required: packages(),
			prepare: prepare(),
			promote: promote(),
		}));
	};
	plan.choices.streams.forEach(add);
	const addButton = element('button', 'Add stream');
	addButton.type = 'button';
	addButton.addEventListener('click', () => {
		add({ name: '', versioning: 'workspace', packages: [], required: [] });
		invalidate();
	});
	form.append(addButton);
	const preview = element('button', 'Preview setup changes');
	preview.value = 'preview';
	const apply = element('button', 'Open or refresh setup PR');
	apply.value = 'apply';
	apply.disabled = true;
	const takeOver = element('button', 'Take over setup branch');
	takeOver.value = 'takeover';
	takeOver.hidden = true;
	const result = element('div');
	result.className = 'setup-result';
	result.setAttribute('aria-live', 'polite');
	form.append(preview, apply, takeOver, result);
	const choices = () => ({
		streams: readers.map(read => read()).filter(stream => stream.name),
		...(revision.value ? { actionsRevision: revision.value } : {}),
	});
	sessions.set(form, { plan, choices });
	function invalidate() {
		const session = sessions.get(form);
		if (session) {
			delete session.reviewed;
			delete session.takeOver;
		}
		apply.disabled = true;
		takeOver.hidden = true;
	}
	form.addEventListener('input', invalidate);
	form.addEventListener('change', invalidate);
}
function review(form: HTMLFormElement, plan: SetupPlan) {
	const result = form.querySelector('.setup-result');
	if (!result) return;
	result.replaceChildren(element('h3', 'Review setup changes'), element('p', `Inspected commit: ${plan.sourceSha}`));
	for (const message of [...plan.blockers, ...plan.notes]) result.append(element('p', message));
	if (plan.prior) {
		const link = element(
			'a',
			plan.prior.superseded ? 'Previous setup proposal — superseded by current configuration' : 'Existing setup PR',
		);
		link.href = plan.prior.url;
		result.append(link);
	}
	for (const edit of plan.edits) {
		const details = element('details');
		details.append(
			element('summary', edit.path),
			element('h4', 'Current'),
			element('pre', edit.before),
			element('h4', 'Proposed'),
			element('pre', edit.after),
		);
		result.append(details);
	}
	if (!plan.edits.length) result.append(element('p', 'No file changes needed.'));
	const apply = find(form, 'button[value="apply"]', HTMLButtonElement);
	if (apply) apply.disabled = !!plan.blockers.length || !plan.edits.length;
	const takeOver = find(form, 'button[value="takeover"]', HTMLButtonElement);
	if (takeOver) takeOver.hidden = !takeOverAllowed(plan);
	if (plan.branchConflict) {
		result.append(
			element('p', 'Taking over force-pushes this proposal and deletes the other commits on the setup branch.'),
		);
	}
}
function takeOverAllowed(plan: SetupPlan): boolean {
	return plan.branchConflict && plan.blockers.length === 1 && plan.edits.length > 0;
}
export async function setup(form: HTMLFormElement, action: string) {
	const repository = form.dataset.repository;
	if (!repository) throw new Error('Repository missing');
	if (!sessions.has(form)) {
		const plan = await api('/api/repositories/setup/preview', setupPlan, { repository });
		editor(form, plan);
		review(form, plan);
		const apply = find(form, 'button[value="apply"]', HTMLButtonElement);
		if (apply) apply.disabled = true;
		return;
	}
	const session = sessions.get(form);
	if (!session) return;
	const choices = session.choices(), identity = JSON.stringify(choices);
	if (action !== 'apply' && action !== 'takeover') {
		delete session.reviewed;
		const plan = await api('/api/repositories/setup/preview', setupPlan, { repository, choices });
		session.plan = plan;
		if (!plan.blockers.length) session.reviewed = identity;
		if (takeOverAllowed(plan)) session.takeOver = identity;
		review(form, plan);
		return;
	}
	const takingOver = action === 'takeover';
	if ((takingOver ? session.takeOver : session.reviewed) !== identity) {
		throw new Error('Preview these choices again before applying.');
	}
	const { planId, sourceSha, setupHead } = session.plan;
	const result = await api('/api/repositories/setup/apply', z.object({ url: z.string() }), {
		repository,
		choices,
		planId,
		sourceSha,
		setupHead,
		...(takingOver ? { takeOver: true } : {}),
	});
	delete session.reviewed;
	delete session.takeOver;
	const output = form.querySelector('.setup-result');
	if (output) {
		const link = element('a', 'Review setup pull request');
		link.href = result.url;
		output.replaceChildren(link);
	}
	show('Setup PR ready for review. Merge it yourself, then refresh inspection.');
}

export function canApplySetup(form: HTMLFormElement): boolean {
	return !!sessions.get(form)?.reviewed;
}
