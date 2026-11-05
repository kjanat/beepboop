import { Effect } from 'effect';
import type { ProjectedEntity } from '@/contract/changes';
import type { DomainError } from '@/contract/errors';
import { type SqlDatabase, type SqlStatement, sql } from '@/persistence/d1/database';

interface Common {
	id: string;
	repositoryId: number;
	revision: number;
	document: string;
	updatedAt: number;
}
export type Projection =
	| (Common & { entity: 'execution'; state: string })
	| (Common & { entity: Exclude<ProjectedEntity, 'execution'> });

const tables = {
	execution: 'executions',
	'release-set': 'release_sets',
	release: 'releases',
} as const satisfies Record<ProjectedEntity, string>;

export class ProjectionStore {
	constructor(private readonly db: SqlDatabase) {}
	private upsert(row: Projection): SqlStatement {
		if (row.entity === 'execution') {
			return this.db.prepare(
				'INSERT INTO executions(id,repository_id,state,document,updated_at,revision) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET repository_id=excluded.repository_id,state=excluded.state,document=excluded.document,updated_at=excluded.updated_at,revision=excluded.revision WHERE executions.revision IS NULL OR excluded.revision>executions.revision',
			).bind(row.id, row.repositoryId, row.state, row.document, row.updatedAt, row.revision);
		}
		const table = tables[row.entity];
		return this.db.prepare(
			`INSERT INTO ${table}(id,repository_id,revision,document,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET repository_id=excluded.repository_id,revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at WHERE excluded.revision>${table}.revision`,
		).bind(row.id, row.repositoryId, row.revision, row.document, row.updatedAt);
	}
	private change(row: Projection, at: number): SqlStatement {
		return this.db.prepare(
			`INSERT INTO changes(repository_id,entity,id,revision,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ${
				tables[row.entity]
			} WHERE id=? AND revision=?)`,
		).bind(row.repositoryId, row.entity, row.id, row.revision, at, row.id, row.revision);
	}
	apply(rows: readonly Projection[]): Effect.Effect<void, DomainError> {
		if (!rows.length) return Effect.void;
		const at = Date.now();
		return sql(this.db).batch(rows.flatMap(row => [this.upsert(row), this.change(row, at)])).pipe(Effect.asVoid);
	}
}
