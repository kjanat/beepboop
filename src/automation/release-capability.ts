import type { Inventory, RepositoryRecord } from '@/automation/inventory';
import { versionsInFiles } from '@/automation/managers';
import { publishablePackages } from '@/automation/package-identity';
import { hasTagPromotion } from '@/automation/release-version';
import type { ReleasePlan, Stream, WorkflowBinding } from '@/automation/types';
import type { StreamRelease } from '@/contract/views';
import { operations } from '@/domain/configuration';

export interface ReleaseTrigger {
	file: string;
	ref?: string;
}
export type Preparation =
	| { kind: 'workflow'; file: string }
	| { kind: 'manifests' }
	| { kind: 'files'; paths: string[] };
export type ReleaseCapability =
	| { kind: 'observes'; triggers: ReleaseTrigger[] }
	| { kind: 'unpublishable' }
	| { kind: 'promotes'; workflow: string; automatic: boolean }
	| { kind: 'prepares'; through: Preparation; lands: 'pr' | 'commit' };
function dispatched(binding: WorkflowBinding | undefined): binding is WorkflowBinding {
	return binding !== undefined && binding.mode !== 'observe';
}

export function releaseCapability(stream: Stream, inventory: Inventory): ReleaseCapability {
	const bindings = [...operations(stream)];
	const publisher = stream.versioning === 'independent'
		? bindings.find(([name, binding]) => name !== 'prepare' && dispatched(binding))?.[1]
		: dispatched(stream.promote.workflow)
		? stream.promote.workflow
		: undefined;
	if (!publisher) {
		const triggers = bindings.flatMap(([, binding]) =>
			binding.mode === 'observe'
				? [{ file: binding.file, ...(binding.ref === undefined ? {} : { ref: binding.ref }) }]
				: []
		);
		return triggers.length ? { kind: 'observes', triggers } : { kind: 'unpublishable' };
	}
	const lands = stream.prepare.bump === 'commit' ? 'commit' : 'pr';
	const workflow = stream.prepare.workflow;
	if (workflow && stream.prepare.strategy === 'workflow') {
		return { kind: 'prepares', through: { kind: 'workflow', file: workflow.file }, lands };
	}
	if (versionsInFiles({ ...inventory, packages: publishablePackages(inventory.packages, stream.packages) })) {
		return { kind: 'prepares', through: { kind: 'manifests' }, lands };
	}
	if (stream.versionFiles?.length) {
		return { kind: 'prepares', through: { kind: 'files', paths: stream.versionFiles.map(rule => rule.path) }, lands };
	}
	if (workflow) return { kind: 'prepares', through: { kind: 'workflow', file: workflow.file }, lands };
	return {
		kind: 'promotes',
		workflow: publisher.file,
		automatic: stream.promote.approval === 'push' || streamStartRefusal('', stream) === undefined,
	};
}

function streamStartRefusal(name: string, stream: Stream): string | undefined {
	if (stream.versioning === 'independent') return `${name} cannot start releases: it needs one shared version`;
	if (stream.versionSource?.kind === 'tags' && !hasTagPromotion(stream, stream.versionSource.prefix)) {
		return `${name} needs a dispatchable promotion that publishes a version tag with prefix "${stream.versionSource.prefix}"`;
	}
	return undefined;
}

function preparationRefusal(
	name: string,
	stream: Stream,
	inventory: Inventory,
	selected: string[] | undefined,
): string | undefined {
	const delegated = stream.prepare.strategy === 'workflow' ? stream.prepare.workflow : undefined;
	if (delegated) {
		return `${name} prepares its version in ${delegated.file}, and Beepboop cannot follow that preparation to its merge`;
	}
	const chosen = publishablePackages(inventory.packages, selected);
	if (chosen.length < publishablePackages(inventory.packages, stream.packages).length) {
		return `${name} shares one version across its packages, and a release of only some of them does not start publication`;
	}
	if (stream.versionSource?.kind === 'tags') return undefined;
	return versionsInFiles({ ...inventory, packages: chosen })
		? undefined
		: `${name} keeps its version outside package manifests, and merging a version bump there does not start publication`;
}

export function newVersionStartRefusal(
	name: string,
	stream: Stream,
	inventory: Inventory,
	selected = stream.packages,
): string | undefined {
	return streamStartRefusal(name, stream) ?? preparationRefusal(name, stream, inventory, selected);
}

export function startRefusal(
	name: string,
	stream: Stream,
	plan: ReleasePlan,
	inventory: Inventory,
	selected: string[] | undefined,
): string | undefined {
	return plan.edits.length || plan.requiresPreparation
		? newVersionStartRefusal(name, stream, inventory, selected)
		: streamStartRefusal(name, stream);
}

export function releasable(
	capability: ReleaseCapability,
): capability is Extract<ReleaseCapability, { kind: 'promotes' | 'prepares' }> {
	return capability.kind === 'promotes' || capability.kind === 'prepares';
}

function listed(items: readonly string[], last: string): string {
	const head = items.slice(0, -1);
	return head.length ? `${head.join(', ')} ${last} ${items.at(-1)}` : (items[0] ?? '');
}

export function capabilitySentence(name: string, capability: ReleaseCapability): string {
	switch (capability.kind) {
		case 'observes':
			return `${
				listed(
					capability.triggers.map(trigger => trigger.ref ? `${trigger.file} on ${trigger.ref}` : trigger.file),
					'or',
				)
			} starts a release of ${name}. Beepboop records the run and starts no release of this stream.`;
		case 'unpublishable':
			return `${name} has no publishing workflow. Add one in release setup.`;
		case 'promotes':
			return `${name} has no version to write. The release goes straight to ${capability.workflow} and ${
				capability.automatic
					? 'publishes once the commit is verified and its checks pass'
					: 'waits for you to publish it'
			}.`;
		case 'prepares': {
			const { through } = capability;
			if (through.kind === 'workflow') return `${through.file} prepares the new version of ${name}.`;
			const target = through.kind === 'manifests' ? 'the package manifests' : listed(through.paths, 'and');
			return capability.lands === 'commit'
				? `Beepboop commits the new version of ${name} to ${target}.`
				: `Beepboop opens a preparation pull request that writes the new version of ${name} to ${target}.`;
		}
	}
}

export function streamReleases(repository: RepositoryRecord): Record<string, StreamRelease> {
	return Object.fromEntries(
		Object.entries(repository.configuration?.streams ?? {}).map(([name, stream]) => {
			const capability = releaseCapability(stream, repository.inventory);
			return [name, { kind: capability.kind, summary: capabilitySentence(name, capability) }];
		}),
	);
}
