import type { DeliveryState, NotificationDelivery } from '@/automation/notifications.ts';
import type { ExecutionState, Publication, RepositoryRecord } from '@/automation/types.ts';
import type { WinGetSubmission } from '@/automation/winget.ts';
import type { Status, Tone } from '@/contract/views';
import type { Readiness } from '@/domain/repository';
import { readiness } from '@/domain/repository';
import type { ReleaseSetState, releaseSummaries } from '@/server/releases.ts';
import { activeStates } from '@/server/releases.ts';

export const executionTone = {
	pending: 'waiting',
	'awaiting-approval': 'warn',
	blocked: 'warn',
	ready: 'active',
	dispatching: 'active',
	running: 'active',
	verifying: 'waiting',
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
	const { latest } = release;
	if (latest.state === 'awaiting-approval') return { tone: 'warn', label: 'Waiting for you to publish' };
	if (release.attention) return { tone: 'warn', label: 'Needs attention' };
	if (release.publications.length && release.verified === release.publications.length) {
		return { tone: 'ok', label: 'Required publications verified' };
	}
	if (activeStates.includes(latest.state)) return { tone: 'active', label: 'In progress' };
	if (latest.state === 'pending') return { tone: 'waiting', label: 'Waiting to start' };
	if (latest.state === 'succeeded' && latest.operation === 'prepare') {
		return { tone: 'waiting', label: 'Prepared, no publication run yet' };
	}
	return { tone: executionTone[latest.state], label: runStateLabels[latest.state] };
}

export const runStateLabels = {
	pending: 'waiting to start',
	'awaiting-approval': 'waiting for you to publish',
	blocked: 'blocked',
	ready: 'ready',
	dispatching: 'starting',
	running: 'running',
	verifying: 'checking the registries',
	succeeded: 'succeeded',
	failed: 'failed',
	cancelled: 'cancelled',
	uncertain: 'outcome unknown',
} as const satisfies Record<ExecutionState, string>;

export function runLabel(operation: string): string {
	return operation === 'prepare'
		? 'Preparation run'
		: operation === 'promote'
		? 'Publication run'
		: `${operation} run`;
}

const repositoryStatuses = {
	ready: { tone: 'ok', label: 'Configured' },
	suspended: { tone: 'warn', label: 'App access unavailable' },
	unconfigured: { tone: 'neutral', label: 'Not configured' },
	invalid: { tone: 'warn', label: 'Setup needed' },
} as const satisfies Record<Readiness['kind'], Status>;

export function repositoryStatus(repository: RepositoryRecord): Status {
	return repositoryStatuses[readiness(repository).kind];
}

export function destinationStatus(enabled: boolean): Status {
	return enabled ? { tone: 'ok', label: 'Enabled' } : { tone: 'neutral', label: 'Paused' };
}
