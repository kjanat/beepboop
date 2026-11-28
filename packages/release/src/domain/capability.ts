import type { StreamRelease } from '@/discovery/contract.ts';
import { operations } from '@/domain/configuration/schema.ts';
import type { Inventory, RepositoryRecord } from '@/domain/inventory.ts';
import { publishablePackages } from '@/domain/package-identity.ts';
import { newVersionStartRefusal, streamStartRefusal } from '@/domain/start-refusal.ts';
import { versionsInFiles } from '@/domain/version-tags.ts';
import type { ReleasePlan, Stream, WorkflowBinding } from '@/release/domain/execution/types.ts';

export interface ReleaseTrigger {
	file: string;
	ref?: string;
}
export type PreparationRoute =
	| { kind: 'workflow'; file: string }
	| { kind: 'manifests' }
	| { kind: 'files'; paths: string[] };
export type ReleaseCapability =
	| { kind: 'observes'; triggers: ReleaseTrigger[] }
	| { kind: 'unpublishable' }
	| { kind: 'releases'; workflow: string; automatic: boolean }
	| { kind: 'prepares'; through: PreparationRoute; lands: 'pr' | 'commit' };
function dispatched(binding: WorkflowBinding | undefined): binding is WorkflowBinding {
	return binding !== undefined && binding.mode !== 'observe';
}

export function releaseCapability(stream: Stream, inventory: Inventory): ReleaseCapability {
	const bindings = [...operations(stream)];
	const publisher = stream.versioning === 'independent'
		? bindings.find(([name, binding]) => name !== 'prepare' && dispatched(binding))?.[1]
		: dispatched(stream.release.workflow)
		? stream.release.workflow
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
		kind: 'releases',
		workflow: publisher.file,
		automatic: stream.release.approval === 'push' || streamStartRefusal('', stream) === undefined,
	};
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
): capability is Extract<ReleaseCapability, { kind: 'releases' | 'prepares' }> {
	return capability.kind === 'releases' || capability.kind === 'prepares';
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
		case 'releases':
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
