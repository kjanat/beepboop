import type { ManagerName } from '@/automation/types';
import type { WinGetSubmission } from '@/automation/winget';

export const registryDestinationIds = [
	'npm',
	'crates-io',
	'jsr',
	'go-proxy',
	'github-release',
	'oci',
	'vscode-marketplace',
	'open-vsx',
] as const;
export type RegistryDestinationId = (typeof registryDestinationIds)[number];
export type ManifestDestinationId = 'winget';
export type DestinationId = RegistryDestinationId | ManifestDestinationId;
export type Destination =
	| { kind: 'registry'; id: RegistryDestinationId; label: string }
	| { kind: 'manifest'; id: ManifestDestinationId; label: string };

const registryLabels: Record<RegistryDestinationId, string> = {
	npm: 'npm',
	'crates-io': 'crates.io',
	jsr: 'JSR',
	'go-proxy': 'Go module proxy',
	'github-release': 'GitHub release',
	oci: 'Container registry',
	'vscode-marketplace': 'Visual Studio Marketplace',
	'open-vsx': 'Open VSX',
};
export function registryDestination(id: RegistryDestinationId): Destination {
	return { kind: 'registry', id, label: registryLabels[id] };
}
export const winget: Destination = { kind: 'manifest', id: 'winget', label: 'WinGet' };

export interface ManagerDestinations {
	primary: RegistryDestinationId;
	secondary: readonly RegistryDestinationId[];
}
export const managerDestinations: Record<ManagerName, ManagerDestinations | undefined> = {
	npm: { primary: 'npm', secondary: [] },
	cargo: { primary: 'crates-io', secondary: [] },
	jsr: { primary: 'jsr', secondary: [] },
	go: { primary: 'go-proxy', secondary: [] },
	goreleaser: { primary: 'github-release', secondary: [] },
	'github-release': { primary: 'github-release', secondary: [] },
	oci: { primary: 'oci', secondary: [] },
	vscode: { primary: 'vscode-marketplace', secondary: ['open-vsx'] },
	manifest: undefined,
	workflow: undefined,
	'pre-commit': undefined,
};
export function destinationsOf(manager: ManagerName): RegistryDestinationId[] {
	const mapped = managerDestinations[manager];
	return mapped ? [mapped.primary, ...mapped.secondary] : [];
}

export type RegistryOutcome =
	| { destination: RegistryDestinationId; state: 'published'; version: string }
	| { destination: RegistryDestinationId; state: 'missing' }
	| { destination: RegistryDestinationId; state: 'failed'; reason: string }
	| { destination: RegistryDestinationId; state: 'unchecked' };
export type ManifestOutcome =
	| { destination: ManifestDestinationId; state: 'unsubmitted' }
	| { destination: ManifestDestinationId; state: WinGetSubmission['state']; version: string; url?: string };
export type DestinationOutcome = RegistryOutcome | ManifestOutcome;

export function wingetOutcome(submission: WinGetSubmission | undefined): ManifestOutcome {
	if (!submission) return { destination: 'winget', state: 'unsubmitted' };
	return {
		destination: 'winget',
		state: submission.state,
		version: submission.plan.version,
		...(submission.url ? { url: submission.url } : {}),
	};
}
