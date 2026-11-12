import { Effect, Schema } from 'effect';
import type { DomainError } from '@/contract/errors';
import { auditActor } from '@/domain/audit';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';
import { mutableArray, mutableStruct } from '@/schema';

const activityRow = mutableStruct({
	id: Schema.String,
	actor: Schema.String,
	action: Schema.String,
	target: Schema.String,
	created_at: Schema.Finite,
});
export interface AuditRow {
	id: string;
	actor: string;
	action: string;
	target: string;
	createdAt: number;
}

export class AuditStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	record(actor: string, action: string, target: string): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run(
				'INSERT INTO audit(id,actor,actor_json,action,target,created_at) VALUES(?,?,?,?,?,?)',
				crypto.randomUUID(),
				actor,
				JSON.stringify(auditActor(actor)),
				action,
				target,
				clock.currentTimeMillisUnsafe(),
			).pipe(Effect.asVoid);
		});
	}
	recent(): Effect.Effect<AuditRow[], DomainError> {
		return this.sql.all('SELECT id, actor, action, target, created_at FROM audit ORDER BY created_at DESC LIMIT 200')
			.pipe(
				Effect.flatMap(rows => parse(mutableArray(activityRow), rows)),
				Effect.map(rows => rows.map(({ created_at, ...entry }) => ({ ...entry, createdAt: created_at }))),
			);
	}
}
