import { releaseCapability } from '@/automation/release-capability';
import { hasTagPromotion } from '@/automation/release-version';
import type { Inventory, ReleasePlan, Stream } from '@/automation/types';

export function startRefusal(
	name: string,
	stream: Stream,
	plan: ReleasePlan,
	inventory: Inventory,
): string | undefined {
	if (stream.versioning === 'independent') return `${name} cannot start releases: it needs one shared version`;
	if (stream.versionSource?.kind === 'tags') {
		if (!hasTagPromotion(stream, stream.versionSource.prefix)) {
			return `${name} needs a dispatchable promotion that publishes a version tag with prefix "${stream.versionSource.prefix}"`;
		}
		if (plan.requiresPreparation && stream.prepare.strategy === 'workflow') {
			return `${name} needs managed preparation to start a tag-based release`;
		}
		return undefined;
	}
	const capability = releaseCapability(stream, inventory);
	if (capability.kind === 'prepares' && capability.through.kind === 'files') {
		return `${name} writes its version only to version files, and merging them does not start publication`;
	}
	return undefined;
}
