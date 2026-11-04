import type { DeliveryState, NotificationDelivery } from '@/automation/notifications.ts';
import type { ExecutionState, Publication, RepositoryRecord } from '@/automation/types.ts';
import type { WinGetSubmission } from '@/automation/winget.ts';
import type { Status, Tone } from '@/contract/views';
import type { ReleaseSetState, releaseSummaries } from '@/server/releases.ts';

export const executionTone = {
	pending: 'waiting',
	blocked: 'warn',
	ready: 'active',
	dispatching: 'active',
	running: 'active',
	succeeded: 'ok',
	failed: 'error',
	cancelled: 'error',
	uncertain: 'warn',
} as const satisfies Record<ExecutionState, Tone>;

export const publicationTone = {
	waiting: 'waiting',
	pending: 'waiting',
	'rate-limited': 'waiting',
	succeeded: 'ok',
	failed: 'error',
	uncertain: 'warn',
	skipped: 'neutral',
} as const satisfies Record<Publication['outcome'] | 'waiting', Tone>;

export const submissionTone = {
	pending: 'waiting',
	open: 'active',
	merged: 'ok',
	closed: 'warn',
	failed: 'error',
} as const satisfies Record<WinGetSubmission['state'], Tone>;

export const releaseSetTone = {
	succeeded: 'ok',
	'needs attention': 'warn',
	'awaiting approval': 'waiting',
	'in progress': 'active',
} as const satisfies Record<ReleaseSetState, Tone>;

const deliveryTone = {
	pending: 'waiting',
	delivered: 'ok',
	failed: 'error',
} as const satisfies Record<DeliveryState, Tone>;

export function deliveryStatus(delivery: NotificationDelivery): Status {
	const label = delivery.state === 'delivered'
		? 'Delivered'
		: delivery.state === 'failed'
		? 'Failed'
		: `Retrying (${delivery.attempts})`;
	return { tone: deliveryTone[delivery.state], label };
}

export function releaseStatus(release: ReturnType<typeof releaseSummaries>[number]): Status {
	if (release.attention) return { tone: 'warn', label: 'Needs attention' };
	if (release.publications.length && release.verified === release.publications.length) {
		return { tone: 'ok', label: 'Required publications verified' };
	}
	return { tone: 'active', label: 'In progress' };
}

export function repositoryStatus(repository: RepositoryRecord): Status {
	if (repository.suspended) return { tone: 'warn', label: 'App access unavailable' };
	if (repository.diagnostics.length) return { tone: 'warn', label: 'Setup needed' };
	if (!repository.configuration) return { tone: 'neutral', label: 'Setup needed' };
	return { tone: 'ok', label: 'Configured' };
}

export function destinationStatus(enabled: boolean): Status {
	return enabled ? { tone: 'ok', label: 'Enabled' } : { tone: 'neutral', label: 'Paused' };
}
