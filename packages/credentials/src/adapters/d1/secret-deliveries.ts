import { Effect, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

const deliveryRow = mutableStruct({
	grant_id: Schema.String,
	version: Schema.Finite,
	state: Schema.String,
	updated_at: Schema.Finite,
});

export type CredentialDeliveryRow = Decoded<typeof deliveryRow>;

export class SecretDeliveryStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	list(): Effect.Effect<CredentialDeliveryRow[], DomainError> {
		return this.sql.all('SELECT grant_id,version,state,updated_at FROM secret_deliveries').pipe(
			Effect.flatMap(rows => parse(mutableArray(deliveryRow), rows)),
		);
	}
	record(grantId: string, version: number, state: string): Effect.Effect<void, DomainError> {
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
