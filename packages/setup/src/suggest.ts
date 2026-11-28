import { Effect } from 'effect';
import { object } from '@/discovery/managers/manifest-editing.ts';
import type { ReleaseGraph } from '@/discovery/release-graph/graph.ts';
import { inferReleaseGraph } from '@/discovery/release-graph/graph.ts';
import type { WorkflowEvidence } from '@/discovery/workflow-analysis/workflow-evidence.ts';
import { workflowEvidence } from '@/discovery/workflow-analysis/workflow-evidence.ts';
import type { BinaryCandidate, BinaryRelease } from '@/domain/binary-platforms.ts';
import { defaultBinaryTargets, unconfigured } from '@/domain/binary-platforms.ts';
import { legacyConfiguration } from '@/domain/configuration/names.ts';
import type { Configuration } from '@/domain/configuration/schema.ts';
import { configurationPath } from '@/domain/configuration/schema.ts';
import type { Inventory, Package, Snapshot } from '@/domain/inventory.ts';
import { packageId, selectorKey } from '@/domain/package-identity.ts';
import { publishable } from '@/domain/package-publication.ts';
import { versionFileSchema } from '@/domain/version-files.ts';
import { tagPrefix } from '@/domain/version-tags.ts';
import { workflowSetup } from '@/domain/workflow-setup.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { mutableArray, safeDecode } from '@/kernel/schema/structs.ts';
import { adoptionChoices } from '@/setup/adoption.ts';
import { completeTaggedStreams } from '@/setup/completion.ts';
import type { SetupChoices, SetupWorkflow } from '@/setup/types.ts';
import { actionReleaseOffer } from '@/setup/workflows/action-release.ts';

export function requirablePackage(pkg: Package | undefined): boolean {
	return !!pkg && publishable(pkg) && !(tagPrefix(pkg.versionSource) !== undefined && pkg.version === undefined);
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
export function storedConfiguration(snapshot: Snapshot): Effect.Effect<Record<string, unknown>, DomainError> {
	return fromSync(() => object(legacyConfiguration(JSON.parse(snapshot.files[configurationPath] ?? '{}'))));
}
export function evidence(snapshot: Snapshot, inventory: Inventory): Effect.Effect<WorkflowEvidence[], DomainError> {
	return Effect.forEach(
		inventory.workflows,
		w =>
			Effect.fromResult(workflowEvidence(w.file, snapshot.files[`.github/workflows/${w.file}`] ?? '')).pipe(
				Effect.map(evidence => ({ ...evidence, ...(w.tagPatterns?.length ? { tagPatterns: w.tagPatterns } : {}) })),
			),
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
export function suggested(
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
			const stored = safeDecode(workflowSetup, binding.setup);
			if (stored.success) return stored.data;
			if (!before || before.file !== binding.file) return undefined;
			const { file: _file, ...input } = before;
			return input;
		};
		const choose = (operation: 'prepare' | 'release'): SetupWorkflow | undefined => {
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
			const backfill = binding.backfill === true;
			if (!input || (!backfill && !needs.length)) return [];
			const needsJobs = object(binding.needsJobs);
			return [{
				...input,
				name: operation,
				file: binding.file,
				needs,
				...(backfill ? { backfill: true as const } : {}),
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
		const versionFiles = safeDecode(mutableArray(versionFileSchema), current.versionFiles);
		const companionModules = Array.isArray(current.companionModules)
			? current.companionModules.map(value => selectorKey(String(value), inventory.packages))
			: [];
		const policy = object(object(object(current.release).workflow).refs);
		const distribution = object(policy.distribution);
		const aliasPolicy = object(object(object(current.workflows).aliases).refs);
		const actionRelease = actionReleaseOffer(snapshot) && policy.immutable === true && policy.signed === true
				&& Array.isArray(aliasPolicy.aliases) && aliasPolicy.aliases.includes('major')
				&& aliasPolicy.aliases.includes('minor')
			? Array.isArray(distribution.files) && distribution.files.every(file => typeof file === 'string')
				? { kind: 'distribution' as const, files: distribution.files }
				: { kind: 'source' as const }
			: undefined;
		streams.push({
			name,
			...(actionRelease ? { actionRelease } : {}),
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
			required: Array.isArray(current.required)
				? current.required.map(value => selectorKey(String(value), inventory.packages))
				: selected.filter(id => requirablePackage(inventory.packages.find(pkg => packageId(pkg) === id))),
			prepare: choose('prepare'),
			release: proposeBinaries(
				choose('release'),
				safeDecode(workflowSetup, object(object(current.release).workflow).setup).success
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
	releaseWorkflow: SetupWorkflow | undefined,
	held: boolean,
	candidates: readonly BinaryCandidate[],
): SetupWorkflow | undefined {
	if (!releaseWorkflow || held || releaseWorkflow.binaries || !candidates.length) return releaseWorkflow;
	return { ...releaseWorkflow, binaries: binaryRelease(candidates) };
}
export function binaryRelease(candidates: readonly BinaryCandidate[]): BinaryRelease {
	const proposed = unconfigured(candidates, []);
	return {
		builds: proposed.map(candidate => candidate.build),
		targets: defaultBinaryTargets.filter(target => proposed.every(candidate => candidate.targets.includes(target))),
	};
}
