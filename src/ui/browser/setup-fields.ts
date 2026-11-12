import { Result } from 'effect';
import type { z } from 'zod';
import type { Selection } from '@/automation/setup-defaults';
import { preparationReasons, suggestedCommands, suggestedWorkflowFile } from '@/automation/setup-defaults';
import type { SetupPlan, SetupWorkflow } from '@/automation/setup-types';
import type { BinaryBuild, BinaryCandidate, BinaryRelease, BinaryTarget } from '@/contract/setup';
import { binaryTargets, defaultBinaryTargets, leftOut, setupWorkflow } from '@/contract/setup';
import type { Editors, WorkflowField } from '@/contract/setup-fields';
import { existingTriggersNames, existingTriggersQuestion, existingTriggersSentences } from '@/contract/setup-terms';
import { node, Refused } from '@/ui/browser/dom';

export const workflowEditors = {
	file: 'control',
	job: 'control',
	triggers: 'control',
	commands: 'control',
	publicationSteps: 'control',
	tagPrefix: 'control',
	binaries: 'control',
	credentials: 'json',
} as const satisfies Editors<WorkflowField>;

export const element = node;
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
export function issueText(error: z.ZodError): string {
	const [issue] = error.issues;
	return issue ? `${issue.path.map(String).join('.') || 'value'}: ${issue.message}` : error.message;
}
export interface JsonEditor {
	read(): Result.Result<unknown, Refused>;
}
export function jsonEditor(parent: HTMLElement, field: string, value: unknown, help: string): JsonEditor {
	const control = element('textarea');
	control.rows = 3;
	control.spellcheck = false;
	control.dataset.field = field;
	control.value = value === undefined ? '' : JSON.stringify(value, null, 2);
	label(parent, `${field} (JSON, optional)`, control);
	hint(parent, help);
	return {
		read: () => {
			if (!control.value.trim()) return Result.succeed(undefined);
			return Result.try({
				try: (): unknown => JSON.parse(control.value),
				catch: () => new Refused({ message: `${field} is not valid JSON.` }),
			});
		},
	};
}
function buildLabel(build: BinaryBuild): string {
	return `${build.name} (${
		build.toolchain === 'cargo'
			? `Cargo, ${build.manifest}`
			: `Go, ${build.package === '.' ? build.module : `${build.module}/${build.package.slice(2)}`}`
	})`;
}
interface BinaryEditor {
	read(): Result.Result<BinaryRelease | undefined, Refused>;
	refresh(): void;
}
function binaryEditor(
	parent: HTMLElement,
	plan: SetupPlan,
	selection: () => Selection,
	initial?: SetupWorkflow,
): BinaryEditor {
	const box = element('fieldset');
	box.dataset.field = 'binaries';
	box.append(element('legend', 'Release binaries'));
	hint(box, 'Beepboop builds each ticked binary for each ticked target and attaches the files to the GitHub release.');
	const list = element('div'), targetList = element('div');
	box.append(list, element('p', 'Targets'), targetList);
	parent.append(box);
	const ticked = new Map<string, boolean>();
	let offered: { build: BinaryBuild; candidate?: BinaryCandidate }[] = [];
	let targetsEdited = !!initial?.binaries;
	const targets = new Map<BinaryTarget, HTMLInputElement>(binaryTargets.map(target => {
		const input = element('input');
		input.type = 'checkbox';
		input.checked = initial?.binaries?.targets.includes(target) ?? false;
		input.addEventListener('change', () => {
			targetsEdited = true;
		});
		label(targetList, target, input);
		return [target, input];
	}));
	const checked = (build: BinaryBuild) =>
		ticked.get(build.name)
			?? (initial ? initial.binaries?.builds.some(entry => entry.name === build.name) ?? false : true);
	return {
		refresh() {
			const packages = new Set(selection().packages.map(pkg => pkg.id));
			const candidates = (plan.binaryCandidates ?? []).filter(candidate => packages.has(candidate.package));
			const existing = initial?.binaries?.builds ?? [];
			offered = [
				...existing.map(build => {
					const candidate = candidates.find(entry => entry.build.name === build.name);
					return candidate ? { build, candidate } : { build };
				}),
				...candidates.filter(candidate => !existing.some(build => build.name === candidate.build.name)).map(
					candidate => ({ build: candidate.build, candidate }),
				),
			];
			list.replaceChildren();
			for (const { build, candidate } of offered) {
				const input = element('input');
				input.type = 'checkbox';
				input.checked = checked(build);
				input.addEventListener('change', () => {
					ticked.set(build.name, input.checked);
				});
				label(list, buildLabel(build), input);
				const note = candidate && leftOut(candidate);
				if (note) hint(list, note);
			}
			if (!targetsEdited) {
				const chosen = offered.filter(entry => checked(entry.build));
				for (const [target, input] of targets) {
					input.checked = defaultBinaryTargets.some(value => value === target)
						&& chosen.every(entry => entry.candidate?.targets.includes(target) ?? true);
				}
			}
			box.hidden = !offered.length;
		},
		read() {
			const builds = offered.filter(entry => checked(entry.build)).map(entry => entry.build);
			if (!builds.length) return Result.succeed(undefined);
			const chosen = [...targets].filter(([, input]) => input.checked).map(([target]) => target);
			return chosen.length
				? Result.succeed({ builds, targets: chosen })
				: Result.fail(new Refused({ message: 'Tick at least one binary target.' }));
		},
	};
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
	box.dataset.field = role;
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
			? [
				['', 'Beepboop opens the version PR (no preparation job)'],
				['same', 'Add a preparation job to the publishing workflow'],
			] as [string, string][]
			: []),
		['new', preparing ? 'Create a separate preparation workflow' : 'Create a release workflow'],
		...plan.workflows.map((w): [string, string] => [w.file, w.file]),
	], pairedInitially ? 'same' : known ? initial.file : initial ? 'new' : preparing ? '' : 'new');
	file.dataset.field = 'file';
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
	job.dataset.field = 'job';
	const jobSlot = element('div');
	if (job.parentElement) jobSlot.append(job.parentElement);
	controls.append(jobSlot);
	const jobHelp = hint(controls, '');
	const jobOverride = element('details');
	jobOverride.append(element('summary', 'Choose a different job (optional)'));
	controls.append(jobOverride);
	const triggers = select(controls, `existingTriggers: ${existingTriggersQuestion}`, [
		['review', `${existingTriggersNames.review}: ${existingTriggersSentences.review}`],
		['dispatchOnly', `${existingTriggersNames.dispatchOnly}: ${existingTriggersSentences.dispatchOnly}`],
	], initial?.triggers === 'dispatchOnly' ? 'dispatchOnly' : 'review');
	triggers.dataset.field = 'triggers';
	const triggerHelp = hint(
		controls,
		'Replacing triggers stops this workflow from running automatically on pushes or tags. Preview shows the exact changes.',
	);
	const mappings = element('div');
	mappings.dataset.field = 'publicationSteps';
	controls.append(mappings);
	const commandBox = element('div');
	const commands = element('textarea');
	commands.rows = 4;
	commands.dataset.field = 'commands';
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
		`Write shell commands, one per line. GitHub Actions runs them in Bash after checking out the release commit.${
			preparing ? '' : ' A lone beepboop publish line publishes Cargo, npm and PyPI packages through Beepboop.'
		} Do not paste workflow YAML here.`,
	);
	const commandNotice = hint(commandBox, '');
	controls.append(commandBox);
	const extras = element('div');
	controls.append(extras);
	const tagPrefix = preparing ? undefined : text(extras, 'Version tag prefix (optional)', initial?.tagPrefix ?? '');
	if (tagPrefix) tagPrefix.dataset.field = 'tagPrefix';
	const credentials = jsonEditor(
		extras,
		'credentials',
		initial?.credentials,
		'Environment variable name to stored credential alias, for the shell commands.',
	);
	const binaries = preparing ? undefined : binaryEditor(extras, plan, selection, initial);
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
			return Result.gen(function*() {
				const chosen = selectedJob();
				const kept = initial?.file === editor.file() ? initial : undefined;
				const secrets = yield* credentials.read();
				const built = binaries ? yield* binaries.read() : undefined;
				const parsed = setupWorkflow.safeParse({
					file: editor.file(),
					job: chosen,
					triggers: triggers.disabled ? 'review' : triggers.value === 'dispatchOnly' ? 'dispatchOnly' : 'review',
					commands: commands.disabled ? kept?.job === chosen ? kept.commands : '' : commands.value,
					publicationSteps: Object.fromEntries(
						[...mappingControls].filter(([, control]) => control.value).map(([id, control]) => [id, control.value]),
					),
					...(secrets === undefined ? {} : { credentials: secrets }),
					...(tagPrefix?.value ? { tagPrefix: tagPrefix.value } : {}),
					...(built ? { binaries: built } : {}),
				});
				return parsed.success
					? parsed.data
					: yield* Result.fail(new Refused({ message: `${role}: ${issueText(parsed.error)}` }));
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
						?? (selection().packages.length === 1 && steps.length === 1 && /publish/i.test(steps[0]?.label ?? '')
							? steps[0]?.id ?? ''
							: ''),
				);
				mappingControls.set(pkg.id, control);
				control.addEventListener('change', () => {
					mappingValues.set(pkg.id, control.value);
					refreshCommands();
				});
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
			? 'One workflow file with two jobs. Beepboop runs preparation first, then publishing when `publishWhen` says the version publishes.'
			: preparing
			? 'Use a job that updates lockfiles and checks the proposed versions.'
			: creating
			? 'A publishing job and the Beepboop integration will be generated automatically.'
			: 'Use an existing workflow. Its publishing commands stay in the proposal.';
		explanation.dataset.tone = managed && reasons.length ? 'error' : 'info';
		visible(filename, creating && !managed);
		filename.required = creating && !managed;
		if (!filenameEdited && creating) filename.value = suggestedWorkflowFile(role, selection(), plan);
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
		binaries?.refresh();
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
