import type { ManagerDestinationId } from '@/domain/catalog.ts';
import { managerSpec } from '@/domain/catalog.ts';
import type {
	Channel,
	ChannelOutcome,
	ManifestDestinationId,
	RegistryOutcome,
	RegistryState,
} from '@/domain/destinations.ts';
import { channelKey, isChannelOutcome } from '@/domain/destinations.ts';
import type { Inventory, Package } from '@/domain/inventory.ts';
import { githubHref, registryHref } from '@/publication/links.ts';
import type { WinGetSubmission } from '@/publication/winget/submission.ts';

export type ManifestOutcome =
	| { destination: ManifestDestinationId; state: 'unsubmitted' }
	| { destination: ManifestDestinationId; state: WinGetSubmission['state']; version: string; url?: string };

export function wingetOutcome(submission: WinGetSubmission | undefined): ManifestOutcome {
	if (!submission) return { destination: 'winget', state: 'unsubmitted' };
	return {
		destination: 'winget',
		state: submission.state,
		version: submission.plan.version,
		...(submission.url ? { url: submission.url } : {}),
	};
}

export function channelHref(channel: Channel): string {
	if (channel.destination === 'aur') return `https://aur.archlinux.org/packages/${encodeURIComponent(channel.name)}`;
	const file = `${channel.name}.${channel.destination === 'scoop' ? 'json' : 'rb'}`;
	return githubHref(channel.repository, 'blob', 'HEAD', channel.directory, file);
}

export function destinationOutcomes(pkg: Package): RegistryOutcome[] {
	if (pkg.destinations) return pkg.destinations;
	const primary = managerSpec(pkg.manager).destinations?.primary;
	if (!primary) return [];
	if (pkg.published !== undefined) return [{ destination: primary, state: 'published', version: pkg.published }];
	if (pkg.publicationStatus === 'missing') return [{ destination: primary, state: 'missing' }];
	if (pkg.publicationStatus === 'failed') {
		return [{ destination: primary, state: 'failed', reason: 'inspect diagnostics' }];
	}
	return [{ destination: primary, state: 'unchecked' }];
}

export function primaryState(pkg: Package): RegistryState {
	const primary = managerSpec(pkg.manager).destinations?.primary;
	const outcome = destinationOutcomes(pkg).find(outcome => outcome.destination === primary);
	return outcome && !isChannelOutcome(outcome) ? outcome : { state: 'unchecked' };
}

export function repositoryChannelOutcomes(inventory: Inventory): ChannelOutcome[] {
	const checked = new Map((inventory.destinations ?? []).map(outcome => [channelKey(outcome), outcome]));
	return (inventory.channels ?? []).map(channel =>
		checked.get(channelKey(channel)) ?? { ...channel, state: 'unchecked' }
	);
}

export function destinationHref(
	outcome: { destination: ManagerDestinationId } & RegistryState,
	pkg: Package,
	repository: string,
): string | undefined {
	const version = outcome.state === 'published' ? outcome.version : undefined;
	const reference = pkg.manager === 'goreleaser' && outcome.destination === 'github-release' && version
		? `v${version.replace(/^v/, '')}`
		: version;
	return registryHref(outcome.destination, pkg.name, reference, repository);
}
