import { Result } from 'effect';
import type { SetupPlan, SetupWorkflow } from '@/automation/setup-types';
import { Refused } from '@/ui/browser/dom';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.textContent = text;
	return node;
}
export function hint(parent: HTMLElement, message: string) {
	const node = element('p', message);
	node.className = 'hint';
	parent.append(node);
	return node;
}
export function label(parent: HTMLElement, title: string, control: HTMLElement) {
	const wrapper = element('label', title);
	if (control instanceof HTMLInputElement && control.type === 'checkbox') {
		wrapper.className = 'check';
		wrapper.prepend(control);
	} else wrapper.append(control);
	parent.append(wrapper);
	return wrapper;
}
export function text(parent: HTMLElement, title: string, value = '') {
	const control = element('input');
	control.value = value;
	label(parent, title, control);
	return control;
}
function option(value: string, title: string) {
	const node = element('option', title);
	node.value = value;
	return node;
}
export function select(parent: HTMLElement, title: string, entries: [string, string][], value: string) {
	const control = element('select');
	control.append(...entries.map(([value, title]) => option(value, title)));
	control.value = value;
	label(parent, title, control);
	return control;
}
export interface Selection {
	name: string;
	packages: { id: string; name: string; manifest: string; versionSource?: string; manager?: string }[];
}
export function preparationReasons(plan: SetupPlan, selection: Selection): string[] {
	const reasons: string[] = [];
	if (plan.preparation?.lockfiles.length) {
		reasons.push(`${plan.preparation.lockfiles.join(', ')} must be updated with the package versions.`);
	}
	if (plan.preparation?.workflowStreams.includes(selection.name)) {
		reasons.push('This repository delegates version preparation to a workflow.');
	}
	if (
		selection.packages.length && selection.packages.every(pkg => pkg.versionSource?.startsWith('tags:'))
		&& !plan.preparation?.versionFileStreams.includes(selection.name)
	) reasons.push('These packages take their versions from Git tags and need a preparation job.');
	return reasons;
}
function slug(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'packages';
}
function quote(value: string) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
export function suggestedCommands(role: 'prepare' | 'promote', selection: Selection, plan: SetupPlan): string {
	const order = plan.inventory.publicationOrder ?? [];
	const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
	const packages = [...selection.packages].sort((left, right) => rank(left.id) - rank(right.id));
	if (!packages.length) return '';
	if (packages.every(pkg => pkg.manager === 'cargo')) {
		return role === 'prepare'
			? 'cargo check --workspace --all-targets\ncargo test --workspace'
			: packages.map(pkg => `cargo publish --package ${quote(pkg.name)}`).join('\n');
	}
	if (packages.every(pkg => pkg.manager === 'npm')) {
		const npm = plan.preparation?.lockfiles.some(path => path.endsWith('package-lock.json'));
		const lockfiles = plan.preparation?.lockfiles ?? [];
		const install = lockfiles.some(path => path.endsWith('bun.lock'))
			? 'bun install'
			: lockfiles.some(path => path.endsWith('pnpm-lock.yaml'))
			? 'pnpm install --no-frozen-lockfile'
			: lockfiles.some(path => path.endsWith('yarn.lock'))
			? 'YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install'
			: npm
			? 'npm install --package-lock-only\nnpm ci'
			: 'npm install';
		const command = role === 'promote' ? 'npm publish' : `${install}\nnpm run test --if-present`;
		return [
			...new Set(packages.map(pkg => {
				const dir = pkg.manifest.split('/').slice(0, -1).join('/');
				return dir ? `(cd ${quote(dir)} &&\n${command}\n)` : command;
			})),
		].join('\n');
	}
	return '';
}
export interface WorkflowEditor {
	read(): Result.Result<SetupWorkflow | undefined, Refused>;
	file(): string;
	isNew(): boolean;
	refresh(): void;
	onChange?: () => void;
}
export function workflow(
	parent: HTMLElement,
	role: 'prepare' | 'promote',
	plan: SetupPlan,
	selection: () => Selection,
	initial?: SetupWorkflow,
	publication?: WorkflowEditor,
): WorkflowEditor {
	const preparing = role === 'prepare';
	const box = element('fieldset');
	box.dataset.workflowRole = role;
	box.append(element('legend', preparing ? 'Prepare the release PR' : 'Publish packages'));
	hint(
		box,
		preparing
			? 'Preparation updates version files before publication. The release PR is reviewed and merged before anything is published.'
			: 'Choose where publishing runs. Beepboop will propose the workflow and configuration in a PR for you to review.',
	);
	const known = initial && plan.workflows.find(w => w.file === initial.file);
	const pairedInitially = preparing && initial && initial.file === publication?.file();
	const file = select(box, preparing ? 'How should release changes be prepared?' : 'Publishing workflow', [
		...(preparing
			? [['', 'Beepboop opens the version PR (no preparation job)'], [
				'same',
				'Add a preparation job to the publishing workflow',
			]] as [string, string][]
			: []),
		['new', preparing ? 'Create a separate preparation workflow' : 'Create a release workflow'],
		...plan.workflows.map((w): [string, string] => [w.file, w.file]),
	], pairedInitially ? 'same' : known ? initial.file : initial ? 'new' : preparing ? '' : 'new');
	let modeEdited = !!initial, filenameEdited = !!initial && !known;
	const explanation = hint(box, '');
	const controls = element('div');
	box.append(controls);
	const filename = text(controls, 'Workflow file (you can rename it)', initial?.file ?? '');
	filename.pattern = '[A-Za-z0-9_\\-]+\\.ya?ml';
	const job = select(
		controls,
		preparing ? 'Which job prepares the release?' : 'Which job publishes these packages?',
		[],
		'',
	);
	const jobSlot = element('div');
	if (job.parentElement) jobSlot.append(job.parentElement);
	controls.append(jobSlot);
	const jobHelp = hint(controls, '');
	const jobOverride = element('details');
	jobOverride.append(element('summary', 'Choose a different job (optional)'));
	controls.append(jobOverride);
	const triggers = select(controls, 'Who starts this workflow?', [
		['review', 'Keep the current triggers and check compatibility in preview'],
		['dispatchOnly', 'Beepboop only (replace current automatic triggers)'],
	], initial?.triggers === 'dispatchOnly' ? 'dispatchOnly' : 'review');
	const triggerHelp = hint(
		controls,
		'Replacing triggers stops this workflow from running automatically on pushes or tags. Preview shows the exact changes.',
	);
	const mappings = element('div');
	controls.append(mappings);
	const commandBox = element('div');
	const commands = element('textarea');
	commands.rows = 4;
	commands.spellcheck = false;
	commands.placeholder = preparing
		? 'For example: ./scripts/check-release.sh'
		: 'For example: ./scripts/publish.sh';
	commands.value = initial?.commands ?? '';
	label(
		commandBox,
		preparing
			? 'Shell commands to update lockfiles and check the release'
			: 'Shell commands that publish the selected packages',
		commands,
	);
	hint(
		commandBox,
		'Write shell commands, one per line. GitHub Actions runs them in Bash after checking out the approved commit. Do not paste workflow YAML here.',
	);
	const commandNotice = hint(commandBox, '');
	controls.append(commandBox);
	let commandsEdited = !!initial?.commands;
	const mappingValues = new Map(Object.entries(initial?.publicationSteps ?? {}));
	let mappingControls = new Map<string, HTMLSelectElement>();
	parent.append(box);
	const editor: WorkflowEditor = {
		file: () => file.value === 'same' ? publication?.file() ?? '' : file.value === 'new' ? filename.value : file.value,
		isNew: () => file.value === 'new',
		refresh: () => {},
		read: () => {
			if (preparing && !file.value) return Result.succeed(undefined);
			if (file.value !== 'new' && file.value !== 'same' && !job.value) {
				return Result.fail(new Refused({ message: 'Choose which job to use in this workflow.' }));
			}
			if (commands.required && !commands.value.trim()) {
				return Result.fail(
					new Refused({
						message: preparing
							? 'Enter the shell commands that prepare and check the release.'
							: 'Enter the shell commands that publish these packages.',
					}),
				);
			}
			return Result.succeed({
				file: editor.file(),
				job: selectedJob(),
				triggers: triggers.disabled ? 'review' : triggers.value === 'dispatchOnly' ? 'dispatchOnly' : 'review',
				commands: commands.disabled ? '' : commands.value,
				publicationSteps: Object.fromEntries(
					[...mappingControls].filter(([, control]) => control.value).map(([id, control]) => [id, control.value]),
				),
			});
		},
	};
	function selectedJob(): string {
		if (file.value === 'new') return preparing ? 'prepare' : 'publish';
		if (file.value === 'same') {
			if (initial?.file === editor.file() && initial.job) return initial.job;
			return plan.workflows.find(w => w.file === editor.file())?.roles.find(entry =>
				entry.stream === selection().name && entry.operation === role
			)?.job ?? 'prepare';
		}
		return job.value;
	}
	const visible = (control: HTMLElement & { disabled: boolean }, show: boolean) => {
		if (control.parentElement) control.parentElement.hidden = !show;
		control.disabled = !show;
	};
	function refreshCommands() {
		const evidence = plan.workflows.find(w => w.file === editor.file());
		const integrated = preparing
			? evidence?.preparationJobs.includes(selectedJob())
			: evidence?.reportingJobs.includes(selectedJob());
		const needsCommands = !integrated
			&& (preparing || !mappingControls.size || [...mappingControls.values()].some(control => !control.value));
		commandBox.hidden = !needsCommands;
		commands.disabled = !needsCommands;
		commands.required = needsCommands;
		if (!commandsEdited) commands.value = suggestedCommands(role, selection(), plan);
		commandNotice.textContent = commandsEdited
			? ''
			: commands.value
			? 'Suggested commands for these packages. Review and edit them to match your project.'
			: 'Use the same commands you would run locally to prepare or publish this project.';
	}
	function refreshMappings() {
		for (const [id, control] of mappingControls) mappingValues.set(id, control.value);
		mappingControls = new Map();
		mappings.replaceChildren();
		const evidence = plan.workflows.find(w => w.file === file.value);
		const steps = evidence?.steps.filter(step => step.job === job.value) ?? [];
		if (!preparing && evidence && job.value && !evidence.reportingJobs.includes(job.value) && steps.length) {
			hint(
				mappings,
				'Select the existing publishing step for each package, or add shell commands below. A step is an entry in the selected GitHub Actions job.',
			);
			for (const pkg of selection().packages) {
				const control = select(
					mappings,
					`Publishing step for ${pkg.name}`,
					[
						['', 'Add shell commands below'],
						...steps.map((step): [string, string] => [step.id, step.label]),
					],
					mappingValues.get(pkg.id)
						?? (steps.length === 1 && /publish/i.test(steps[0]?.label ?? '') ? steps[0]?.id ?? '' : ''),
				);
				mappingControls.set(pkg.id, control);
				control.addEventListener('change', refreshCommands);
			}
		}
		refreshCommands();
	}
	function refresh() {
		const reasons = preparationReasons(plan, selection());
		if (preparing && !modeEdited) file.value = reasons.length ? publication?.isNew() ? 'same' : 'new' : '';
		const same = [...file.options].find(option => option.value === 'same');
		if (same) same.disabled = !publication?.isNew() && !(pairedInitially && publication?.file() === initial?.file);
		if (same?.disabled && file.value === 'same') file.value = reasons.length ? 'new' : '';
		const managed = preparing && !file.value, shared = file.value === 'same', creating = file.value === 'new';
		controls.hidden = managed;
		for (const control of controls.querySelectorAll('input,select,textarea')) {
			if (
				control instanceof HTMLInputElement || control instanceof HTMLSelectElement
				|| control instanceof HTMLTextAreaElement
			) control.disabled = managed;
		}
		explanation.textContent = managed
			? reasons.length
				? `${reasons.join(' ')} Choose a preparation job above to handle this.`
				: 'Beepboop edits the version files and opens the PR itself. Only the publishing workflow is needed.'
			: shared
			? 'One workflow file with two jobs. Beepboop runs preparation first, then publishing after the release PR is merged and approved.'
			: preparing
			? 'Use a job that updates lockfiles and checks the proposed versions.'
			: creating
			? 'A publishing job and the Beepboop integration will be generated automatically.'
			: 'Use an existing workflow. Its publishing commands stay in the proposal.';
		explanation.dataset.tone = managed && reasons.length ? 'error' : 'info';
		visible(filename, creating && !managed);
		filename.required = creating && !managed;
		if (!filenameEdited && creating) {
			const selected = selection();
			const group = selected.name === 'main' ? '' : `-${slug(selected.name)}`;
			const base = `${preparing ? 'prepare' : 'release'}-${
				slug(
					selected.packages.length === 1
						? selected.packages[0]?.name ?? selected.name
						: plan.repository.split('/')[1] ?? selected.name,
				)
			}${group}`;
			let proposed = `${base}.yml`, index = 2;
			while (plan.workflows.some(w => w.file === proposed)) proposed = `${base}-${index++}.yml`;
			filename.value = proposed;
		}
		const evidence = plan.workflows.find(w => w.file === file.value);
		const previousJob = job.value;
		job.replaceChildren(option('', 'Choose a job'), ...(evidence?.jobs ?? []).map(value => option(value, value)));
		const roles = evidence?.roles.filter(entry => entry.stream === selection().name && entry.operation === role) ?? [];
		const inferred = initial?.file === file.value && initial.job
			? initial.job
			: roles.length === 1
			? roles[0]?.job
			: evidence?.jobs.length === 1
			? evidence.jobs[0]
			: undefined;
		job.value = evidence?.jobs.includes(previousJob) ? previousJob : inferred ?? '';
		const multiple = (evidence?.jobs.length ?? 0) > 1;
		const override = !managed && !creating && !shared && !!inferred && multiple;
		jobOverride.hidden = !override;
		if (job.parentElement) (override ? jobOverride : jobSlot).append(job.parentElement);
		visible(job, !managed && !creating && !shared && multiple);
		job.required = !job.disabled;
		jobHelp.hidden = managed || creating || shared;
		jobHelp.textContent = job.value
			? `Using the ${job.value} job from ${file.value}.`
			: 'A job is a named group of steps in this workflow. Choose the job that performs this part of the release.';
		const automatic = evidence?.events.some(event => event !== 'workflow_dispatch') ?? false;
		visible(triggers, !managed && !creating && !shared && automatic);
		triggerHelp.hidden = triggers.disabled;
		if (!managed) refreshMappings();
		else {
			commands.required = false;
			filename.required = false;
			job.required = false;
			commandBox.hidden = true;
			mappings.replaceChildren();
			mappingControls.clear();
		}
	}
	editor.refresh = refresh;
	file.addEventListener('change', () => {
		modeEdited = true;
		refresh();
		editor.onChange?.();
	});
	filename.addEventListener('input', () => {
		filenameEdited = true;
		editor.onChange?.();
	});
	commands.addEventListener('input', () => {
		commandsEdited = true;
	});
	job.addEventListener('change', () => {
		jobHelp.textContent = job.value
			? `Using the ${job.value} job from ${file.value}.`
			: 'Choose the job that performs this part of the release.';
		refreshMappings();
	});
	refresh();
	return editor;
}
