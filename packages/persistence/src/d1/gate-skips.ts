import { Effect, Schema } from 'effect';
import type { GateSkip, ReleaseGate } from '@/domain/release-gates.ts';
import { gateSkip } from '@/domain/release-gates.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { mapped, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

const skipRow = mapped(
	mutableStruct({
		kind: Schema.Literals(['signature', 'check', 'status', 'metadata']),
		name: Schema.String,
		actor: Schema.String,
		created_at: Schema.Finite,
	}),
	gateSkip,
	row => ({
		gate: row.kind === 'check' ? { kind: row.kind, name: row.name } : { kind: row.kind },
		actor: row.actor,
		at: row.created_at,
	}),
	skip => ({
		kind: skip.gate.kind,
		name: skip.gate.kind === 'check' ? skip.gate.name : '',
		actor: skip.actor,
		created_at: skip.at,
	}),
);

function name(gate: ReleaseGate): string {
	return gate.kind === 'check' ? gate.name : '';
}

export class GateSkipStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	list(repositoryId: number, stream: string): Effect.Effect<GateSkip[], DomainError> {
		return this.sql.all(
			'SELECT kind, name, actor, created_at FROM gate_skips WHERE repository_id=? AND stream=? ORDER BY created_at, kind, name',
			repositoryId,
			stream,
		).pipe(Effect.flatMap(rows => parse(mutableArray(skipRow), rows)));
	}
	skip(repositoryId: number, stream: string, gate: ReleaseGate, actor: string): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock =>
			this.sql.run(
				'INSERT OR IGNORE INTO gate_skips(repository_id,stream,kind,name,actor,created_at) VALUES(?,?,?,?,?,?)',
				repositoryId,
				stream,
				gate.kind,
				name(gate),
				actor,
				clock.currentTimeMillisUnsafe(),
			)
		).pipe(Effect.asVoid);
	}
	restore(repositoryId: number, stream: string, gate: ReleaseGate): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'DELETE FROM gate_skips WHERE repository_id=? AND stream=? AND kind=? AND name=?',
			repositoryId,
			stream,
			gate.kind,
			name(gate),
		).pipe(Effect.asVoid);
	}
}
