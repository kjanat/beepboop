import { credentialHash } from '@/automation/cli-auth';
import { mergeConfiguration, parseRepositoryConfiguration } from '@/automation/configuration';
import { formatJson, type Json } from '@/automation/json';
import { object } from '@/automation/managers/helpers';
import { packageId, selectorKey } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { type SetupChoices, type SetupPlan, setupChoicesSchema } from '@/automation/setup-types';
import { integrateWorkflow, workflowEvidence } from '@/automation/setup-workflows';
import type { Configuration, Inventory, Snapshot } from '@/automation/types';
import { packageLabel } from '@/ui/package-label';

/** Suggestions are editable policy, never permission to apply or publish. */
export function suggestSetup(snapshot: Snapshot, inventory: Inventory, resolved?: Configuration): SetupChoices {
	const raw = object(JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}'));
	const configured = resolved?.streams ?? object(raw.streams);
	const workflows = inventory.workflows.map(w =>
		workflowEvidence(w.file, snapshot.files[`.github/workflows/${w.file}`] ?? '')
	);
	const names = new Set([...Object.keys(configured), ...workflows.flatMap(w => w.roles.map(role => role.stream))]);
	if (!names.size) names.add('main');
	const streams: SetupChoices['streams'] = [];
	for (const name of names) {
		const current = object(configured[name]);
		const packages = Array.isArray(current.packages)
			? current.packages.map(value => selectorKey(String(value), inventory.packages))
			: [];
		const selected = packages.length ? packages : inventory.packages.filter(pkg =>
			publishable(pkg) && (
				names.size === 1 || pkg.manifest.split('/').slice(0, -1).includes(name)
			)
		).map(packageId);
		const choose = (operation: 'prepare' | 'promote') => {
			const binding = object(object(current[operation]).workflow);
			const matches = workflows.filter(w => w.roles.some(role => role.stream === name && role.operation === operation));
			const evidence = typeof binding.file === 'string'
				? workflows.find(w => w.file === binding.file)
				: matches.length === 1
				? matches[0]
				: undefined;
			if (!evidence) return undefined;
			return {
				file: evidence.file,
				job: evidence.roles.find(role => role.stream === name && role.operation === operation)?.job,
				triggers: 'review' as const,
				commands: '',
				publicationSteps: {},
			};
		};
		streams.push({
			name,
			packages: selected,
			versioning: current.versioning === 'independent' || current.versioning === 'none'
				? current.versioning
				: 'workspace',
			required: Array.isArray(current.required)
				? current.required.map(value => selectorKey(String(value), inventory.packages))
				: selected,
			prepare: choose('prepare'),
			promote: choose('promote'),
		});
	}
	return { streams };
}
export interface SetupBaseline {
	head: string | null;
	workflowPermission?: boolean;
	branchConflict?: boolean;
	prior?: { url: string; content?: string; sourceSha?: string };
	presetShas?: Record<string, string>;
}
export async function previewSetup(
	snapshot: Snapshot,
	inventory: Inventory,
	input: unknown,
	baseline: SetupBaseline,
	resolved?: Configuration,
): Promise<SetupPlan> {
	// Empty selections are allowed in suggestions, but cannot be applied.
	const suggested = input === undefined;
	const choices = suggested ? suggestSetup(snapshot, inventory, resolved) : setupChoicesSchema.parse(input);
	const raw = object(JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}'));
	const configuration = structuredClone(raw);
	const streams = { ...object(configuration.streams) };
	const edits: SetupPlan['edits'] = [], blockers: string[] = [], notes: string[] = [];
	notes.push(...inventory.diagnostics.map(message => `Discovery: ${message}`));
	if (baseline.branchConflict) blockers.push('Setup branch changed; preserve human edits and review the conflict.');
	const names = new Set<string>(), selectedFiles = new Set<string>();
	const managers = new Set<string>(
		Array.isArray(configuration.managers)
			? configuration.managers.map(String)
			: Object.keys(raw).length
			? resolved?.managers ?? []
			: [],
	);
	for (const selection of choices.streams) {
		if (names.has(selection.name)) throw new Error('Duplicate selected stream');
		names.add(selection.name);
		const selected = inventory.packages.filter(pkg => selection.packages.includes(packageId(pkg)) && publishable(pkg));
		if (!selection.packages.length) blockers.push(`${selection.name}: select the packages in this release stream.`);
		if (selection.packages.some(id => !selected.some(pkg => packageId(pkg) === id))) {
			blockers.push(`${selection.name}: selected package is no longer publishable or discovered.`);
		}
		if (new Set(selected.map(packageId)).size !== selected.length) {
			blockers.push(`${selection.name}: duplicate package identities need distinct package configuration.`);
		}
		if (selection.required.some(id => !selection.packages.includes(id))) {
			blockers.push(`${selection.name}: required publications must belong to the selected stream.`);
		}
		for (const pkg of selected) managers.add(pkg.manager);
		const current = object(streams[selection.name]);
		const updated = {
			...current,
			packages: selection.packages,
			versioning: selection.versioning,
			required: selection.required,
		};
		streams[selection.name] = updated;
		for (const operation of ['prepare', 'promote'] as const) {
			const workflow = selection[operation];
			if (!workflow) {
				blockers.push(
					`${selection.name}: select a ${operation === 'prepare' ? 'preparation' : 'publication'} workflow.`,
				);
				continue;
			}
			if (selectedFiles.has(workflow.file)) {
				blockers.push(`${workflow.file}: one workflow cannot be assigned to multiple release roles or streams.`);
			}
			selectedFiles.add(workflow.file);
			managers.add('workflow');
			const parent = object(current[operation]), previousBinding = object(parent.workflow);
			const inherited = object(resolved?.streams[selection.name]?.[operation].workflow);
			const binding: Record<string, unknown> = {
				...previousBinding,
				file: workflow.file,
				ref: previousBinding.ref ?? inherited.ref ?? snapshot.repository.defaultBranch,
				...(operation === 'promote' ? { publications: selection.required } : {}),
			};
			if (binding.mode === 'observe' || inherited.mode === 'observe') binding.mode = 'dispatch';
			if (typeof binding.ref === 'string' && binding.ref.includes('*')) {
				blockers.push(`${selection.name}: ${operation} needs an exact dispatch ref in the existing configuration.`);
			}
			Object.assign(updated, {
				[operation]: {
					...parent,
					...(operation === 'prepare' ? { strategy: 'managed' } : { approval: 'required' }),
					workflow: binding,
				},
			});
			const generated = integrateWorkflow(
				snapshot,
				selection.name,
				operation,
				workflow,
				selected,
				choices.actionsRevision,
				selection.required,
			);
			blockers.push(...generated.blockers);
			notes.push(...generated.notes);
			const path = `.github/workflows/${workflow.file}`, before = snapshot.files[path] ?? '';
			if (generated.content !== before) edits.push({ path, before, after: generated.content });
		}
	}
	if (!choices.streams.length) blockers.push('Select at least one release stream.');
	configuration.$schema ??= 'https://beepboop.kjanat.dev/schema/v1.json';
	configuration.streams = streams;
	configuration.managers = [...managers].sort();
	try {
		parseRepositoryConfiguration(resolved ? mergeConfiguration({ ...resolved }, configuration) : configuration);
	} catch (error) {
		blockers.push(error instanceof Error ? error.message : 'Invalid configuration');
	}
	const before = snapshot.files['.github/beepboop.json'] ?? '';
	// Do not reformat an unchanged configuration simply to make a PR.
	const after = JSON.stringify(raw) === JSON.stringify(configuration) ? before : formatJson(configuration as Json);
	if (after !== before) edits.unshift({ path: '.github/beepboop.json', before, after });
	notes.push(
		'Registry permissions and trusted-publisher linkage are configured separately; this proposal does not publish packages.',
	);
	const prior = baseline.prior
		? { url: baseline.prior.url, superseded: !!before && baseline.prior.content !== before }
		: undefined;
	if (prior?.superseded) {
		notes.push(
			'The earlier setup proposal differs from configuration now on the default branch. Review this replacement against the current source.',
		);
	}
	if (baseline.workflowPermission === false && edits.some(edit => edit.path.startsWith('.github/workflows/'))) {
		blockers.push(
			'The GitHub App installation needs Workflows: write permission before this proposal can edit workflows. Update the app permission and approve the installation update, then preview again.',
		);
	}
	const plan = {
		repository: snapshot.repository.name,
		sourceSha: snapshot.sha,
		setupHead: baseline.head,
		choices,
		inventory,
		packageIds: inventory.packages.map(packageId),
		workflows: inventory.workflows.map(w =>
			workflowEvidence(w.file, snapshot.files[`.github/workflows/${w.file}`] ?? '')
		),
		edits,
		blockers: [...new Set(blockers)],
		notes,
		...(prior ? { prior } : {}),
	};
	const planId = await credentialHash(JSON.stringify({ ...plan, presetShas: baseline.presetShas ?? {} }));
	return { ...plan, planId };
}
export function setupBody(plan: SetupPlan): string {
	return `Configure releases from inspected commit [${plan.sourceSha}](https://github.com/${plan.repository}/commit/${plan.sourceSha}).\n\n`
		+ plan.choices.streams.map(stream =>
			`- **${stream.name}** (${stream.versioning}): ${
				stream.packages.map(id => `\`${packageLabel(id)}\``).join(', ')
			}\n  Prepare: \`${stream.prepare?.file}\`; publish: \`${stream.promote?.file}\`; approval required.`
		).join('\n')
		+ '\n\n' + plan.notes.map(note => `- ${note}`).join('\n')
		+ '\n\nBeepboop keeps this proposal current when the default branch changes. Review all file changes before merging. Preparation and publication remain separate explicit operations.\n';
}
