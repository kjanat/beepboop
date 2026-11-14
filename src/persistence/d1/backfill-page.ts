import { Effect } from 'effect';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';

export interface BackfillProgress {
	selected: number;
	changed: number;
}

export function backfillPage(
	table: 'executions' | 'releases',
	columns: string,
	pending: string,
	scope: string,
): string {
	return `SELECT ${columns} FROM (
 SELECT ${columns},SUM(length(CAST(document AS BLOB))) OVER (ORDER BY id) AS document_bytes,
  ROW_NUMBER() OVER (ORDER BY id) AS ordinal
 FROM (SELECT ${columns} FROM ${table} WHERE ${pending} ${scope} LIMIT ?)
) WHERE document_bytes<=512000 OR ordinal=1`;
}

export function drainBackfill(
	step: () => Effect.Effect<BackfillProgress, DomainError>,
): Effect.Effect<number, DomainError> {
	return Effect.gen(function*() {
		let total = 0, stalled = 0;
		for (;;) {
			const progress = yield* step();
			if (!progress.selected) return total;
			total += progress.changed;
			stalled = progress.changed ? 0 : stalled + 1;
			if (stalled >= 8) {
				return yield* precondition(
					'Projection maintenance could not make progress; retry after concurrent writes settle',
				);
			}
		}
	});
}
