import { Effect } from 'effect';
import { z } from 'zod';
import type { DomainError } from '@/contract/errors';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

const cursorRow = z.object({ last_tick: z.number() });

export class ScheduleStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase) {
		this.sql = sql(db);
	}
	cursor(key: string): Effect.Effect<number | undefined, DomainError> {
		return this.sql.first('SELECT last_tick FROM schedules WHERE id=?', key).pipe(
			Effect.flatMap(row =>
				row === null ? Effect.undefined : parse(cursorRow, row).pipe(Effect.map(parsed => parsed.last_tick))
			),
		);
	}
	start(key: string, tick: number): Effect.Effect<void, DomainError> {
		return this.sql.run('INSERT OR IGNORE INTO schedules(id,last_tick) VALUES(?,?)', key, tick).pipe(Effect.asVoid);
	}
	advance(key: string, tick: number): Effect.Effect<void, DomainError> {
		return this.sql.run('UPDATE schedules SET last_tick=? WHERE id=?', tick, key).pipe(Effect.asVoid);
	}
}
