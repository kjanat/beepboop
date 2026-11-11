import { Effect, Result } from 'effect';
import { z } from 'zod';
import { binaryCandidates } from '@/automation/binary-candidates';
import { companionProposals } from '@/automation/companion-detection';
import { mergeConfiguration, parseRepositoryConfiguration } from '@/automation/configuration';
import { legacyConfiguration, readableConfiguration } from '@/automation/configuration-names';
import { formatJson, json } from '@/automation/json';
import { discover, versionsInFiles } from '@/automation/managers';
import { object } from '@/automation/managers/helpers';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId, selectorKey } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { adoptionChoices, startCommand } from '@/automation/release-graph/adoption';
import type { ReleaseGraph } from '@/automation/release-graph/graph';
import { inferReleaseGraph } from '@/automation/release-graph/graph';
import { behaviourChanges, changeDetails, onboardingBranch } from '@/automation/setup-changes';
import { completeTaggedStreams } from '@/automation/setup-completion';
import { crateScript, refreshedCommands, suggestedCommands } from '@/automation/setup-defaults';
import { startWorkflow } from '@/automation/setup-start';
import { listed, streamSummary } from '@/automation/setup-summary';
import type {
	SetupChoices,
	SetupOption,
	SetupPlan,
	SetupWorkflow,
	TriggerHandover,
	WorkflowEvidence,
} from '@/automation/setup-types';
import { approvals, triggerHandovers, versionings } from '@/automation/setup-types';
import { integrateReleaseWorkflow, integrateWorkflow, workflowEvidence } from '@/automation/setup-workflows';
import type { Configuration, Inventory, Package, RepositoryRecord, Snapshot } from '@/automation/types';
import { isLockfile } from '@/contract/catalog';
import { blocking } from '@/contract/diagnostics';
import type { DomainError } from '@/contract/errors';
import { decodeRequest, precondition } from '@/contract/errors';
import { sha256Hex } from '@/contract/ids';
import { releaseStarts, startChannels, startWorkflowFile, versionBump, versionBumps } from '@/contract/release-start';
import type { BinaryBuild, BinaryCandidate, BinaryRelease, BinaryTarget, WorkflowSetupInput } from '@/contract/setup';
import {
	binaryTargets,
	bumpable,
	leftOut,
	setupChoicesSchema,
	startable,
	unbuildable,
	workflowSetup,
} from '@/contract/setup';
import {
	existingTriggersNames,
	existingTriggersQuestion,
	existingTriggersSentences,
	publishWhenNames,
	publishWhenQuestion,
	publishWhenSentences,
	startFromQuestion,
	startFromSentences,
	versionLandsNames,
	versionLandsQuestion,
	versionLandsSentences,
	versionPrMerge,
	versionPrMergeQuestion,
	versionPrMergeSentences,
	versionPrMerges,
	versionScopeNames,
	versionScopeSentences,
} from '@/contract/setup-terms';
import { versionFileSchema } from '@/contract/version-files';
import { configurationDrift } from '@/domain/configuration';
import { packageMarkdown } from '@/domain/package-label';
import { publicationStages } from '@/domain/publication-stages';
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
	return fromSync(() => object(legacyConfiguration(JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}'))));
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
	saved?: SetupChoices,
	candidates: readonly BinaryCandidate[] = [],
): SetupChoices {
	const configured = resolved?.streams ?? object(raw.streams);
	const revision = resolved?.actionsRevision
		?? (typeof raw.actionsRevision === 'string' ? raw.actionsRevision : undefined)
		?? saved?.actionsRevision;
	const names = new Set([...Object.keys(configured), ...workflows.flatMap(w => w.roles.map(role => role.stream))]);
	if (!names.size) {
		const adopted = adoptionChoices(graph, inventory, snapshot.repository.name);
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
			const needs = Array.isArray(workflow.needs) ? workflow.needs.map(String) : [];
			return [{
				name: binding,
				file: workflow.file,
				...(typeof workflow.ref === 'string' ? { ref: workflow.ref } : {}),
				publications: Array.isArray(workflow.publications)
					? workflow.publications.map(id => selectorKey(String(id), inventory.packages))
					: covered,
				...(needs.length ? { needs } : {}),
			}];
		});
		const source = object(current.versionSource);
		const versionSource: SetupChoices['streams'][number]['versionSource'] =
			source.kind === 'tags' && typeof source.prefix === 'string' ? { kind: 'tags', prefix: source.prefix } : undefined;
		const selected = Array.isArray(current.packages) || observe.length
			? covered
			: inventory.packages.filter(pkg =>
				publishable(pkg) && (
					names.size === 1 || pkg.manifest.split('/').slice(0, -1).includes(name)
				)
			).map(packageId);
		const previous = saved?.streams.find(stream => stream.name === name);
		const generator = (binding: Record<string, unknown>, before: SetupWorkflow | undefined) => {
			const stored = workflowSetup.safeParse(binding.setup);
			if (stored.success) return stored.data;
			if (!before || before.file !== binding.file) return undefined;
			const { file: _file, ...input } = before;
			return input;
		};
		const choose = (operation: 'prepare' | 'promote'): SetupWorkflow | undefined => {
			const binding = object(object(current[operation]).workflow);
			const input = typeof binding.file === 'string' ? generator(binding, previous?.[operation]) : undefined;
			if (typeof binding.file === 'string' && input) {
				const role = workflows.find(w => w.file === binding.file)?.roles.find(entry =>
					entry.stream === name && entry.operation === operation
				);
				const job = input.job ?? role?.job;
				return { ...input, file: binding.file, ...(job === undefined ? {} : { job }) };
			}
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
		const operations = Object.entries(object(current.workflows)).flatMap(([operation, value]) => {
			const binding = object(value);
			if (binding.mode === 'observe' || typeof binding.file !== 'string') return [];
			const before = previous?.operations?.find(entry => entry.name === operation);
			const input = generator(binding, before);
			const needs = Array.isArray(binding.needs) ? binding.needs.map(String) : [];
			const [first, ...rest] = needs;
			if (!input || first === undefined) return [];
			const needsJobs = object(binding.needsJobs);
			return [{
				...input,
				name: operation,
				file: binding.file,
				needs: [first, ...rest],
				...(Object.keys(needsJobs).length
					? {
						needsJobs: Object.fromEntries(
							Object.entries(needsJobs).map(([key, jobs]) => [key, Array.isArray(jobs) ? jobs.map(String) : []]),
						),
					}
					: {}),
				publications: Array.isArray(binding.publications)
					? binding.publications.map(id => selectorKey(String(id), inventory.packages))
					: [],
			}];
		});
		const needs = object(current.needs);
		const versionFiles = z.array(versionFileSchema).safeParse(current.versionFiles);
		const companionModules = Array.isArray(current.companionModules)
			? current.companionModules.map(value => selectorKey(String(value), inventory.packages))
			: [];
		streams.push({
			name,
			...(observe.length ? { observe } : {}),
			...(versionSource ? { versionSource } : {}),
			...(companionModules.length ? { companionModules } : {}),
			...(versionFiles.success && versionFiles.data.length ? { versionFiles: versionFiles.data } : {}),
			...(Object.keys(needs).length
				? {
					needs: Object.fromEntries(
						Object.entries(needs).map(([key, values]) => [key, Array.isArray(values) ? values.map(String) : []]),
					),
				}
				: {}),
			...(operations.length ? { operations } : {}),
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
			promote: proposeBinaries(
				choose('promote'),
				workflowSetup.safeParse(object(object(current.promote).workflow).setup).success
					|| observe.some(entry =>
						entry.publications.includes(selectorKey(`pkg:github/${snapshot.repository.name}`, inventory.packages))
					),
				candidates.filter(candidate => selected.includes(candidate.package)),
			),
		});
	}
	return { streams, ...(revision ? { actionsRevision: revision } : {}) };
}
function proposeBinaries(
	promote: SetupWorkflow | undefined,
	held: boolean,
	candidates: readonly BinaryCandidate[],
): SetupWorkflow | undefined {
	if (!promote || held || promote.binaries || !candidates.length) return promote;
	return { ...promote, binaries: binaryRelease(candidates) };
}
export function binaryRelease(candidates: readonly BinaryCandidate[]): BinaryRelease {
	return {
		builds: candidates.map(candidate => candidate.build),
		targets: binaryTargets.filter(target => candidates.every(candidate => candidate.targets.includes(target))),
	};
}
export const branchConflictBlocker =
	'Someone else committed to the setup branch, so Beepboop stopped updating it. Take over to replace their commits with this proposal.';
export interface SetupBaseline {
	head: string | null;
	workflowPermission?: boolean;
	branchConflict?: boolean;
	prior?: { url: string; content?: string; sourceSha?: string };
	presetShas?: Record<string, string>;
	saved?: SetupChoices;
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
		const candidates = binaryCandidates(snapshot, inventory);
		const suggestion = suggested(snapshot, raw, workflows, inventory, graph, resolved, baseline.saved, candidates);
		const normalized = setupChoicesSchema.safeParse(suggestion);
		const requested = normalized.success ? normalized.data : suggestion;
		const proposal = completeChoices(
			snapshot,
			inventory,
			{ ...requested, streams: withDependencies(inventory, requested) },
			raw,
		);
		const chosen = input === undefined ? undefined : yield* decodeRequest(setupChoicesSchema, input);
		const choices = chosen ? completeChoices(snapshot, inventory, chosen, raw) : proposal;
		const inferred = input === undefined || JSON.stringify(choices) === JSON.stringify(proposal);
		const drafts = yield* drafted(snapshot, inventory, choices, raw, workflows, baseline, resolved);
		const unlisted = (streams: SetupChoices['streams'], from: SetupChoices) =>
			streams.flatMap(stream => {
				const before = from.streams.find(entry => entry.name === stream.name)?.packages ?? stream.packages;
				return stream.packages.filter(id => !before.includes(id)).map(id => ({ stream: stream.name, id }));
			});
		const added = chosen
			? unlisted(withDependencies(inventory, choices), choices).map(({ stream, id }) =>
				`${stream}: a selected package depends on ${
					packageMarkdown(id)
				}, and its registry does not have this version. Publish it first.`
			)
			: unlisted(choices.streams, requested).map(({ stream, id }) =>
				`${stream}: adds ${
					packageMarkdown(id)
				}, which a selected package depends on and its registry does not have at this version.`
			);
		const narrowed: string[] = [], failing: string[] = [];
		for (const stream of choices.streams) {
			const release = stream.promote?.binaries;
			for (const build of release?.builds ?? []) {
				const candidate = candidates.find(entry => entry.build.name === build.name);
				if (!candidate || !release) continue;
				const ticked = unbuildable(candidate, release.targets);
				const note = leftOut(candidate);
				if (ticked.length) {
					failing.push(
						`${stream.name}: ${build.name} is expected to fail on ${ticked.join(', ')}: ${
							candidate.reason ?? 'its dependencies do not support these targets'
						}.`,
					);
				} else if (note) narrowed.push(note);
			}
		}
		const unanswered = choices.streams.flatMap(stream => [
			...(stream.promote && !stream.approval
				? [
					`${stream.name}: tick \`publishWhen\`. Until you do, it is \`${publishWhenNames.required}\`: ${publishWhenSentences.required}`,
				]
				: []),
			...(bumpable(stream) && !stream.bump
				? [
					`${stream.name}: tick \`versionLands\`. Until you do, it is \`${versionLandsNames.pr}\`: ${versionLandsSentences.pr}`,
				]
				: []),
		]);
		const ineligible = choices.streams.flatMap(stream =>
			!startable(stream) && stream.start?.length
				? [
					`${stream.name}: only a release group with \`versionScope: ${versionScopeNames.workspace}\` and a publishing workflow can use \`startFrom\`.`,
				]
				: []
		);
		const plan = {
			...drafts,
			blockers: [...ineligible, ...drafts.blockers],
			notes: [
				...unanswered,
				...added,
				...failing,
				...narrowed,
				...companionProposals(choices, snapshot, inventory),
				...drafts.notes,
			],
			...(candidates.length ? { binaryCandidates: candidates } : {}),
		};
		return inferred ? { ...plan, adoption: proposalMarkdown(graph, snapshot, plan, resolved) } : plan;
	});
}
function proposalMarkdown(
	graph: ReleaseGraph,
	snapshot: Snapshot,
	plan: Omit<SetupPlan, 'planId'>,
	resolved?: Configuration,
): string[] {
	const lines = ['## Release plan', ''];
	for (const stream of plan.choices.streams) {
		lines.push(`### Stream \`${stream.name}\``, '', ...streamSummary(stream, plan).map(line => `- ${line}`));
		const proposal = graph.streams.find(entry => entry.id === stream.name);
		if (stream.promote) {
			const inherited = resolved?.streams[stream.name];
			const policy = stream.approval ?? inherited?.promote.approval ?? 'required';
			const bump = stream.bump ?? inherited?.prepare.bump ?? 'pr';
			const landing = bump === 'commit'
				? 'Beepboop pushes a signed commit with the new version to the default branch.'
				: 'Beepboop opens the version PR.';
			const after = bump === 'commit' ? 'Then' : 'After you merge it,';
			lines.push(
				`- Start a release with \`beepboop release\` in a checkout or from the dashboard. ${landing} ${after} \`publishWhen: ${
					publishWhenNames[policy]
				}\` applies${stream.approval ? '' : ' until you tick another'}: ${publishWhenSentences[policy]}`,
			);
		} else if (proposal) lines.push(`- ${startCommand(proposal, snapshot)}`);
		lines.push('');
	}
	const proposed = new Set(
		plan.choices.streams.flatMap(stream => stream.packages).flatMap(id => {
			const index = plan.packageIds.indexOf(id);
			const pkg = index < 0 ? undefined : plan.inventory.packages[index];
			return pkg ? [`\`${pkg.name}\``] : [];
		}),
	);
	const omissions = graph.omissions.filter(omission => !proposed.has(omission.subject));
	if (omissions.length) {
		lines.push('### Left out', '', ...omissions.map(omission => `- ${omission.subject}: ${omission.reason}.`), '');
	}
	if (graph.notes.length) lines.push('### Notes', '', ...graph.notes.map(note => `- ${note}`), '');
	if (graph.unresolved.length) lines.push('### Decisions needed', '', ...graph.unresolved.map(item => `- ${item}`), '');
	return lines;
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
		const ticked = new Set(choices.streams.flatMap(stream => stream.packages));
		for (const entry of inventory.diagnostics) {
			if (entry.code !== 'package-metadata') notes.push(`Discovery: ${entry.message}`);
			else if (entry.subject?.kind === 'package' && ticked.has(entry.subject.key)) {
				notes.push(`${entry.message}. ${heldNote}`);
			}
		}
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
				...(selection.needs ? { needs: selection.needs } : {}),
				...(selection.companionModules?.length ? { companionModules: selection.companionModules } : {}),
			};
			if (!selection.companionModules?.length) delete updated.companionModules;
			if (!selection.versionSource) delete updated.versionSource;
			if (!selection.needs) delete updated.needs;
			const granted = [
				...(['prepare', 'promote'] as const).flatMap(operation =>
					Object.values(selection[operation]?.credentials ?? {}).map(alias => ({
						operation,
						file: selection[operation]?.file,
						alias,
					}))
				),
				...(selection.operations ?? []).flatMap(entry =>
					Object.values(entry.credentials ?? {}).map(alias => ({ operation: entry.name, file: entry.file, alias }))
				),
			];
			const credentials = [
				...new Set([
					...(Array.isArray(current.credentials) ? current.credentials.map(String) : []),
					...granted.map(entry => entry.alias),
				]),
			];
			if (credentials.length) updated.credentials = credentials;
			for (const { operation, file, alias } of granted) {
				notes.push(
					`${file}: when the repository owner merges this PR, Beepboop grants it the stored ${alias} secret for the ${operation} operation.`,
				);
			}
			const bindings = Object.fromEntries(
				Object.entries(object(current.workflows)).filter(([, value]) => object(value).mode !== 'observe'),
			);
			for (const entry of selection.observe ?? []) {
				const observed: Record<string, unknown> = {
					...object(object(current.workflows)[entry.name]),
					file: entry.file,
					mode: 'observe',
					...(entry.ref ? { ref: entry.ref } : {}),
					publications: entry.publications,
					...(entry.needs?.length ? { needs: entry.needs } : {}),
				};
				if (!entry.ref) delete observed.ref;
				if (!entry.needs?.length) delete observed.needs;
				bindings[entry.name] = observed;
			}
			for (const entry of selection.operations ?? []) {
				const previous = object(object(current.workflows)[entry.name]);
				const { name: _name, needs: _needs, needsJobs: _jobs, publications: _publications, ...generator } = entry;
				const operation: Record<string, unknown> = {
					...previous,
					file: entry.file,
					ref: typeof previous.ref === 'string' ? previous.ref : snapshot.repository.defaultBranch,
					publications: entry.publications,
					needs: entry.needs,
					...(entry.needsJobs ? { needsJobs: entry.needsJobs } : {}),
					setup: workflowInput(generator),
				};
				if (!entry.needsJobs) delete operation.needsJobs;
				bindings[entry.name] = operation;
			}
			if (Object.keys(bindings).length) updated.workflows = bindings;
			else delete updated.workflows;
			if (selection.observe?.length) managers.add('workflow');
			streams[selection.name] = updated;
			const delegated = new Set(selection.operations?.flatMap(entry => entry.publications) ?? []);
			const promoted = published.filter(pkg => !delegated.has(packageId(pkg)));
			const shared = selection.prepare && selection.promote && selection.prepare.file === selection.promote.file;
			for (const operation of ['prepare', 'promote'] as const) {
				const workflow = selection[operation];
				const reported = required.filter(id => promoted.some(pkg => packageId(pkg) === id));
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
				const releasing = operation === 'promote' && releases(snapshot, selection, workflow, previousBinding);
				if (releasing) managers.add('github-release');
				const inherited = object(resolved?.streams[selection.name]?.[operation].workflow);
				const binding: Record<string, unknown> = {
					...previousBinding,
					setup: workflowInput(workflow),
					file: workflow.file,
					ref: previousBinding.ref ?? inherited.ref ?? snapshot.repository.defaultBranch,
					...(operation === 'promote'
						? {
							publications: workflow.binaries || releasing
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
						...(operation === 'prepare'
							? { strategy: 'managed' }
							: selection.approval
							? { approval: selection.approval }
							: {}),
						workflow: binding,
					},
				});
				if (shared) continue;
				const generated = yield* Effect.fromResult(integrateWorkflow(
					snapshot,
					selection.name,
					operation,
					workflow,
					operation === 'promote' ? promoted : selected,
					choices.actionsRevision,
					required,
					releasing,
				));
				blockers.push(...generated.blockers);
				notes.push(...generated.notes);
				const path = `.github/workflows/${workflow.file}`, before = snapshot.files[path] ?? '';
				if (generated.content !== before) edits.push({ path, before, after: generated.content });
			}
			if (selection.bump) updated.prepare = { ...object(updated.prepare), bump: selection.bump };
			if (selection.versionPrMerge) {
				updated.prepare = { ...object(updated.prepare), versionPrMerge: selection.versionPrMerge };
			}
			if (selection.start) {
				updated.start = selection.start.map(via => via === 'action' ? { via, workflow: startWorkflowFile } : { via });
			}
			for (const entry of selection.operations ?? []) {
				const { name: operation, needs: _needs, needsJobs: _jobs, publications, ...workflow } = entry;
				if (selectedFiles.has(workflow.file)) {
					blockers.push(`${workflow.file}: one workflow cannot be assigned to multiple release roles or streams.`);
				}
				selectedFiles.add(workflow.file);
				const generated = yield* Effect.fromResult(integrateWorkflow(
					snapshot,
					selection.name,
					operation,
					workflow,
					published.filter(pkg => publications.includes(packageId(pkg))),
					choices.actionsRevision,
					required.filter(id => publications.includes(id)),
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
					releases(snapshot, selection, selection.promote, object(object(current.promote).workflow)),
				));
				blockers.push(...generated.blockers);
				notes.push(...generated.notes);
				const path = `.github/workflows/${selection.promote.file}`, before = snapshot.files[path] ?? '';
				if (generated.content !== before) edits.push({ path, before, after: generated.content });
			}
		}
		const dispatched = choices.streams.flatMap(stream => stream.start?.includes('action') ? [stream.name] : []);
		if (dispatched.length) {
			if (selectedFiles.has(startWorkflowFile)) {
				blockers.push(`${startWorkflowFile}: one workflow cannot start releases and run a release role.`);
			}
			const path = `.github/workflows/${startWorkflowFile}`, before = snapshot.files[path] ?? '';
			const after = startWorkflow(dispatched, choices.actionsRevision);
			if (after !== before) edits.push({ path, before, after });
		}
		if (!choices.streams.length) blockers.push('Select at least one release stream.');
		if (choices.actionsRevision) configuration.actionsRevision = choices.actionsRevision;
		else delete configuration.actionsRevision;
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
		const written = readableConfiguration(configuration);
		const stored = yield* fromSync((): unknown => JSON.parse(before || '{}'));
		// Do not reformat an unchanged configuration simply to make a PR.
		const after = JSON.stringify(stored) === JSON.stringify(written)
			? before
			: formatJson(yield* Effect.fromResult(json(written)));
		if (after !== before) edits.unshift({ path: '.github/beepboop.json', before, after });
		const prior = baseline.prior
			? { url: baseline.prior.url, superseded: !!before && baseline.prior.content !== before }
			: undefined;
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
/** The repository configuration keeps each generated workflow's setup input next to its binding. */
export function workflowInput(workflow: SetupWorkflow): WorkflowSetupInput {
	const { file: _file, triggers, commands, publicationSteps, job, credentials, tagPrefix, binaries } = workflow;
	return {
		...(job === undefined ? {} : { job }),
		...(triggers === 'review' ? {} : { triggers }),
		...(commands ? { commands } : {}),
		...(Object.keys(publicationSteps).length ? { publicationSteps } : {}),
		...(credentials === undefined ? {} : { credentials }),
		...(tagPrefix === undefined ? {} : { tagPrefix }),
		...(binaries === undefined ? {} : { binaries }),
	};
}
function releases(
	snapshot: Snapshot,
	stream: SetupChoices['streams'][number],
	workflow: SetupWorkflow | undefined,
	previous: Record<string, unknown>,
): boolean {
	if (!workflow || workflow.binaries || stream.observe?.length || stream.versionSource) return false;
	const release = `github-release:${snapshot.repository.name}`;
	return Array.isArray(previous.publications) && previous.publications.includes(release)
		|| !!workflow.tagPrefix && snapshot.files[`.github/workflows/${workflow.file}`] === undefined;
}
function completeChoices(
	snapshot: Snapshot,
	inventory: Inventory,
	choices: SetupChoices,
	raw: Record<string, unknown>,
): SetupChoices {
	const context = {
		inventory,
		preparation: { lockfiles: snapshot.paths.filter(isLockfile), versionFileStreams: [], workflowStreams: [] },
	};
	const candidates = inventory.packages.filter(publishable).map(pkg => ({
		id: packageId(pkg),
		name: pkg.name,
		manifest: pkg.manifest,
		manager: pkg.manager,
		...(pkg.versionSource ? { versionSource: pkg.versionSource } : {}),
	}));
	const completed = {
		...choices,
		streams: choices.streams.map(stream => {
			const chosen = candidates.filter(pkg => stream.packages.includes(pkg.id));
			const elsewhere = new Set([
				...(stream.operations?.flatMap(entry => entry.publications) ?? []),
				...(stream.observe?.flatMap(entry => entry.publications) ?? []),
			]);
			const complete = (operation: Operation, workflow: SetupWorkflow | undefined): SetupWorkflow | undefined => {
				if (!workflow) return undefined;
				const scope = {
					name: stream.name,
					packages: operation === 'prepare'
						? chosen
						: chosen.filter(pkg => !elsewhere.has(pkg.id) && !workflow.publicationSteps[pkg.id]),
				};
				const commands = refreshedCommands(operation, workflow.commands, scope, candidates, context);
				const generated = commands !== ''
					&& (commands === suggestedCommands(operation, scope, context) || crateScript(commands));
				const fresh = snapshot.files[`.github/workflows/${workflow.file}`] === undefined;
				return {
					...workflow,
					commands,
					...(operation === 'promote' && generated && !workflow.credentials
							&& scope.packages.some(pkg => pkg.manager === 'cargo')
						? { credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' } }
						: {}),
					...(operation === 'promote' && fresh && !workflow.tagPrefix && !workflow.binaries && !stream.observe?.length
						? { tagPrefix: stream.versionSource?.prefix ?? (stream.name === 'main' ? 'v' : `${stream.name}-v`) }
						: {}),
				};
			};
			const operations = stream.operations?.map(entry => {
				const scope = { name: stream.name, packages: chosen.filter(pkg => entry.publications.includes(pkg.id)) };
				const commands = refreshedCommands('promote', entry.commands, scope, candidates, context);
				const generated = commands !== ''
					&& (commands === suggestedCommands('promote', scope, context) || crateScript(commands));
				return {
					...entry,
					commands,
					...(generated && !entry.credentials && scope.packages.some(pkg => pkg.manager === 'cargo')
						? { credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' } }
						: {}),
				};
			});
			const stored = object(object(raw.streams)[stream.name]);
			const configured = object(stored.promote).approval;
			const approval = stream.approval
				?? (configured === 'required' || configured === 'merge' || configured === 'push' ? configured : undefined);
			const starts = releaseStarts.safeParse(stored.start);
			const start = stream.start ?? (starts.success ? starts.data.map(entry => entry.via) : undefined);
			const bumped = versionBump.safeParse(object(stored.prepare).bump);
			const bump = stream.bump ?? (bumped.success ? bumped.data : undefined);
			const merged = versionPrMerge.safeParse(object(stored.prepare).versionPrMerge);
			const merge = stream.versionPrMerge ?? (merged.success ? merged.data : undefined);
			const prepare = complete('prepare', stream.prepare), promote = complete('promote', stream.promote);
			return {
				...stream,
				...(promote && approval ? { approval } : {}),
				...(start ? { start } : {}),
				...(bump ? { bump } : {}),
				...(merge ? { versionPrMerge: merge } : {}),
				...(prepare ? { prepare } : {}),
				...(promote ? { promote } : {}),
				...(operations ? { operations } : {}),
			};
		}),
	};
	const canonical = setupChoicesSchema.safeParse(completed);
	return canonical.success ? canonical.data : completed;
}
function withDependencies(inventory: Inventory, choices: SetupChoices): SetupChoices['streams'] {
	const unreleased = (pkg: Package) =>
		publishable(pkg)
		&& (pkg.publicationStatus === 'missing'
			|| (pkg.publicationStatus === 'published' && pkg.published !== pkg.version));
	const streamed = new Set(choices.streams.flatMap(stream => stream.packages));
	return choices.streams.map(stream => {
		const packages = [...stream.packages];
		for (let index = 0; index < packages.length; index++) {
			const pkg = inventory.packages.find(candidate => packageId(candidate) === packages[index]);
			for (const name of pkg?.dependencies ?? []) {
				const dependency = inventory.packages.find(other =>
					other.manager === pkg?.manager && other.name === name && unreleased(other)
				);
				const id = dependency && packageId(dependency);
				if (!id || streamed.has(id)) continue;
				streamed.add(id);
				packages.push(id);
			}
		}
		const added = packages.filter(id => !stream.packages.includes(id));
		return added.length
			? { ...stream, packages, required: [...stream.required, ...added.filter(id => !stream.required.includes(id))] }
			: stream;
	});
}
type Operation = 'prepare' | 'promote';
const operations: Operation[] = ['prepare', 'promote'];
export function setupOptions(plan: SetupPlan): SetupOption[] {
	const candidates = plan.packageIds.filter((_, index) => {
		const pkg = plan.inventory.packages[index];
		return pkg !== undefined && publishable(pkg);
	});
	const assigned = new Set(plan.choices.streams.flatMap(stream => stream.packages));
	const unassigned = candidates.filter(id => !assigned.has(id));
	return plan.choices.streams.flatMap((stream, index): SetupOption[] => [
		...[...new Set([...stream.packages, ...(index === 0 ? unassigned : [])])].map((id): SetupOption => ({
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
		...(stream.promote
			? approvals.map((value): SetupOption => ({ kind: 'approval', stream: stream.name, value }))
			: []),
		...(startable(stream)
			? startChannels.map((value): SetupOption => ({ kind: 'start', stream: stream.name, value }))
			: []),
		...(bumpable(stream)
			? versionBumps.map((value): SetupOption => ({ kind: 'bump', stream: stream.name, value }))
			: []),
		...(bumpable(stream)
			? versionPrMerges.map((value): SetupOption => ({ kind: 'versionPrMerge', stream: stream.name, value }))
			: []),
		...operations.flatMap(operation =>
			stream[operation]
				? triggerHandovers.map((value): SetupOption => ({ kind: 'triggers', stream: stream.name, operation, value }))
				: []
		),
		...binaryOptions(plan, stream),
	]);
}
function binaryOptions(plan: SetupPlan, stream: SetupChoices['streams'][number]): SetupOption[] {
	if (!stream.promote) return [];
	const candidates = (plan.binaryCandidates ?? []).filter(candidate => stream.packages.includes(candidate.package));
	const builds = [
		...(stream.promote.binaries?.builds ?? []).map(build => ({
			build,
			targets: candidates.find(candidate => candidate.build.name === build.name)?.targets ?? [...binaryTargets],
		})),
		...candidates.filter(candidate =>
			!stream.promote?.binaries?.builds.some(build => build.name === candidate.build.name)
		),
	];
	if (!builds.length) return [];
	return [
		...builds.map(({ build, targets }): SetupOption => ({ kind: 'binary', stream: stream.name, build, targets })),
		...binaryTargets.map((target): SetupOption => ({ kind: 'target', stream: stream.name, target })),
	];
}
export function optionId(option: SetupOption): string {
	const parts = option.kind === 'workflow'
		? [option.kind, option.stream, option.operation, option.file]
		: option.kind === 'binary'
		? [option.kind, option.stream, option.build.name]
		: option.kind === 'target'
		? [option.kind, option.stream, option.target]
		: option.kind === 'versioning' || option.kind === 'approval' || option.kind === 'start' || option.kind === 'bump'
				|| option.kind === 'versionPrMerge'
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
	if (option.kind === 'approval') return stream?.approval === option.value;
	if (option.kind === 'start') return stream?.start?.includes(option.value) ?? false;
	if (option.kind === 'bump') return stream?.bump === option.value;
	if (option.kind === 'versionPrMerge') return (stream?.versionPrMerge ?? 'manual') === option.value;
	if (option.kind === 'triggers') return stream?.[option.operation]?.triggers === option.value;
	if (option.kind === 'binary') {
		return stream?.promote?.binaries?.builds.some(build => build.name === option.build.name) ?? false;
	}
	if (option.kind === 'target') return stream?.promote?.binaries?.targets.includes(option.target) ?? false;
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
			const built = (chosen: SetupWorkflow | undefined): SetupWorkflow | undefined => {
				const offered = own.flatMap(option => option.kind === 'binary' ? [option] : []);
				if (!chosen || !offered.length) return chosen;
				const kept = offered.filter(state);
				const builds = kept.map(option =>
					chosen.binaries?.builds.find(build => build.name === option.build.name) ?? option.build
				);
				const ticked = own.flatMap(option => option.kind === 'target' && state(option) ? [option.target] : []);
				const targets = ticked.length || chosen.binaries
					? ticked
					: binaryTargets.filter(target => kept.every(option => option.targets.includes(target)));
				const { binaries: _binaries, ...rest } = chosen;
				return builds.length && targets.length ? { ...rest, binaries: { builds, targets } } : rest;
			};
			const prepare = handover('prepare', binding('prepare')),
				promote = built(handover('promote', binding('promote')));
			const versions = own.flatMap(option => option.kind === 'versioning' && state(option) ? [option.value] : []);
			const policies = own.flatMap(option => option.kind === 'approval' && state(option) ? [option.value] : []);
			const approval = policies.find(value => value !== stream.approval) ?? policies[0];
			const starting = own.flatMap(option => option.kind === 'start' ? [option] : []);
			const starts = starting.filter(state).map(option => option.value);
			const start = starting.length ? starts.length || stream.start ? starts : undefined : stream.start;
			const bumps = own.flatMap(option => option.kind === 'bump' && state(option) ? [option.value] : []);
			const bump = bumps.find(value => value !== stream.bump) ?? bumps[0];
			const merges = own.flatMap(option => option.kind === 'versionPrMerge' && state(option) ? [option.value] : []);
			const merge = merges.find(value => value !== (stream.versionPrMerge ?? 'manual')) ?? merges[0]
				?? stream.versionPrMerge;
			const {
				prepare: _prepare,
				promote: _promote,
				observe: _observe,
				approval: _approval,
				start: _start,
				bump: _bump,
				versionPrMerge: _merge,
				...kept
			} = stream;
			return {
				...kept,
				...(approval ? { approval } : {}),
				...(start ? { start } : {}),
				...(bump ? { bump } : {}),
				...(merge && (merge !== 'manual' || stream.versionPrMerge) ? { versionPrMerge: merge } : {}),
				name: stream.name,
				packages,
				versioning: versions.find(value => value !== stream.versioning) ?? versions[0] ?? stream.versioning,
				required: stream.observe
					? [
						...stream.required.filter(id => packages.includes(id)),
						...packages.filter(id => !stream.packages.includes(id) && !stream.required.includes(id)),
					]
					: packages,
				...(stream.versionSource ? { versionSource: stream.versionSource } : {}),
				...(stream.observe
					? {
						observe: stream.observe.map(entry => ({
							...entry,
							publications: entry.publications.filter(id =>
								packages.includes(id)
								|| !own.some(option => option.kind === 'package' && option.package === id)
							),
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
function binaryOrigin(build: BinaryBuild): string {
	return build.toolchain === 'cargo'
		? `Cargo, \`${build.manifest}\``
		: `Go, \`${build.package === '.' ? build.module : `${build.module}/${build.package.slice(2)}`}\``;
}
function triggerSentence(handover: TriggerHandover | 'new', files: string[]): string {
	const them = files.length === 1 ? 'it' : 'them';
	return handover === 'new'
		? `${listed(files)}: this PR creates ${them}, and only Beepboop dispatches ${them}.`
		: `${listed(files)}, \`existingTriggers: ${existingTriggersNames[handover]}\`: ${
			existingTriggersSentences[handover]
		}`;
}
const heldNote = 'Beepboop holds its release until the package has them.';
const releaseMarker = '<!-- beepboop:release-after-merge -->';
export function releaseAfterMerge(body: string): boolean {
	return /^[ \t]*[-*+] \[[xX]\] <!-- beepboop:release-after-merge -->/m.test(body);
}
function mentionFree(text: string): string {
	return text.replace(/(^|[\s(])(@[\w.-]+\/[\w.-]+)/g, '$1`$2`');
}
function noteMarkdown(plan: SetupPlan, note: string): string {
	const pkg = plan.inventory.packages.find(entry => note.startsWith(`${entry.name} (${entry.manifest}) `));
	return pkg
		? `\`${pkg.name}\` (\`${pkg.manifest}\`)${note.slice(`${pkg.name} (${pkg.manifest})`.length)}`
		: mentionFree(note);
}
function fixedStream(stream: SetupChoices['streams'][number]): string | undefined {
	if (!stream.promote) {
		return `\`${stream.name}\` has no publishing workflow, so it has no \`startFrom\`, \`versionLands\` or \`publishWhen\`.`;
	}
	if (stream.versionSource?.kind === 'tags') {
		return `\`${stream.name}\` takes its version from \`${stream.versionSource.prefix}\` tags. Beepboop raises no version for it, so it offers no \`startFrom\` or \`versionLands\`.`;
	}
	if (!startable(stream)) {
		return `\`${stream.name}\` versions each package on its own. Starting a release raises one version for the whole release group, so it offers no \`startFrom\`.`;
	}
	return undefined;
}
export interface SetupBodyContext {
	branch: string;
	defaultBranch: string;
	release?: boolean;
}
export function setupBody(plan: SetupPlan, context: SetupBodyContext): string {
	const { branch, defaultBranch, release = false } = context;
	const options = setupOptions(plan);
	const box = (indent: string, option: SetupOption, label: string) =>
		`${indent}- [${selected(option, plan.choices) ? 'x' : ' '}] <!-- beepboop:choice:${optionId(option)} --> ${label}`;
	const handovers = new Map<string, TriggerHandover | 'new'>();
	const workflow = (binding: SetupWorkflow | undefined) => {
		if (!binding) return 'none';
		const existing = plan.workflows.some(evidence => evidence.file === binding.file);
		handovers.set(binding.file, existing ? binding.triggers : 'new');
		return `\`${binding.file}\`${binding.job ? ` (job \`${binding.job}\`)` : ''}${existing ? '' : ', new in this PR'}`;
	};
	function choiceLines(stream: string): string[] {
		const own = options.filter(option => option.stream === stream);
		const approvals = own.flatMap(option =>
			option.kind === 'approval'
				? [box('    ', option, `\`${publishWhenNames[option.value]}\`: ${publishWhenSentences[option.value]}`)]
				: []
		);
		const starts = own.flatMap(option =>
			option.kind === 'start' ? [box('    ', option, `\`${option.value}\`: ${startFromSentences[option.value]}`)] : []
		);
		const bumps = own.flatMap(option =>
			option.kind === 'bump'
				? [box('    ', option, `\`${versionLandsNames[option.value]}\`: ${versionLandsSentences[option.value]}`)]
				: []
		);
		const merges = own.flatMap(option =>
			option.kind === 'versionPrMerge'
				? [box('    ', option, `\`${option.value}\`: ${versionPrMergeSentences[option.value]}`)]
				: []
		);
		return [
			...(starts.length ? [`  - \`startFrom\`: ${startFromQuestion}. Tick any of these.`, ...starts] : []),
			...(bumps.length
				? [`  - \`versionLands\`: ${versionLandsQuestion}, here \`${defaultBranch}\`. Tick one.`, ...bumps]
				: []),
			...(merges.length ? [`  - \`versionPrMerge\`: ${versionPrMergeQuestion}. Tick one.`, ...merges] : []),
			...(approvals.length ? [`  - \`publishWhen\`: ${publishWhenQuestion}. Tick one.`, ...approvals] : []),
		];
	}
	function binaryLines(stream: string): string[] {
		const own = options.filter(option => option.stream === stream);
		const builds = own.flatMap(option =>
			option.kind === 'binary'
				? [box('    ', option, `\`${option.build.name}\` (${binaryOrigin(option.build)})`)]
				: []
		);
		if (!builds.length) return [];
		const release = plan.choices.streams.find(entry => entry.name === stream)?.promote?.binaries;
		const failing = (target: BinaryTarget) =>
			(release?.builds ?? []).flatMap(build => {
				const candidate = plan.binaryCandidates?.find(entry => entry.build.name === build.name);
				return candidate && unbuildable(candidate, [target]).length ? [build.name] : [];
			});
		const targets = own.flatMap(option => {
			if (option.kind !== 'target') return [];
			const names = failing(option.target);
			return [
				box('    ', option, names.length ? `${option.target} (${listed(names)} expected to fail)` : option.target),
			];
		});
		return ['  - Release binaries', ...builds, '  - Binary targets', ...targets];
	}
	const streams = plan.choices.streams.map(stream => {
		const packages = options.flatMap(option =>
			option.kind === 'package' && option.stream === stream.name
				? [box('    ', option, packageMarkdown(option.package))]
				: []
		);
		const fixed = fixedStream(stream);
		return [
			`- **${stream.name}**`,
			...(packages.length ? ['  - Packages', ...packages] : []),
			...(fixed ? [`  - ${fixed}`] : []),
			...choiceLines(stream.name),
			`  - \`versionScope: ${versionScopeNames[stream.versioning]}\`: ${versionScopeSentences[stream.versioning]}`,
			`  - Preparation: ${workflow(stream.prepare)}`,
			`  - Publication: ${workflow(stream.promote)}`,
			...binaryLines(stream.name),
			...(stream.operations ?? []).map(entry =>
				`  - After ${
					entry.needs.map(name => {
						const jobs = entry.needsJobs?.[name];
						return jobs ? `jobs ${jobs.map(job => `\`${job}\``).join(', ')} of \`${name}\`` : `\`${name}\``;
					}).join(', ')
				}: ${workflow(entry)}`
			),
			...(stream.needs && Object.keys(stream.needs).length
				? [
					'  - Publication order',
					...publicationStages(
						[...stream.packages, ...(stream.observe ?? []).flatMap(entry => entry.publications)],
						stream.needs,
					).map((stage, index) =>
						`    ${index + 1}. ${stage.length > 1 ? 'In parallel: ' : ''}${stage.map(packageMarkdown).join(', ')}`
					),
				]
				: []),
		].join('\n');
	}).join('\n');
	const grouped = new Map<TriggerHandover | 'new', string[]>();
	for (const [file, handover] of handovers) grouped.set(handover, [...(grouped.get(handover) ?? []), `\`${file}\``]);
	const triggers = [...grouped].map(([handover, files]) => triggerSentence(handover, files));
	const update = branch !== onboardingBranch;
	const changes = update ? behaviourChanges(plan.edits) : [];
	const held = plan.notes.filter(note => note.endsWith(heldNote));
	const notes = plan.notes.filter(note => !note.endsWith(heldNote));
	const commit = `https://github.com/${plan.repository}/commit/${plan.sourceSha}`;
	const sections = [
		`Beepboop inspected [\`${plan.sourceSha.slice(0, 12)}\`](${commit}), the head of \`${defaultBranch}\`.`,
		...(changes.length ? [`### What changes\n\n${changes.join('\n')}`] : []),
		...(held.length ? [`### Held packages\n\n${held.map(note => `- ${noteMarkdown(plan, note)}`).join('\n')}`] : []),
		'### Choices',
		'Tick or untick packages to change this proposal. Every ticked package is in `mustPublish`: it must publish for the release to count as successful. Beepboop rebuilds the proposal 5 seconds after the last edit.',
		streams,
		...(triggers.length ? [`${existingTriggersQuestion}:\n\n${triggers.map(line => `- ${line}`).join('\n')}`] : []),
		'Change `versionScope`, workflows and `existingTriggers` in Beepboop under Repositories, Edit release setup.',
		`Tick this box to release the current version when this PR merges.\n\n- [${
			release ? 'x' : ' '
		}] ${releaseMarker} Release after merge`,
		...(plan.adoption?.length ? [mentionFree(plan.adoption.join('\n').trimEnd())] : []),
		...(notes.length ? [notes.map(note => `- ${noteMarkdown(plan, note)}`).join('\n')] : []),
		...(update && plan.edits.length ? [changeDetails(plan.edits)] : []),
	];
	return `${sections.join('\n\n')}\n`;
}
