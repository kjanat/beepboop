import {
	type ManifestOutcome,
	managerDestinations,
	type RegistryOutcome,
	registryDestination,
	winget,
} from '@/automation/destinations';
import type { Package } from '@/automation/types';
import { registryHref } from '@/ui/templates/html';

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

function registryEntry(outcome: RegistryOutcome, name: string, repository: string): DestinationEntry {
	const { label } = registryDestination(outcome.destination);
	const version = outcome.state === 'published' ? outcome.version : undefined;
	const href = registryHref(outcome.destination, name, version, repository);
	const status = outcome.state === 'published'
		? outcome.version
		: outcome.state === 'missing'
		? 'Not published'
		: outcome.state === 'failed'
		? `Lookup failed (${outcome.reason})`
		: 'Not checked';
	return { label, status, ...(href ? { href } : {}) };
}
