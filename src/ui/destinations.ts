import {
	type ChannelOutcome,
	channelKey,
	isChannelOutcome,
	type ManifestOutcome,
	managerDestinations,
	type RegistryOutcome,
	type RegistryState,
	registryDestination,
	winget,
} from '@/automation/destinations';
import type { Inventory, Package } from '@/automation/types';
import { channelHref, registryHref } from '@/ui/templates/html';

export interface DestinationEntry {
	label: string;
	status: string;
	href?: string;
}

function storedOutcomes(pkg: Package): RegistryOutcome[] {
	if (pkg.destinations) return pkg.destinations;
	const primary = managerDestinations[pkg.manager]?.primary;
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

const submissionStates = {
	pending: 'Submission pending',
	open: 'Awaiting Microsoft review',
	merged: 'Merged by Microsoft',
	closed: 'Closed without merging',
	failed: 'Submission failed',
} as const;

export function manifestEntry(outcome: ManifestOutcome): DestinationEntry {
	if (outcome.state === 'unsubmitted') return { label: winget.label, status: 'No submission yet' };
	return {
		label: winget.label,
		status: `${submissionStates[outcome.state]} (${outcome.version})`,
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
		? outcome.version
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
