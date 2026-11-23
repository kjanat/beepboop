import type { Stream } from '@/domain/configuration/schema.ts';
import type { Inventory } from '@/domain/inventory.ts';
import { publishablePackages } from '@/domain/package-identity.ts';
import { versionsInFiles } from '@/domain/version-tags.ts';

export function hasTagPromotion(stream: Stream, prefix: string): boolean {
	const workflow = stream.promote.workflow;
	return workflow !== undefined && workflow.mode !== 'observe' && !workflow.ref?.includes('*')
		&& workflow.refs?.phase === 'version' && workflow.refs.prefix === prefix;
}

export function streamStartRefusal(name: string, stream: Stream): string | undefined {
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
