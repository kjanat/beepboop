import type {
	Channel,
	ChannelOutcome,
	ManifestOutcome,
	RegistryOutcome,
	RegistryState,
} from '@/automation/destinations';
import { channelKey, isChannelOutcome, registryDestination, winget } from '@/automation/destinations';
import type { Inventory, Package } from '@/automation/types';
import type { WinGetSubmission } from '@/automation/winget';
import { managerSpec } from '@/contract/catalog';
import { githubHref, registryHref } from '@/contract/links';

function channelHref(channel: Channel): string {
	if (channel.destination === 'aur') return `https://aur.archlinux.org/packages/${encodeURIComponent(channel.name)}`;
	const file = `${channel.name}.${channel.destination === 'scoop' ? 'json' : 'rb'}`;
	return githubHref(channel.repository, 'blob', 'HEAD', channel.directory, file);
}

export interface DestinationEntry {
	label: string;
	status: string;
	href?: string;
}

function storedOutcomes(pkg: Package): RegistryOutcome[] {
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

export function packageDestinations(pkg: Package, repository: string): DestinationEntry[] {
	return storedOutcomes(pkg).map(outcome => registryEntry(outcome, pkg.name, repository));
}

export function primaryStatus(pkg: Package): string {
	const primary = managerSpec(pkg.manager).destinations?.primary;
	const outcome = storedOutcomes(pkg).find(outcome => outcome.destination === primary);
	return outcome && !isChannelOutcome(outcome) ? stateLabel(outcome) : stateLabel({ state: 'unchecked' });
}

export const submissionLabels = {
	pending: 'Submission pending',
	open: 'Awaiting Microsoft review',
	merged: 'Merged by Microsoft',
	closed: 'Closed without merging',
	failed: 'Submission failed',
} as const satisfies Record<WinGetSubmission['state'], string>;

export function manifestEntry(outcome: ManifestOutcome): DestinationEntry {
	if (outcome.state === 'unsubmitted') return { label: winget.label, status: 'No submission yet' };
	return {
		label: winget.label,
		status: `${submissionLabels[outcome.state]} (${outcome.version})`,
		...(outcome.url ? { href: outcome.url } : {}),
	};
}

export function repositoryChannels(inventory: Inventory): { outcome: ChannelOutcome; entry: DestinationEntry }[] {
	const checked = new Map((inventory.destinations ?? []).map(outcome => [channelKey(outcome), outcome]));
	return (inventory.channels ?? []).map(channel => {
		const outcome: ChannelOutcome = checked.get(channelKey(channel)) ?? { ...channel, state: 'unchecked' };
		return { outcome, entry: channelEntry(outcome) };
	});
}

function stateLabel(outcome: RegistryState): string {
	return outcome.state === 'published'
		? `Released ${outcome.version}`
		: outcome.state === 'missing'
		? 'Not published'
		: outcome.state === 'failed'
		? `Lookup failed (${outcome.reason})`
		: 'Not checked';
}

function channelEntry(outcome: ChannelOutcome): DestinationEntry {
	return {
		label: `${registryDestination(outcome.destination).label} ${outcome.name}`,
		status: outcome.state === 'tracking' ? 'Tracks the default branch' : stateLabel(outcome),
		href: channelHref(outcome),
	};
}

function registryEntry(outcome: RegistryOutcome, name: string, repository: string): DestinationEntry {
	if (isChannelOutcome(outcome)) return channelEntry(outcome);
	const { label } = registryDestination(outcome.destination);
	const version = outcome.state === 'published' ? outcome.version : undefined;
	const href = registryHref(outcome.destination, name, version, repository);
	return { label, status: stateLabel(outcome), ...(href ? { href } : {}) };
}
