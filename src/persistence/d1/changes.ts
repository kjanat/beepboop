import { Effect, Schema } from 'effect';
import type { ChangesResponse } from '@/contract/changes';
import { change } from '@/contract/changes';
import type { DomainError } from '@/contract/errors';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';
import { decodeSync, mapped, mutableArray, mutableStruct } from '@/schema';

const page = 500;
const changeRow = mapped(
	mutableStruct({
		seq: Schema.Finite,
		repository_id: Schema.Finite,
		entity: change.fields.entity,
		id: Schema.String,
		revision: Schema.Finite,
	}),
	({ repository_id, ...row }) => decodeSync(change, { ...row, repositoryId: repository_id }),
);

export class ChangeLog {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	since(cursor: number, repositoryId?: number): Effect.Effect<ChangesResponse, DomainError> {
		const rows = repositoryId === undefined
			? this.sql.all(
				'SELECT seq,repository_id,entity,id,revision FROM changes WHERE seq>? ORDER BY seq LIMIT ?',
				cursor,
				page,
			)
			: this.sql.all(
				'SELECT seq,repository_id,entity,id,revision FROM changes WHERE seq>? AND repository_id=? ORDER BY seq LIMIT ?',
				cursor,
				repositoryId,
				page,
			);
		return rows.pipe(
			Effect.flatMap(rows => parse(mutableArray(changeRow), rows)),
			Effect.map(changes => ({ cursor: changes.at(-1)?.seq ?? cursor, changes })),
		);
	}
	prune(before: number): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM changes WHERE created_at<?', before).pipe(Effect.asVoid);
	}
}
