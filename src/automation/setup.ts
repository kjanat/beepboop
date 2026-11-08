import { Effect, Result } from 'effect';
import { mergeConfiguration, parseRepositoryConfiguration } from '@/automation/configuration';
import { formatJson, json } from '@/automation/json';
import { discover, versionsInFiles } from '@/automation/managers';
import { object } from '@/automation/managers/helpers';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId, selectorKey } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { adoptionChoices, adoptionMarkdown } from '@/automation/release-graph/adoption';
import { inferReleaseGraph, type ReleaseGraph } from '@/automation/release-graph/graph';
import { completeTaggedStreams } from '@/automation/setup-completion';
import {
	type SetupChoices,
	type SetupOption,
	type SetupPlan,
	type SetupWorkflow,
	type TriggerHandover,
	triggerHandovers,
	type Versioning,
	versionings,
	type WorkflowEvidence,
} from '@/automation/setup-types';
import { integrateReleaseWorkflow, integrateWorkflow, workflowEvidence } from '@/automation/setup-workflows';
import type { Configuration, Inventory, Package, RepositoryRecord, Snapshot } from '@/automation/types';
import { isLockfile } from '@/contract/catalog';
import { blocking } from '@/contract/diagnostics';
import { type DomainError, decodeRequest, precondition } from '@/contract/errors';
import { sha256Hex } from '@/contract/ids';
import { setupChoicesSchema } from '@/contract/setup';
import { configurationDrift } from '@/domain/configuration';
import { packageMarkdown } from '@/domain/package-label';
import { validateAgainst } from '@/domain/validate';
import { fromPromise, fromSync, toDomainError } from '@/failure';

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
function storedConfiguration(snapshot: Snapshot): Effect.Effect<Record<string, unknown>, DomainError> {
	return fromSync(() => object(JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}')));
}
function evidence(snapshot: Snapshot, inventory: Inventory): Effect.Effect<WorkflowEvidence[], DomainError> {
	return Effect.forEach(
		inventory.workflows,
		w => Effect.fromResult(workflowEvidence(w.file, snapshot.files[`.github/workflows/${w.file}`] ?? '')),
	);
}
export function suggestSetup(
	snapshot: Snapshot,
	inventory: Inventory,
	resolved?: Configuration,
): Effect.Effect<SetupChoices, DomainError> {
	return Effect.gen(function*() {
		const raw = yield* storedConfiguration(snapshot);
		const workflows = yield* evidence(snapshot, inventory);
		return suggested(snapshot, raw, workflows, inventory, inferReleaseGraph(snapshot, inventory), resolved);
	});
}
function suggested(
	snapshot: Snapshot,
	raw: Record<string, unknown>,
	workflows: WorkflowEvidence[],
	inventory: Inventory,
	graph: ReleaseGraph,
	resolved?: Configuration,
): SetupChoices {
	const configured = resolved?.streams ?? object(raw.streams);
	const names = new Set([...Object.keys(configured), ...workflows.flatMap(w => w.roles.map(role => role.stream))]);
	if (!names.size) {
		const adopted = adoptionChoices(graph, inventory);
		if (adopted.length) return { streams: completeTaggedStreams(adopted, snapshot, inventory, graph) };
		names.add('main');
	}
	const streams: SetupChoices['streams'] = [];
	for (const name of names) {
		const current = object(configured[name]);
		const packages = Array.isArray(current.packages)
			? current.packages.map(value => selectorKey(String(value), inventory.packages))
			: [];
		const covered = Array.isArray(current.packages)
			? packages
			: inventory.packages.filter(publishable).map(packageId);
		const observe = Object.entries(object(current.workflows)).flatMap(([binding, value]) => {
			const workflow = object(value);
			if (workflow.mode !== 'observe' || typeof workflow.file !== 'string') return [];
			return [{
				name: binding,
				file: workflow.file,
				...(typeof workflow.ref === 'string' ? { ref: workflow.ref } : {}),
				publications: Array.isArray(workflow.publications)
					? workflow.publications.map(id => selectorKey(String(id), inventory.packages))
					: covered,
			}];
		});
		const source = object(current.versionSource);
		const versionSource: SetupChoices['streams'][number]['versionSource'] =
			source.kind === 'tags' && typeof source.prefix === 'string' ? { kind: 'tags', prefix: source.prefix } : undefined;
		const selected = packages.length || observe.length
			? covered
			: inventory.packages.filter(pkg =>
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
			...(observe.length ? { observe } : {}),
			...(versionSource ? { versionSource } : {}),
			packages: selected,
			versioning: current.versioning === 'independent' || current.versioning === 'none'
				? current.versioning
				: 'workspace',
			required: Array.isArray(current.required) && observe.length
				? current.required.map(value => selectorKey(String(value), inventory.packages))
				: Array.isArray(current.required)
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
export function previewSetup(
	snapshot: Snapshot,
	inventory: Inventory,
	input: unknown,
	baseline: SetupBaseline,
	resolved?: Configuration,
): Effect.Effect<SetupPlan, DomainError> {
	return Effect.gen(function*() {
		const plan = yield* draftSetup(snapshot, inventory, input, baseline, resolved);
		const planId = yield* fromPromise(() =>
			sha256Hex(JSON.stringify({ ...plan, presetShas: baseline.presetShas ?? {} }))
		);
		return { ...plan, planId };
	});
}
function draftSetup(
	snapshot: Snapshot,
	inventory: Inventory,
	input: unknown,
	baseline: SetupBaseline,
	resolved?: Configuration,
): Effect.Effect<Omit<SetupPlan, 'planId'>, DomainError> {
	return Effect.gen(function*() {
		const raw = yield* storedConfiguration(snapshot);
		const workflows = yield* evidence(snapshot, inventory);
		const graph = inferReleaseGraph(snapshot, inventory);
		// Empty selections are allowed in suggestions, but cannot be applied.
		const suggestion = suggested(snapshot, raw, workflows, inventory, graph, resolved);
		const normalized = setupChoicesSchema.safeParse(suggestion);
		const proposal = normalized.success ? normalized.data : suggestion;
		const choices = input === undefined ? proposal : yield* decodeRequest(setupChoicesSchema, input);
		const inferred = input === undefined || JSON.stringify(choices) === JSON.stringify(proposal);
		const plan = yield* drafted(snapshot, inventory, choices, raw, workflows, baseline, resolved);
		return inferred ? { ...plan, adoption: adoptionMarkdown(graph, snapshot) } : plan;
	});
}
function drafted(
	snapshot: Snapshot,
	inventory: Inventory,
	choices: SetupChoices,
	raw: Record<string, unknown>,
	workflows: WorkflowEvidence[],
	baseline: SetupBaseline,
	resolved?: Configuration,
): Effect.Effect<Omit<SetupPlan, 'planId'>, DomainError> {
	return Effect.gen(function*() {
		const configuration = structuredClone(raw);
		const streams = { ...object(configuration.streams) };
		const edits: SetupPlan['edits'] = [], blockers: string[] = [], notes: string[] = [];
		notes.push(...inventory.diagnostics.map(entry => `Discovery: ${entry.message}`));
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
			if (names.has(selection.name)) return yield* precondition('Duplicate selected stream');
			names.add(selection.name);
			const selected = inventory.packages.filter(pkg =>
				selection.packages.includes(packageId(pkg)) && publishable(pkg)
			);
			const observedPublications = selection.observe?.flatMap(entry => entry.publications) ?? [];
			const published = selected.filter(pkg => !observedPublications.some(reference => matchesPackage(reference, pkg)));
			if (selection.promote?.binaries) managers.add('github-release');
			if (!selection.packages.length && !selection.observe?.length && !selection.promote?.binaries) {
				blockers.push(`${selection.name}: select the packages in this release stream.`);
			}
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
			const required = selection.observe?.length
				? selection.required.filter(id => selected.some(pkg => packageId(pkg) === id))
				: selected.filter(requirablePackage).map(packageId).filter(id => !optional.includes(key(id)));
			const updated: Record<string, unknown> = {
				...current,
				packages: selection.packages,
				versioning: selection.versioning,
				required,
				...(selection.versionSource ? { versionSource: selection.versionSource } : {}),
				...(selection.versionFiles ? { versionFiles: selection.versionFiles } : {}),
			};
			if (!selection.versionSource) delete updated.versionSource;
			const granted = (['prepare', 'promote'] as const).flatMap(operation =>
				Object.values(selection[operation]?.credentials ?? {}).map(alias => ({ operation, alias }))
			);
			const credentials = [
				...new Set([
					...(Array.isArray(current.credentials) ? current.credentials.map(String) : []),
					...granted.map(entry => entry.alias),
				]),
			];
			if (credentials.length) updated.credentials = credentials;
			for (const { operation, alias } of granted) {
				notes.push(
					`${
						selection[operation]?.file
					}: grant ${alias} with \`beepboop secrets grant ${snapshot.repository.name} ${alias} --operation ${operation}\`.`,
				);
			}
			const bindings = Object.fromEntries(
				Object.entries(object(current.workflows)).filter(([, value]) => object(value).mode !== 'observe'),
			);
			for (const entry of selection.observe ?? []) {
				const previous = Object.entries(object(object(current.workflows)[entry.name])).filter(([field]) =>
					field !== 'ref'
				);
				bindings[entry.name] = {
					...Object.fromEntries(previous),
					file: entry.file,
					mode: 'observe',
					...(entry.ref ? { ref: entry.ref } : {}),
					publications: entry.publications,
				};
			}
			if (Object.keys(bindings).length) updated.workflows = bindings;
			else delete updated.workflows;
			if (selection.observe?.length) managers.add('workflow');
			streams[selection.name] = updated;
			const shared = selection.prepare && selection.promote && selection.prepare.file === selection.promote.file;
			for (const operation of ['prepare', 'promote'] as const) {
				const workflow = selection[operation];
				const reported = required.filter(id => published.some(pkg => packageId(pkg) === id));
				if (!workflow) {
					if (selection.observe?.length) continue;
					if (
						operation === 'prepare' && !resolved?.streams[selection.name]?.prepare.workflow
						&& !object(object(current.prepare).workflow).file
					) {
						if (selected.length && snapshot.paths.some(isLockfile)) {
							blockers.push(`${selection.name}: select a preparation workflow to regenerate lockfiles.`);
						}
						const versionFiles = selection.versionFiles
							?? (Array.isArray(current.versionFiles)
								? current.versionFiles
								: resolved?.streams[selection.name]?.versionFiles ?? []);
						const strategy = object(current.prepare).strategy ?? resolved?.streams[selection.name]?.prepare.strategy;
						if (strategy === 'workflow') {
							blockers.push(`${selection.name}: select a preparation workflow for the configured workflow strategy.`);
						}
						if (selected.length && !versionsInFiles({ ...inventory, packages: selected }) && !versionFiles.length) {
							blockers.push(
								`${selection.name}: select a preparation workflow; managed preparation needs a version stored in a file.`,
							);
						}
						continue;
					}
					blockers.push(
						`${selection.name}: select a ${operation === 'prepare' ? 'preparation' : 'publication'} workflow.`,
					);
					continue;
				}
				if (selectedFiles.has(workflow.file) && !(shared && operation === 'promote')) {
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
					...(operation === 'promote'
						? {
							publications: workflow.binaries
								? [...reported, `github-release:${snapshot.repository.name}`]
								: reported,
						}
						: {}),
					...(operation === 'promote' && (workflow.binaries || workflow.tagPrefix) && !previousBinding.refs
						? { refs: { phase: 'version', prefix: workflow.tagPrefix ?? selection.versionSource?.prefix ?? 'v' } }
						: {}),
				};
				const inputs = { ...object(inherited.inputs), ...object(previousBinding.inputs) };
				if (shared) inputs.beepboop_operation = operation === 'promote' ? 'publish' : 'prepare';
				else delete inputs.beepboop_operation;
				if (Object.keys(inputs).length) binding.inputs = inputs;
				else delete binding.inputs;
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
				if (shared) continue;
				const generated = yield* Effect.fromResult(integrateWorkflow(
					snapshot,
					selection.name,
					operation,
					workflow,
					operation === 'promote' ? published : selected,
					choices.actionsRevision,
					required,
				));
				blockers.push(...generated.blockers);
				notes.push(...generated.notes);
				const path = `.github/workflows/${workflow.file}`, before = snapshot.files[path] ?? '';
				if (generated.content !== before) edits.push({ path, before, after: generated.content });
			}
			if (shared && selection.prepare && selection.promote) {
				const generated = yield* Effect.fromResult(integrateReleaseWorkflow(
					snapshot,
					selection.name,
					selection.prepare,
					selection.promote,
					selected,
					choices.actionsRevision,
					required,
					published,
				));
				blockers.push(...generated.blockers);
				notes.push(...generated.notes);
				const path = `.github/workflows/${selection.promote.file}`, before = snapshot.files[path] ?? '';
				if (generated.content !== before) edits.push({ path, before, after: generated.content });
			}
		}
		if (!choices.streams.length) blockers.push('Select at least one release stream.');
		configuration.$schema ??= 'https://beepboop.kjanat.dev/schema/v1.json';
		configuration.streams = streams;
		configuration.managers = [...managers].sort();
		const validated = Result.gen(function*() {
			const proposal = resolved ? yield* mergeConfiguration({ ...resolved }, configuration) : configuration;
			const legacy = yield* parseRepositoryConfiguration(proposal);
			const proposed: Snapshot = {
				...snapshot,
				files: { ...snapshot.files, ...Object.fromEntries(edits.map(edit => [edit.path, edit.after])) },
				paths: [...new Set([...snapshot.paths, ...edits.map(edit => edit.path)])],
			};
			const found = yield* Result.try({
				try: () => validateAgainst(legacy, discover(proposed, legacy.managers), proposed),
				catch: toDomainError,
			});
			return {
				drift: configurationDrift(proposal, legacy).map(entry => entry.message),
				found: blocking(found).map(entry => entry.message),
			};
		});
		if (Result.isSuccess(validated)) {
			notes.push(...validated.success.drift);
			blockers.push(...validated.success.found);
		} else {
			blockers.push(validated.failure.message);
		}
		const before = snapshot.files['.github/beepboop.json'] ?? '';
		// Do not reformat an unchanged configuration simply to make a PR.
		const after = JSON.stringify(raw) === JSON.stringify(configuration)
			? before
			: formatJson(yield* Effect.fromResult(json(configuration)));
		if (after !== before) edits.unshift({ path: '.github/beepboop.json', before, after });
		notes.push(
			'Set up registry access and trusted publishing in each registry. The setup PR publishes nothing.',
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
		return {
			repository: snapshot.repository.name,
			sourceSha: snapshot.sha,
			setupHead: baseline.head,
			choices,
			inventory,
			preparation: {
				lockfiles: snapshot.paths.filter(isLockfile),
				versionFileStreams: Object.entries(resolved?.streams ?? object(raw.streams)).filter(([, value]) => {
					const files = object(value).versionFiles;
					return Array.isArray(files) && files.length > 0;
				}).map(([name]) => name),
				workflowStreams: Object.entries(resolved?.streams ?? object(raw.streams)).filter(([, value]) =>
					object(object(value).prepare).strategy === 'workflow'
				).map(([name]) => name),
			},
			packageIds: inventory.packages.map(packageId),
			workflows,
			edits,
			blockers: [...new Set(blockers)],
			notes,
			branchConflict: baseline.branchConflict === true,
			...(prior ? { prior } : {}),
		};
	});
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
				required: stream.observe ? stream.required.filter(id => packages.includes(id)) : packages,
				...(stream.versionSource ? { versionSource: stream.versionSource } : {}),
				...(stream.observe
					? {
						observe: stream.observe.map(entry => ({
							...entry,
							publications: entry.publications.filter(id => packages.includes(id)),
						})),
					}
					: {}),
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
		+ (plan.adoption?.length ? `\n\n${plan.adoption.join('\n').trimEnd()}` : '')
		+ (plan.notes.length ? `\n\n${plan.notes.map(note => `- ${note}`).join('\n')}` : '')
		+ '\n\nBeepboop keeps this proposal current when the default branch changes. Review all file changes before merging. Preparation and publication remain separate explicit operations.\n';
}
