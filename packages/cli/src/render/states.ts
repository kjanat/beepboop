import type { State } from '@/cli/render/look';
import type { BinaryProgress, PackageTagView } from '@/contract/views';
import type { GitHubJobKind } from '@/domain/github-run-state.ts';

const stateTable = {
	execution: { succeeded: 'published', failed: 'failed', cancelled: 'skipped' },
	publication: {
		succeeded: 'published',
		failed: 'failed',
		cancelled: 'skipped',
		skipped: 'skipped',
		pending: 'waiting',
		uncertain: 'waiting',
		'rate-limited': 'waiting',
	},
	inventory: { published: 'published', missing: 'waiting' },
	packageTag: {
		exists: 'skipped',
		conflict: 'failed',
		unpublished: 'skipped',
		publishable: 'waiting',
		created: 'published',
		failed: 'failed',
	} satisfies Record<PackageTagView['outcome'], State>,
	build: {
		waiting: 'waiting',
		running: 'waiting',
		succeeded: 'published',
		failed: 'failed',
		cancelled: 'failed',
		skipped: 'skipped',
		neutral: 'skipped',
		'timed-out': 'failed',
		'action-required': 'failed',
		'startup-failure': 'failed',
		stale: 'failed',
	} satisfies Record<Exclude<GitHubJobKind, 'unknown'>, State>,
} as const satisfies Record<string, Readonly<Record<string, State>>>;

const fallback = { execution: 'waiting', publication: 'waiting', inventory: 'skipped' } as const satisfies Record<
	string,
	State
>;

export function stateOf(subject: keyof typeof fallback, outcome: string | undefined): State {
	const states: Readonly<Record<string, State>> = stateTable[subject];
	const state = outcome !== undefined && Object.hasOwn(states, outcome) ? states[outcome] : undefined;
	return state ?? fallback[subject];
}

export function packageTagState(outcome: PackageTagView['outcome']): State {
	return stateTable.packageTag[outcome];
}

export function buildState(leg: BinaryProgress['legs'][number]): State {
	const kind = leg.kind ?? leg.state;
	if (kind === 'unknown') return leg.status === 'completed' ? 'failed' : 'waiting';
	return stateTable.build[kind];
}
