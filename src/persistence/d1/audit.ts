import { Effect } from 'effect';
import { z } from 'zod';
import type { DomainError } from '@/contract/errors';
import { auditActor } from '@/domain/audit';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

const activityRow = z.object({
	id: z.string(),
	actor: z.string(),
	action: z.string(),
	target: z.string(),
	created_at: z.number(),
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
	constructor(db: SqlDatabase) {
		this.sql = sql(db);
	}
	record(actor: string, action: string, target: string): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT INTO audit(id,actor,actor_json,action,target,created_at) VALUES(?,?,?,?,?,?)',
			crypto.randomUUID(),
			actor,
			JSON.stringify(auditActor(actor)),
			action,
			target,
			Date.now(),
		).pipe(Effect.asVoid);
	}
	recent(): Effect.Effect<AuditRow[], DomainError> {
		return this.sql.all('SELECT id, actor, action, target, created_at FROM audit ORDER BY created_at DESC LIMIT 200')
			.pipe(
				Effect.flatMap(rows => parse(z.array(activityRow), rows)),
				Effect.map(rows => rows.map(({ created_at, ...entry }) => ({ ...entry, createdAt: created_at }))),
			);
	}
}
