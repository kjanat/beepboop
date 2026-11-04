import { mergeConfiguration, parseRepositoryConfiguration } from '@/automation/configuration';
import { formatJson, json } from '@/automation/json';
import { object } from '@/automation/managers/helpers';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId, selectorKey } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import {
	type SetupChoices,
	type SetupOption,
	type SetupPlan,
	type SetupWorkflow,
	setupChoicesSchema,
	type TriggerHandover,
	triggerHandovers,
	type Versioning,
	versionings,
} from '@/automation/setup-types';
import { integrateWorkflow, workflowEvidence } from '@/automation/setup-workflows';
import type { Configuration, Inventory, Package, RepositoryRecord, Snapshot } from '@/automation/types';
import { sha256Hex } from '@/contract/ids';
import { packageMarkdown } from '@/domain/package-label';

function releasedPackage(pkg: Package | undefined): boolean {
	return !!pkg && publishable(pkg) && pkg.published !== undefined
		&& !(tagPrefix(pkg.versionSource) !== undefined && pkg.version === undefined);
}
function requirablePackage(pkg: Package | undefined): boolean {
	return !!pkg && publishable(pkg) && !(tagPrefix(pkg.versionSource) !== undefined && pkg.version === undefined);
}
export function publishedOutsideRequired(repository: RepositoryRecord): { stream: string; packages: string[] }[] {
	return Object.entries(repository.configuration?.streams ?? {}).flatMap(([stream, configuration]) => {
		const packages = repository.inventory.packages.filter(pkg =>
			releasedPackage(pkg)
			&& (!configuration.packages || configuration.packages.some(reference => matchesPackage(reference, pkg)))
			&& !configuration.required.some(reference => matchesPackage(reference, pkg))
		).map(packageId);
		return packages.length ? [{ stream, packages }] : [];
	});
}
export function withRegistryStatus(inventory: Inventory, stored: Inventory | undefined): Inventory {
	const checked = new Map(stored?.packages.map(pkg => [packageId(pkg), pkg.publicationStatus]));
	return {
		...inventory,
		packages: inventory.packages.map(pkg => {
			const publicationStatus = checked.get(packageId(pkg));
			return publicationStatus === undefined ? pkg : { ...pkg, publicationStatus };
		}),
	};
}
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
				? [
					...new Set([
						...current.required.map(value => selectorKey(String(value), inventory.packages)),
						...selected.filter(id => requirablePackage(inventory.packages.find(pkg => packageId(pkg) === id))),
					]),
				]
				: selected.filter(id => requirablePackage(inventory.packages.find(pkg => packageId(pkg) === id))),
			prepare: choose('prepare'),
			promote: choose('promote'),
		});
	}
	return { streams };
}
export const branchConflictBlocker =
	'Someone else committed to the setup branch, so Beepboop stopped updating it. Take over to replace their commits with this proposal.';
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
	if (baseline.branchConflict) blockers.push(branchConflictBlocker);
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
		for (const pkg of selected) managers.add(pkg.manager);
		const current = object(streams[selection.name]);
		const key = (value: unknown) => selectorKey(String(value), inventory.packages);
		const configuredRequired = Array.isArray(current.required) ? current.required.map(key) : undefined;
		const optional = configuredRequired && Array.isArray(current.packages)
			? current.packages.map(key).filter(id => !configuredRequired.includes(id))
			: [];
		const required = selected.filter(requirablePackage).map(packageId).filter(id => !optional.includes(key(id)));
		const updated = {
			...current,
			packages: selection.packages,
			versioning: selection.versioning,
			required,
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
				...(operation === 'promote' ? { publications: required } : {}),
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
				required,
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
	const after = JSON.stringify(raw) === JSON.stringify(configuration) ? before : formatJson(json(configuration));
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
		branchConflict: baseline.branchConflict === true,
		...(prior ? { prior } : {}),
	};
	const planId = await sha256Hex(JSON.stringify({ ...plan, presetShas: baseline.presetShas ?? {} }));
	return { ...plan, planId };
}
type Operation = 'prepare' | 'promote';
const operations: Operation[] = ['prepare', 'promote'];
export function setupOptions(plan: SetupPlan): SetupOption[] {
	const candidates = plan.packageIds.filter((_, index) => {
		const pkg = plan.inventory.packages[index];
		return pkg !== undefined && publishable(pkg);
	});
	return plan.choices.streams.flatMap((stream): SetupOption[] => [
		...[...new Set([...candidates, ...stream.packages])].map((id): SetupOption => ({
			kind: 'package',
			stream: stream.name,
			package: id,
		})),
		...operations.flatMap(operation => {
			const current = stream[operation];
			const suggested = plan.workflows.flatMap(evidence => {
				const role = evidence.roles.find(role => role.stream === stream.name && role.operation === operation);
				return role && evidence.file !== current?.file ? [{ file: evidence.file, job: role.job }] : [];
			});
			return [...(current ? [{ file: current.file, job: current.job }] : []), ...suggested].map((
				binding,
			): SetupOption => ({
				kind: 'workflow',
				stream: stream.name,
				operation,
				file: binding.file,
				...(binding.job === undefined ? {} : { job: binding.job }),
			}));
		}),
		...versionings.map((value): SetupOption => ({ kind: 'versioning', stream: stream.name, value })),
		...operations.flatMap(operation =>
			stream[operation]
				? triggerHandovers.map((value): SetupOption => ({ kind: 'triggers', stream: stream.name, operation, value }))
				: []
		),
	]);
}
function optionId(option: SetupOption): string {
	const parts = option.kind === 'workflow'
		? [option.kind, option.stream, option.operation, option.file]
		: option.kind === 'versioning'
		? [option.kind, option.stream, option.value]
		: option.kind === 'triggers'
		? [option.kind, option.stream, option.operation, option.value]
		: [option.kind, option.stream, option.package];
	return parts.map(part => encodeURIComponent(part).replaceAll('-', '%2D')).join(':');
}
function selected(option: SetupOption, choices: SetupChoices): boolean {
	const stream = choices.streams.find(row => row.name === option.stream);
	if (option.kind === 'workflow') return stream?.[option.operation]?.file === option.file;
	if (option.kind === 'versioning') return stream?.versioning === option.value;
	if (option.kind === 'triggers') return stream?.[option.operation]?.triggers === option.value;
	return (option.kind === 'package' ? stream?.packages : stream?.required)?.includes(option.package) ?? false;
}
export function bodyChoices(body: string, options: SetupOption[], base: SetupChoices): SetupChoices {
	const known = new Set(options.map(optionId));
	const ticked = new Map<string, boolean>();
	for (const [, mark, id] of body.matchAll(/^[ \t]*[-*+] \[([ xX])\] <!-- beepboop:choice:([^\s>]+) -->/gm)) {
		if (id && known.has(id) && !ticked.has(id)) ticked.set(id, mark !== ' ');
	}
	const state = (option: SetupOption) => ticked.get(optionId(option)) ?? selected(option, base);
	return {
		streams: base.streams.map(stream => {
			const own = options.filter(option => option.stream === stream.name);
			const pick = (kind: 'package' | 'required', current: string[]) => {
				const offered = own.flatMap(option =>
					option.kind === kind && (option.kind === 'package' || option.kind === 'required') ? [option.package] : []
				);
				return [...new Set([...current, ...offered])].filter(id => state({ kind, stream: stream.name, package: id }));
			};
			const packages = pick('package', stream.packages);
			const binding = (operation: Operation): SetupWorkflow | undefined => {
				const current = stream[operation];
				const candidates = own.flatMap(option =>
					option.kind === 'workflow' && option.operation === operation ? [option] : []
				);
				if (current && !candidates.some(option => option.file === current.file)) return current;
				const chosen = candidates.filter(state);
				const next = chosen.find(option => option.file !== current?.file) ?? chosen[0];
				if (!next) return undefined;
				if (next.file === current?.file) return current;
				return {
					file: next.file,
					...(next.job === undefined ? {} : { job: next.job }),
					triggers: 'review',
					commands: '',
					publicationSteps: {},
				};
			};
			const handover = (operation: Operation, chosen: SetupWorkflow | undefined): SetupWorkflow | undefined => {
				if (!chosen) return undefined;
				const ticked = own.flatMap(option =>
					option.kind === 'triggers' && option.operation === operation && state(option) ? [option.value] : []
				);
				const value = ticked.find(value => value !== chosen.triggers) ?? ticked[0] ?? chosen.triggers;
				return value === chosen.triggers ? chosen : { ...chosen, triggers: value };
			};
			const prepare = handover('prepare', binding('prepare')), promote = handover('promote', binding('promote'));
			const versions = own.flatMap(option => option.kind === 'versioning' && state(option) ? [option.value] : []);
			return {
				name: stream.name,
				packages,
				versioning: versions.find(value => value !== stream.versioning) ?? versions[0] ?? stream.versioning,
				required: packages,
				...(prepare ? { prepare } : {}),
				...(promote ? { promote } : {}),
			};
		}),
		...(base.actionsRevision ? { actionsRevision: base.actionsRevision } : {}),
	};
}
const versioningLabels: Record<Versioning, string> = {
	workspace: 'One version for the stream',
	independent: 'Independent package versions',
	none: 'No version',
};
const triggerLabels: Record<TriggerHandover, string> = {
	review: 'Keep existing triggers and report conflicts',
	dispatchOnly: 'Replace existing triggers with Beepboop dispatch',
	preserve: 'Preserve existing triggers; block incompatible integration',
};
export function setupBody(plan: SetupPlan): string {
	const options = setupOptions(plan);
	const box = (indent: string, option: SetupOption, label: string) =>
		`${indent}- [${selected(option, plan.choices) ? 'x' : ' '}] <!-- beepboop:choice:${optionId(option)} --> ${label}`;
	const workflow = (binding: SetupWorkflow | undefined) =>
		binding
			? `\`${binding.file}\`${binding.job ? ` (job \`${binding.job}\`)` : ''}, ${triggerLabels[binding.triggers]}`
			: 'none';
	return `Configure releases from inspected commit [${plan.sourceSha}](https://github.com/${plan.repository}/commit/${plan.sourceSha}).\n\n`
		+ 'Tick or untick packages to change this proposal. Every ticked package must be published for a release to succeed. Beepboop rebuilds the proposal 5 seconds after the last edit.\n\n'
		+ plan.choices.streams.map(stream => {
			const packages = options.flatMap(option =>
				option.kind === 'package' && option.stream === stream.name
					? [box('    ', option, packageMarkdown(option.package))]
					: []
			);
			return [
				`- **${stream.name}**; approval required.`,
				...(packages.length ? ['  - Packages', ...packages] : []),
				`  - Versioning: ${versioningLabels[stream.versioning]}`,
				`  - Preparation: ${workflow(stream.prepare)}`,
				`  - Publication: ${workflow(stream.promote)}`,
			].join('\n');
		}).join('\n')
		+ '\n\nChange versioning, workflows and triggers in Beepboop under Repositories, Edit release setup.'
		+ (plan.notes.length ? `\n\n${plan.notes.map(note => `- ${note}`).join('\n')}` : '')
		+ '\n\nBeepboop keeps this proposal current when the default branch changes. Review all file changes before merging. Preparation and publication remain separate explicit operations.\n';
}
