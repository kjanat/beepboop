import type { WinGetSubmission } from '@/automation/winget';
import type { ManagerDestinationId, RegistryDestinationId } from '@/contract/catalog';
import { channelDestinationIds, destinationLabels } from '@/contract/catalog';

export type ManifestDestinationId = 'winget';
export type Destination =
	| { kind: 'registry'; id: RegistryDestinationId; label: string }
	| { kind: 'manifest'; id: ManifestDestinationId; label: string };

export function registryDestination(id: RegistryDestinationId): Destination {
	return { kind: 'registry', id, label: destinationLabels[id] };
}
export const winget: Destination = { kind: 'manifest', id: 'winget', label: destinationLabels.winget };

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
