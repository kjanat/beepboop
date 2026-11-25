import type { WorkflowBinding } from '@/domain/configuration/schema.ts';

export function backfillRefusal(
	operation: string,
	binding?: Pick<WorkflowBinding, 'backfill' | 'ref'>,
	defaultBranch?: string,
): string | undefined {
	if (!binding?.backfill || operation === 'prepare' || operation === 'promote') {
		return 'Select an operation enabled for backfills in repository configuration';
	}
	if (binding.ref && defaultBranch && binding.ref !== defaultBranch && binding.ref !== `refs/heads/${defaultBranch}`) {
		return 'Backfill workflow must run on the repository default branch';
	}
}
