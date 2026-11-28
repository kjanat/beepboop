import { Effect, Schema } from 'effect';
import type { SyncState } from '@/credentials/vault.ts';
import { syncStates } from '@/credentials/vault.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

const deliveryRow = mutableStruct({
	grant_id: Schema.String,
	version: Schema.Finite,
	state: Schema.Literals(syncStates),
	updated_at: Schema.Finite,
});

export interface SecretDelivery {
	readonly grantId: string;
	readonly version: number;
	readonly state: SyncState;
	readonly updatedAt: number;
}

export class SecretDeliveryStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	list(): Effect.Effect<SecretDelivery[], DomainError> {
		return this.sql.all('SELECT grant_id,version,state,updated_at FROM secret_deliveries').pipe(
			Effect.flatMap(rows => parse(mutableArray(deliveryRow), rows)),
			Effect.map(rows =>
				rows.map(row => ({ grantId: row.grant_id, version: row.version, state: row.state, updatedAt: row.updated_at }))
			),
		);
	}
	record(grantId: string, version: number, state: SyncState): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run(
				'INSERT INTO secret_deliveries(grant_id,version,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(grant_id,version) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at',
				grantId,
				version,
				state,
				clock.currentTimeMillisUnsafe(),
			).pipe(Effect.asVoid);
		});
	}
}
