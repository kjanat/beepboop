import { Effect } from 'effect';
import { Store } from '@/automation/store';
import { CompletionStore } from '@/persistence/d1/completions';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { sql } from '@/persistence/d1/database';

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
