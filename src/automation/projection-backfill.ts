import { Effect } from 'effect';
import { Store } from '@/automation/store';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { sql } from '@/persistence/d1/database';
import { CompletionStore } from '@/release/adapters/d1/completions.ts';

export class ProjectionBackfill {
	constructor(private readonly db: SqlDatabase | Sql) {}
	drain() {
		return Effect.gen({ self: this }, function*() {
			const executions = yield* new Store(this.db).backfillExecutions();
			const releases = yield* new CompletionStore(sql(this.db)).backfill();
			return { executions, releases };
		});
	}
}
