import type { ManagerName } from '@/automation/types';
import type { WinGetSubmission } from '@/automation/winget';

export const managerDestinationIds = [
	'npm',
	'crates-io',
	'jsr',
	'go-proxy',
	'github-release',
	'oci',
	'vscode-marketplace',
	'open-vsx',
] as const;
export const channelDestinationIds = ['homebrew', 'scoop', 'aur'] as const;
export const registryDestinationIds = [...managerDestinationIds, ...channelDestinationIds] as const;
export type ManagerDestinationId = (typeof managerDestinationIds)[number];
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
	homebrew: 'Homebrew',
	scoop: 'Scoop',
	aur: 'AUR',
};
export function registryDestination(id: RegistryDestinationId): Destination {
	return { kind: 'registry', id, label: registryLabels[id] };
}
export const winget: Destination = { kind: 'manifest', id: 'winget', label: 'WinGet' };

export interface ManagerDestinations {
	primary: ManagerDestinationId;
	secondary: readonly ManagerDestinationId[];
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
export function destinationsOf(manager: ManagerName): ManagerDestinationId[] {
	const mapped = managerDestinations[manager];
	return mapped ? [mapped.primary, ...mapped.secondary] : [];
}

export type Channel =
	| {
		destination: 'homebrew';
		kind: 'cask' | 'formula';
		repository: string;
		directory: string;
		name: string;
		manifest: string;
	}
	| { destination: 'scoop'; repository: string; directory: string; name: string; manifest: string }
	| { destination: 'aur'; name: string; manifest: string };
export function channelKey(channel: Channel): string {
	return channel.destination === 'aur'
		? `aur:${channel.name}`
		: `${channel.destination}:${channel.repository}/${channel.directory}/${channel.name}`;
}
export function tracksBranch(channel: Channel): boolean {
	return channel.destination === 'aur' && channel.name.endsWith('-git');
}

export type RegistryState =
	| { state: 'published'; version: string }
	| { state: 'missing' }
	| { state: 'failed'; reason: string }
	| { state: 'unchecked' };
export type ChannelOutcome = Channel & (RegistryState | { state: 'tracking' });
export type RegistryOutcome = ({ destination: ManagerDestinationId } & RegistryState) | ChannelOutcome;
export function isChannelOutcome(outcome: RegistryOutcome): outcome is ChannelOutcome {
	return channelDestinationIds.some(id => id === outcome.destination);
}
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
