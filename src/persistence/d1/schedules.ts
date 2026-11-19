import { Effect, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { optionalColumn, sql } from '@/persistence/d1/database';

const cursorRow = mutableStruct({ last_tick: Schema.Finite });

export class ScheduleStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	cursor(key: string): Effect.Effect<number | undefined, DomainError> {
		return this.sql.first('SELECT last_tick FROM schedules WHERE id=?', key).pipe(
			Effect.flatMap(optionalColumn(cursorRow, row => row.last_tick)),
		);
	}
	start(key: string, tick: number): Effect.Effect<void, DomainError> {
		return this.sql.run('INSERT OR IGNORE INTO schedules(id,last_tick) VALUES(?,?)', key, tick).pipe(Effect.asVoid);
	}
	advance(key: string, tick: number): Effect.Effect<void, DomainError> {
		return this.sql.run('UPDATE schedules SET last_tick=? WHERE id=?', tick, key).pipe(Effect.asVoid);
	}
}
