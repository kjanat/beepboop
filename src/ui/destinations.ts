import type { ChannelOutcome, RegistryOutcome, RegistryState } from '@/domain/destinations.ts';
import { isChannelOutcome, registryDestination, winget } from '@/domain/destinations.ts';
import type { Inventory, Package } from '@/domain/inventory.ts';
import type { ManifestOutcome } from '@/publication/destinations.ts';
import {
	channelHref,
	destinationHref,
	destinationOutcomes,
	primaryState,
	repositoryChannelOutcomes,
} from '@/publication/destinations.ts';
import type { WinGetSubmission } from '@/publication/winget/submission.ts';

export interface DestinationEntry {
	label: string;
	status: string;
	href?: string;
}

export function packageDestinations(pkg: Package, repository: string): DestinationEntry[] {
	return destinationOutcomes(pkg).map(outcome => registryEntry(outcome, pkg, repository));
}

export function primaryStatus(pkg: Package): string {
	return stateLabel(primaryState(pkg));
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
	return repositoryChannelOutcomes(inventory).map(outcome => ({ outcome, entry: channelEntry(outcome) }));
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

function registryEntry(outcome: RegistryOutcome, pkg: Package, repository: string): DestinationEntry {
	if (isChannelOutcome(outcome)) return channelEntry(outcome);
	const { label } = registryDestination(outcome.destination);
	const href = destinationHref(outcome, pkg, repository);
	return { label, status: stateLabel(outcome), ...(href ? { href } : {}) };
}
