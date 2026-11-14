import { Effect } from 'effect';
import { isDecodingFailure } from '@/automation/store';
import type { ProjectedEntity } from '@/contract/changes';
import type { DomainError } from '@/contract/errors';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { completionMetadata } from '@/persistence/d1/completions';
import type { Sql, SqlDatabase, SqlStatement } from '@/persistence/d1/database';
import { sql } from '@/persistence/d1/database';

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
	private readonly db: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.db = sql(db);
	}
	private upsert(row: Projection): SqlStatement {
		if (row.entity === 'execution') {
			let state = row.state;
			try {
				state = decodeExecutionV1(JSON.parse(row.document)).state;
			} catch (error) {
				if (!isDecodingFailure(error)) throw error;
			}
			return this.db.statement(
				'INSERT INTO executions(id,repository_id,state,document,updated_at,revision,state_version) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET repository_id=excluded.repository_id,state=excluded.state,state_version=1,document=excluded.document,updated_at=excluded.updated_at,revision=excluded.revision WHERE executions.revision IS NULL OR excluded.revision>executions.revision',
			).bind(
				row.id,
				row.repositoryId,
				state,
				row.document,
				row.updatedAt,
				row.revision,
			);
		}
		if (row.entity === 'release') {
			const meta = completionMetadata(row.document, row.repositoryId);
			return this.db.statement(
				`INSERT INTO releases(id,repository_id,revision,document,updated_at,completion_format,
     completion_stream,completion_group,completion_release_version,completion_sort,completion_at)
     VALUES(?,?,?,?,?,1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
     repository_id=excluded.repository_id,revision=excluded.revision,document=excluded.document,
     updated_at=MIN(releases.updated_at,excluded.updated_at),completion_format=1,
     completion_stream=excluded.completion_stream,completion_group=excluded.completion_group,
     completion_release_version=excluded.completion_release_version,completion_sort=excluded.completion_sort,
     completion_at=CASE WHEN excluded.completion_sort IS NULL THEN NULL ELSE COALESCE(?,MIN(releases.updated_at,excluded.updated_at)) END
     WHERE excluded.revision>releases.revision`,
			).bind(
				row.id,
				row.repositoryId,
				row.revision,
				row.document,
				row.updatedAt,
				meta?.stream ?? null,
				meta?.group ?? null,
				meta?.version ?? null,
				meta?.sort ?? null,
				meta ? meta.at ?? row.updatedAt : null,
				meta?.at ?? null,
			);
		}
		const table = tables[row.entity];
		return this.db.statement(
			`INSERT INTO ${table}(id,repository_id,revision,document,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET repository_id=excluded.repository_id,revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at WHERE excluded.revision>${table}.revision`,
		).bind(row.id, row.repositoryId, row.revision, row.document, row.updatedAt);
	}
	private change(row: Projection, at: number): SqlStatement {
		return this.db.statement(
			`INSERT INTO changes(repository_id,entity,id,revision,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ${
				tables[row.entity]
			} WHERE id=? AND revision=?)`,
		).bind(row.repositoryId, row.entity, row.id, row.revision, at, row.id, row.revision);
	}
	apply(rows: readonly Projection[]): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			if (!rows.length) return Effect.void;
			const at = clock.currentTimeMillisUnsafe();
			return this.db.batch(rows.flatMap(row => [this.upsert(row), this.change(row, at)])).pipe(Effect.asVoid);
		});
	}
}
