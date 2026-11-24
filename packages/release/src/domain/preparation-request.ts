import type { Edit, Snapshot } from '@/domain/inventory.ts';
import type { Execution } from '@/release/domain/execution/types.ts';

export type Preparation = NonNullable<Execution['prepared']> | NonNullable<Execution['managed']>;

export interface PreparationDraft {
	readonly branch: string;
	readonly title: string;
	readonly body: string;
	readonly edits: Edit[];
}

interface Target {
	readonly execution: Execution;
	readonly preparation: Preparation;
	readonly snapshot: Snapshot;
}

export type PreparationRequest =
	| Target & {
		readonly _tag: 'CommitVersion';
		readonly message: string;
		readonly edits: Edit[];
		readonly head: string | undefined;
	}
	| Target & {
		readonly _tag: 'ResumePullRequest';
		readonly branch: string;
		readonly title: string;
		readonly body: string;
		readonly head: string;
	}
	| Target & {
		readonly _tag: 'OpenPullRequest';
		readonly branch: string;
		readonly title: string;
		readonly body: string;
		readonly edits: Edit[];
		readonly coAuthored: boolean;
	};

export function landsByCommit(execution: Execution): boolean {
	return execution.configuration.streams[execution.stream]?.prepare.bump === 'commit';
}

export function versionMessage(execution: Execution): string {
	return `chore(release): ${execution.version ?? 'release set'}`;
}

export function preparationRequest(
	execution: Execution,
	preparation: Preparation,
	snapshot: Snapshot,
	draft: PreparationDraft,
): PreparationRequest {
	const target = { execution, preparation, snapshot };
	if (landsByCommit(execution)) {
		return {
			...target,
			_tag: 'CommitVersion',
			message: versionMessage(execution),
			edits: draft.edits,
			head: preparation.head,
		};
	}
	if (preparation.head) {
		return {
			...target,
			_tag: 'ResumePullRequest',
			branch: draft.branch,
			title: draft.title,
			body: draft.body,
			head: preparation.head,
		};
	}
	return {
		...target,
		_tag: 'OpenPullRequest',
		branch: draft.branch,
		title: draft.title,
		body: draft.body,
		edits: draft.edits,
		coAuthored: execution.initiatedBy !== undefined,
	};
}
