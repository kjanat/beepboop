import { versionsInFiles } from '@/automation/managers';
import type { Inventory, RepositoryRecord, Stream, WorkflowBinding } from '@/automation/types';
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
	if (versionsInFiles(inventory)) return { kind: 'prepares', through: { kind: 'manifests' }, lands };
	if (stream.versionFiles?.length) {
		return { kind: 'prepares', through: { kind: 'files', paths: stream.versionFiles.map(rule => rule.path) }, lands };
	}
	if (workflow) return { kind: 'prepares', through: { kind: 'workflow', file: workflow.file }, lands };
	return { kind: 'promotes', workflow: publisher.file, automatic: stream.promote.approval === 'push' };
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
