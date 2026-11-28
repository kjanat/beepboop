import { Effect, Result, Schema } from 'effect';
import { binaryCandidates } from '@/discovery/analysis/binary-candidates.ts';
import { companionProposals } from '@/discovery/analysis/companions.ts';
import { discover } from '@/discovery/discover.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import type { ReleaseGraph } from '@/discovery/release-graph/graph.ts';
import { inferReleaseGraph } from '@/discovery/release-graph/graph.ts';
import { validateAgainst } from '@/discovery/validation/validate.ts';
import type { WorkflowEvidence } from '@/discovery/workflow-analysis/workflow-evidence.ts';
import { candidateOf, leftOut, unbuildable } from '@/domain/binary-platforms.ts';
import { isLockfile } from '@/domain/catalog.ts';
import { canonicalConfiguration } from '@/domain/configuration/canonical.ts';
import { withoutDefaults } from '@/domain/configuration/minimal.ts';
import { mergeConfiguration, parseRepositoryConfiguration } from '@/domain/configuration/presets.ts';
import type { Configuration } from '@/domain/configuration/schema.ts';
import { configurationDiagnostics, configurationPath } from '@/domain/configuration/schema.ts';
import type { Inventory, Snapshot } from '@/domain/inventory.ts';
import { matchesPackage, packageId, selectorKey } from '@/domain/package-identity.ts';
import { packageMarkdown } from '@/domain/package-label';
import { publishable } from '@/domain/package-publication.ts';
import { defaultPreset } from '@/domain/preset.ts';
import { startWorkflowFile } from '@/domain/release-start.ts';
import {
	publishWhenNames,
	publishWhenSentences,
	versionLandsNames,
	versionLandsSentences,
	versionScopeNames,
} from '@/domain/setup-terms.ts';
import { newVersionStartRefusal } from '@/domain/start-refusal.ts';
import { versionsInFiles } from '@/domain/version-tags.ts';
import type { WorkflowSetupInput } from '@/domain/workflow-setup.ts';
import { fromPromise, fromSync, toDomainError } from '@/kernel/errors/classify.ts';
import { blocking } from '@/kernel/errors/diagnostics.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { decodeRequest, precondition } from '@/kernel/errors/domain-error.ts';
import { sha256Hex } from '@/kernel/schema/ids.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';
import { formatJson, json } from '@/kernel/text/json.ts';
import { canVerifyPublication } from '@/publication/registries/verify.ts';
import { startCommand } from '@/setup/adoption.ts';
import { heldNote } from '@/setup/body.ts';
import { completeChoices, releases, withDependencies } from '@/setup/choices.ts';
import { bumpable, setupChoicesSchema, startable } from '@/setup/contract.ts';
import type { PublishingAccess } from '@/setup/publishing.ts';
import { checkPublishing } from '@/setup/publishing.ts';
import { evidence, requirablePackage, storedConfiguration, suggested } from '@/setup/suggest.ts';
import { streamSummary } from '@/setup/summary.ts';
import type { SetupChoices, SetupPlan, SetupWorkflow } from '@/setup/types.ts';
import { actionReleaseOffer } from '@/setup/workflows/action-release.ts';
import {
	dispatchedOperation,
	integrateReleaseWorkflow,
	integrateWorkflow,
	workflowActions,
	workflowCredentials,
} from '@/setup/workflows/integrate.ts';
import { startWorkflow } from '@/setup/workflows/start.ts';

export const branchConflictBlocker =
	'Someone else committed to the setup branch, so Beepboop stopped updating it. Take over to replace their commits with this proposal.';
export type WorkflowAccess = { readonly kind: 'granted' } | { readonly kind: 'missing'; readonly appPage: string };
export interface SetupBaseline {
	publishing?: PublishingAccess;
	head: string | null;
	workflowAccess?: WorkflowAccess;
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
function proposedSetup(
	snapshot: Snapshot,
	inventory: Inventory,
	baseline: SetupBaseline,
	resolved?: Configuration,
) {
	return Effect.gen(function*() {
		const raw = yield* storedConfiguration(snapshot);
		const workflows = yield* evidence(snapshot, inventory);
		const graph = inferReleaseGraph(snapshot, inventory);
		// Empty selections are allowed in suggestions, but cannot be applied.
		const candidates = binaryCandidates(snapshot, inventory);
		const suggestion = suggested(snapshot, raw, workflows, inventory, graph, resolved, baseline.saved, candidates);
		const normalized = safeDecode(setupChoicesSchema, suggestion);
		const requested = normalized.success ? normalized.data : suggestion;
		const proposal = completeChoices(
			snapshot,
			inventory,
			{ ...requested, streams: withDependencies(inventory, requested) },
			raw,
		);
		return { raw, workflows, graph, candidates, requested, proposal };
	});
}
export function inferredConfiguration(
	snapshot: Snapshot,
	inventory: Inventory,
): Effect.Effect<string | undefined, DomainError> {
	return Effect.gen(function*() {
		const beginning = new Set(
			Object.entries(snapshot.files).flatMap(([path, source]) => {
				const file = /^\.github\/workflows\/([^/]+\.ya?ml)$/.exec(path)?.[1];
				return file && workflowActions(source).has('begin') ? [file] : [];
			}),
		);
		if (snapshot.files[configurationPath] !== undefined || !beginning.size) return undefined;
		const baseline: SetupBaseline = { head: null };
		const { raw, workflows, requested } = yield* proposedSetup(snapshot, inventory, baseline);
		const unbuilt: SetupChoices = {
			...requested,
			streams: requested.streams.map(stream => {
				if (!stream.promote?.binaries) return stream;
				const { binaries: _binaries, ...promote } = stream.promote;
				return { ...stream, promote };
			}),
		};
		const adopted = completeChoices(
			snapshot,
			inventory,
			{ ...unbuilt, streams: withDependencies(inventory, unbuilt) },
			raw,
		);
		const { plan } = yield* drafted(snapshot, inventory, adopted, raw, workflows, baseline);
		if (plan.blockers.length || plan.edits.some(edit => edit.path !== configurationPath)) return undefined;
		return plan.edits.find(edit => edit.path === configurationPath)?.after;
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
		const { raw, workflows, graph, candidates, requested, proposal } = yield* proposedSetup(
			snapshot,
			inventory,
			baseline,
			resolved,
		);
		const chosen = input === undefined ? undefined : yield* decodeRequest(setupChoicesSchema, input);
		const choices = chosen ? completeChoices(snapshot, inventory, chosen, raw) : proposal;
		const inferred = input === undefined || JSON.stringify(choices) === JSON.stringify(proposal);
		const { plan: drafts, proposed } = yield* drafted(
			snapshot,
			inventory,
			choices,
			raw,
			workflows,
			baseline,
			resolved,
		);
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
		const narrowed: string[] = [], failing: string[] = [], unversioned: string[] = [], unstamped: string[] = [];
		for (const stream of choices.streams) {
			const release = stream.promote?.binaries;
			for (const build of release?.builds ?? []) {
				const candidate = candidateOf(candidates, build);
				if (!candidate || !release) continue;
				const version = candidate.unsettableVersion;
				if (version?.kind === 'const') {
					unstamped.push(
						`${stream.name}: \`${version.file}\` declares \`main.version\` as a constant. \`-X main.version\` leaves the version of ${build.name} unstamped. Declare it as a \`string\` variable to stamp it.`,
					);
				} else if (version) {
					unversioned.push(
						`${stream.name}: \`-X main.version\` cannot set the version of ${build.name}: \`${version.file}\` declares \`main.version\` as \`${version.type}\`. Declare it as a \`string\` variable or untick ${build.name}.`,
					);
				}
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
		const publishingChecks = baseline.publishing
			? yield* checkPublishing(snapshot, inventory, choices, baseline.publishing)
			: [];
		const plan = {
			...drafts,
			...(actionReleaseOffer(snapshot) ? { actionRelease: actionReleaseOffer(snapshot) } : {}),
			...(publishingChecks.length ? { publishingChecks } : {}),
			blockers: [...ineligible, ...unversioned, ...drafts.blockers],
			notes: [
				...unanswered,
				...added,
				...failing,
				...unstamped,
				...narrowed,
				...companionProposals(choices, snapshot, inventory),
				...drafts.notes,
				...publishingChecks.filter(check => check.status !== 'passed').map(check =>
					`${check.subject}: ${check.message}`
				),
			],
			...(candidates.length ? { binaryCandidates: candidates } : {}),
		};
		return inferred
			? { ...plan, adoption: proposalMarkdown(graph, snapshot, inventory, plan, proposed, resolved) }
			: plan;
	});
}
function proposalMarkdown(
	graph: ReleaseGraph,
	snapshot: Snapshot,
	inventory: Inventory,
	plan: Omit<SetupPlan, 'planId'>,
	adopted: Configuration | undefined,
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
			const until = stream.approval ? '' : ' until you tick another';
			const policyName = `\`publishWhen: ${publishWhenNames[policy]}\``;
			const configured = adopted?.streams[stream.name];
			const publishesOnStart = configured !== undefined
				&& newVersionStartRefusal(stream.name, configured, inventory) === undefined;
			lines.push(
				...(publishesOnStart
					? [
						`- Start a release with \`beepboop release\` in a checkout or from the dashboard. ${landing} ${
							bump === 'commit' ? 'The release then publishes' : 'Merging it publishes the release'
						} once the commit is verified and its checks pass, and nothing asks again.`,
						`- A version raised on the default branch without a start follows ${policyName}${until}: ${
							publishWhenSentences[policy]
						}`,
					]
					: [
						`- Start a release with \`beepboop release\` in a checkout or from the dashboard. ${landing} ${after} ${policyName} applies${until}: ${
							publishWhenSentences[policy]
						}`,
					]),
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
): Effect.Effect<{ plan: Omit<SetupPlan, 'planId'>; proposed: Configuration | undefined }, DomainError> {
	return Effect.gen(function*() {
		const configuration = structuredClone(raw);
		const streams = { ...object(configuration.streams) };
		const edits: SetupPlan['edits'] = [], blockers: string[] = [], notes: string[] = [];
		const ticked = new Set(choices.streams.flatMap(stream => stream.packages));
		for (const entry of inventory.diagnostics) {
			if (entry.code !== 'package-metadata') notes.push(`Discovery: ${entry.message}`);
			else if (entry.subject?.kind === 'package' && ticked.has(entry.subject.key)) {
				const id = entry.subject.key;
				const managed = choices.streams.some(stream => stream.promote && stream.packages.includes(id));
				const observed = choices.streams.some(stream =>
					stream.observe?.some(workflow => workflow.publications.includes(id))
				);
				notes.push(
					`${entry.message}. ${
						managed
							? heldNote
							: observed
							? 'Advisory: the existing publishing workflow controls publication; Beepboop only observes it.'
							: 'Advisory: address this metadata before publishing.'
					}`,
				);
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
			const offer = actionReleaseOffer(snapshot);
			if (selection.actionRelease && !offer) {
				blockers.push(`${selection.name}: GitHub Action metadata is required to adopt action release refs.`);
			}
			if (selection.actionRelease?.kind === 'source' && offer?.missing.length) {
				blockers.push(
					`${selection.name}: action entry points are absent from source (${
						offer.missing.join(', ')
					}). Select generated distribution publication and review all required files.`,
				);
			}
			if (selection.actionRelease?.kind === 'distribution' && !selection.promote?.commands.trim()) {
				blockers.push(
					`${selection.name}: enter the build commands that produce the selected action distribution files.`,
				);
			}
			if (names.has(selection.name)) return yield* precondition('Duplicate selected stream');
			names.add(selection.name);
			const selected = inventory.packages.filter(pkg =>
				selection.packages.includes(packageId(pkg)) && publishable(pkg)
			);
			const observedPublications = selection.observe?.flatMap(entry => entry.publications) ?? [];
			const published = selected.filter(pkg => !observedPublications.some(reference => matchesPackage(reference, pkg)));
			if (selection.promote?.binaries) managers.add('github-release');
			if (
				!selection.packages.length && !selection.observe?.length && !selection.promote?.binaries
				&& !selection.actionRelease
			) {
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
			const requested = (operation: string, workflow: { file: string; job?: string } | undefined) => {
				const file = workflow?.file;
				const found = workflowCredentials(
					file === undefined ? undefined : snapshot.files[`.github/workflows/${file}`],
					operation,
					workflow?.job,
				);
				for (const job of found.unresolved) {
					blockers.push(
						`${file}: list the credential aliases of job ${job} as literal JSON. Beepboop grants the aliases that setup reads from the workflow.`,
					);
				}
				return found.credentials.map(credential => ({ operation, file, ...credential }));
			};
			const granted = [
				...(['prepare', 'promote'] as const).flatMap(operation =>
					Object.values(selection[operation]?.credentials ?? {}).map(alias => ({
						operation,
						file: selection[operation]?.file,
						alias,
					}))
				),
				...(['prepare', 'promote'] as const).flatMap(operation => requested(operation, selection[operation])),
				...(selection.operations ?? []).flatMap(entry =>
					Object.values(entry.credentials ?? {}).map(alias => ({ operation: entry.name, file: entry.file, alias }))
				),
				...(selection.operations ?? []).flatMap(entry => requested(entry.name, entry)),
			];
			const credentials = [
				...new Set([
					...(Array.isArray(current.credentials) ? current.credentials.map(String) : []),
					...granted.map(entry => entry.alias),
				]),
			];
			if (credentials.length) updated.credentials = credentials;
			for (const entry of new Map(granted.map(entry => [JSON.stringify(entry), entry])).values()) {
				const environment = 'environment' in entry && typeof entry.environment === 'string'
					? entry.environment
					: undefined;
				if (environment?.includes('${{')) {
					blockers.push(
						`${entry.file}: give the job that requests ${entry.alias} a fixed environment name. Beepboop grants a credential to one named environment.`,
					);
					continue;
				}
				notes.push(
					`${entry.file}: when the repository owner merges this PR, Beepboop grants it the stored ${entry.alias} secret for the ${entry.operation} operation${
						environment === undefined ? '' : ` in the ${environment} environment`
					}.`,
				);
			}
			const workflows = object(current.workflows);
			const clearBackfill = (name: string) =>
				object(workflows[name]).backfill === true || resolved?.streams[selection.name]?.workflows[name]?.backfill
					? { backfill: false }
					: {};
			const bindings = Object.fromEntries(
				Object.entries(workflows).filter(([, value]) => object(value).mode !== 'observe'),
			);
			for (const entry of selection.observe ?? []) {
				const observed: Record<string, unknown> = {
					...object(workflows[entry.name]),
					...clearBackfill(entry.name),
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
				const previous = object(workflows[entry.name]);
				const { name: _name, backfill, needs: _needs, needsJobs: _jobs, publications: _publications, ...generator } =
					entry;
				const operation: Record<string, unknown> = {
					...previous,
					file: entry.file,
					...(backfill ? { mode: 'dispatch', backfill } : clearBackfill(entry.name)),
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
			const delegated = new Set(
				selection.operations?.filter(entry => !entry.backfill).flatMap(entry => entry.publications) ?? [],
			);
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
						const versionFiles = selection.versionFiles
							?? (Array.isArray(current.versionFiles)
								? current.versionFiles
								: resolved?.streams[selection.name]?.versionFiles ?? []);
						const fileless = !versionsInFiles({ ...inventory, packages: selected }) && !versionFiles.length;
						const promote = selection.promote;
						const tagged = fileless && selection.versionSource?.kind === 'tags' && promote !== undefined
							&& (promote.binaries !== undefined || promote.tagPrefix !== undefined
								|| selection.actionRelease !== undefined
								|| object(object(object(current.promote).workflow).refs).phase === 'version');
						if (!tagged && selected.length && snapshot.paths.some(isLockfile)) {
							blockers.push(`${selection.name}: select a preparation workflow to regenerate lockfiles.`);
						}
						const strategy = object(current.prepare).strategy ?? resolved?.streams[selection.name]?.prepare.strategy;
						if (strategy === 'workflow') {
							blockers.push(`${selection.name}: select a preparation workflow for the configured workflow strategy.`);
						}
						if (!tagged && selected.length && fileless) {
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
				if (operation === 'promote' && selection.actionRelease) {
					binding.refs = {
						phase: 'version',
						prefix: workflow.tagPrefix ?? 'v',
						signed: true,
						immutable: true,
						...(selection.actionRelease.kind === 'distribution'
							? { distribution: { files: selection.actionRelease.files, ancestry: 'ours' } }
							: {}),
					};
				}
				const packageTags = selected.filter(pkg => canVerifyPublication(pkg.manager)).map(packageId);
				if (
					operation === 'promote' && object(binding.refs).prefix === 'v' && current.packageTags === undefined
					&& packageTags.length
				) updated.packageTags = packageTags;
				if (shared) inputs.beepboop_operation = dispatchedOperation(operation);
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
					operation === 'promote' && selection.actionRelease
						? selection.actionRelease.kind === 'distribution' ? selection.actionRelease.files : []
						: undefined,
				));
				blockers.push(...generated.blockers);
				notes.push(...generated.notes);
				const path = `.github/workflows/${workflow.file}`, before = snapshot.files[path] ?? '';
				if (generated.content !== before) edits.push({ path, before, after: generated.content });
			}
			if (selection.bump) updated.prepare = { ...object(updated.prepare), bump: selection.bump };
			if (selection.actionRelease && selection.promote) {
				const file = `${selection.name === 'main' ? 'action' : selection.name}-aliases.yml`;
				const previousAlias = object(object(current.workflows).aliases), aliasRefs = object(previousAlias.refs);
				const ownedAlias = previousAlias.file === file && aliasRefs.phase === 'aliases'
					&& Array.isArray(previousAlias.needs) && previousAlias.needs.length === 1
					&& previousAlias.needs[0] === 'promote'
					&& Array.isArray(aliasRefs.aliases) && aliasRefs.aliases.length === 2 && aliasRefs.aliases.includes('major')
					&& aliasRefs.aliases.includes('minor');
				if (
					selectedFiles.has(file) || Object.keys(previousAlias).length > 0 && !ownedAlias
					|| snapshot.paths.includes(`.github/workflows/${file}`) && !ownedAlias
				) {
					blockers.push(
						`${file}: the aliases operation or workflow is already in use; resolve the collision before adopting action releases.`,
					);
				} else {
					selectedFiles.add(file);
					const alias: SetupWorkflow = {
						file,
						triggers: 'dispatchOnly',
						commands: '',
						publicationSteps: {},
						tagPrefix: selection.promote.tagPrefix ?? 'v',
					};
					bindings.aliases = {
						file,
						ref: snapshot.repository.defaultBranch,
						needs: ['promote'],
						publications: [],
						refs: { phase: 'aliases', prefix: alias.tagPrefix, aliases: ['major', 'minor'] },
					};
					updated.workflows = bindings;
					const generated = yield* Effect.fromResult(
						integrateWorkflow(snapshot, selection.name, 'aliases', alias, [], choices.actionsRevision),
					);
					blockers.push(...generated.blockers);
					notes.push(...generated.notes);
					const path = `.github/workflows/${file}`, before = snapshot.files[path] ?? '';
					if (before !== generated.content) edits.push({ path, before, after: generated.content });
				}
			}
			if (selection.versionPrMerge) {
				updated.prepare = { ...object(updated.prepare), versionPrMerge: selection.versionPrMerge };
			}
			if (selection.start) {
				updated.start = selection.start.flatMap(via => via === 'action' ? [{ via, workflow: startWorkflowFile }] : []);
			}
			for (const entry of selection.operations ?? []) {
				const { name: operation, backfill, needs: _needs, needsJobs: _jobs, publications, ...workflow } = entry;
				if (selectedFiles.has(workflow.file)) {
					blockers.push(`${workflow.file}: one workflow cannot be assigned to multiple release roles or streams.`);
				}
				selectedFiles.add(workflow.file);
				const generated = yield* Effect.fromResult(integrateWorkflow(
					snapshot,
					selection.name,
					operation,
					workflow,
					(backfill ? selected : published).filter(pkg => publications.includes(packageId(pkg))),
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
					selection.actionRelease
						? selection.actionRelease.kind === 'distribution' ? selection.actionRelease.files : []
						: undefined,
				));
				blockers.push(...generated.blockers);
				notes.push(...generated.notes);
				const path = `.github/workflows/${selection.promote.file}`, before = snapshot.files[path] ?? '';
				if (generated.content !== before) edits.push({ path, before, after: generated.content });
			}
		}
		const [firstDispatched, ...laterDispatched] = choices.streams.flatMap(stream =>
			stream.start?.includes('action') ? [stream.name] : []
		);
		if (firstDispatched !== undefined) {
			if (selectedFiles.has(startWorkflowFile)) {
				blockers.push(`${startWorkflowFile}: one workflow cannot start releases and run a release role.`);
			}
			const path = `.github/workflows/${startWorkflowFile}`, before = snapshot.files[path] ?? '';
			const after = startWorkflow([firstDispatched, ...laterDispatched], choices.actionsRevision);
			if (after !== before) edits.push({ path, before, after });
		}
		if (!choices.streams.length) blockers.push('Select at least one release stream.');
		if (choices.actionsRevision) configuration.actionsRevision = choices.actionsRevision;
		else delete configuration.actionsRevision;
		configuration.$schema ??= 'https://beepboop.kjanat.dev/schema/v1.json';
		const fresh = !snapshot.files[configurationPath];
		if (fresh && Object.hasOwn(streams, 'main')) configuration.extends = [defaultPreset];
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
				configuration: legacy,
				found: blocking(found).map(entry => entry.message),
			};
		});
		if (Result.isSuccess(validated)) {
			blockers.push(...validated.success.found);
		} else if (validated.failure instanceof Schema.SchemaError) {
			blockers.push(...configurationDiagnostics(validated.failure).map(entry => entry.message));
		} else {
			blockers.push(validated.failure.message);
		}
		const before = snapshot.files[configurationPath] ?? '';
		const stored = yield* fromSync((): unknown => JSON.parse(before || '{}'));
		const written = withoutDefaults(canonicalConfiguration(configuration, inventory.packages), stored);
		// Do not reformat an unchanged configuration simply to make a PR.
		const after = JSON.stringify(stored) === JSON.stringify(written)
			? before
			: formatJson(yield* Effect.fromResult(json(written)));
		if (after !== before) edits.unshift({ path: configurationPath, before, after });
		const prior = baseline.prior
			? { url: baseline.prior.url, superseded: !!before && baseline.prior.content !== before }
			: undefined;
		const access = baseline.workflowAccess;
		if (access?.kind === 'missing' && edits.some(edit => edit.path.startsWith('.github/workflows/'))) {
			blockers.push(
				`The GitHub App installation needs Workflows: write permission before this proposal can edit workflows. Update permissions for ${access.appPage} and approve the installation update, then preview again.`,
			);
		}
		const plan = {
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
		return { plan, proposed: Result.isSuccess(validated) ? validated.success.configuration : undefined };
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
