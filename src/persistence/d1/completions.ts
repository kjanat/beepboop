import { Effect, Schema } from 'effect';
import { isDecodingFailure } from '@/automation/store';
import type { Execution } from '@/automation/types';
import { precedenceKey } from '@/contract/semver';
import { decodeEventV1 } from '@/persistence/codecs/v1';
import type { Sql } from '@/persistence/d1/database';
import { parse } from '@/persistence/d1/database';
import { jsonBatches } from '@/persistence/d1/json-batches';
import { mutableArray, mutableStruct } from '@/schema';

export function completionMetadata(document: string, repositoryId: number) {
	try {
		const event = decodeEventV1(JSON.parse(document));
		if (event.event !== 'release' || !event.release || event.release.repository.id !== repositoryId) return undefined;
		const sort = precedenceKey(event.release.version);
		if (!sort) return undefined;
		return {
			stream: event.release.stream,
			group: event.release.group ?? null,
			version: event.release.version,
			sort,
			at: event.occurredAt ?? null,
		};
	} catch (error) {
		if (!isDecodingFailure(error)) throw error;
		return undefined;
	}
}

const legacyRow = mutableStruct({
	id: Schema.String,
	repository_id: Schema.Finite,
	document: Schema.String,
	updated_at: Schema.Finite,
});
const proofRow = mutableStruct({
	repository_id: Schema.Finite,
	completion_stream: Schema.String,
	completion_group: Schema.NullOr(Schema.String),
	completion_release_version: Schema.String,
	completion_at: Schema.Finite,
});

export type CompletionCandidate = Pick<Execution, 'repositoryId' | 'stream' | 'state' | 'version' | 'updatedAt'> & {
	releaseSet?: { group?: string };
};

export class CompletionStore {
	constructor(private readonly sql: Sql) {}
	private normalize(repositoryIds: number[]) {
		return Effect.gen({ self: this }, function*() {
			while (true) {
				const rows = yield* this.sql.all(
					'SELECT id,repository_id,document,updated_at FROM releases WHERE completion_format IS NULL AND repository_id IN (SELECT value FROM json_each(?)) LIMIT 100',
					JSON.stringify(repositoryIds),
				).pipe(Effect.flatMap(rows => parse(mutableArray(legacyRow), rows)));
				if (!rows.length) return;
				// Revisions and documents stay authoritative. A concurrently replaced row is normalized on the next pass.
				const entries = rows.map(row => ({
					...row,
					metadata: completionMetadata(row.document, row.repository_id) ?? null,
				}));
				for (const batch of jsonBatches(entries)) {
					if ('json' in batch) {
						yield* this.sql.run(
							`UPDATE releases SET completion_format=1,
        completion_stream=json_extract(normalized.value,'$.metadata.stream'),
        completion_group=json_extract(normalized.value,'$.metadata.group'),
        completion_release_version=json_extract(normalized.value,'$.metadata.version'),
        completion_sort=json_extract(normalized.value,'$.metadata.sort'),
        completion_at=CASE WHEN json_extract(normalized.value,'$.metadata') IS NULL THEN NULL
         ELSE COALESCE(json_extract(normalized.value,'$.metadata.at'),json_extract(normalized.value,'$.updated_at')) END
        FROM json_each(?) AS normalized
        WHERE releases.id=json_extract(normalized.value,'$.id') AND releases.document=json_extract(normalized.value,'$.document')
         AND releases.updated_at=json_extract(normalized.value,'$.updated_at') AND releases.completion_format IS NULL`,
							batch.json,
						);
						continue;
					}
					const entry = batch.row, meta = entry.metadata;
					yield* this.sql.run(
						`UPDATE releases SET completion_format=1,completion_stream=?,completion_group=?,completion_release_version=?,completion_sort=?,completion_at=?
       WHERE id=? AND document=? AND updated_at=? AND completion_format IS NULL`,
						meta?.stream ?? null,
						meta?.group ?? null,
						meta?.version ?? null,
						meta?.sort ?? null,
						meta ? meta.at ?? entry.updated_at : null,
						entry.id,
						entry.document,
						entry.updated_at,
					);
				}
			}
		});
	}
	evidence(visible: readonly CompletionCandidate[]) {
		const candidates = visible.filter(run => run.state === 'failed' || run.state === 'cancelled').map(run => ({
			repositoryId: run.repositoryId,
			stream: run.stream,
			group: run.releaseSet?.group ?? null,
			sort: precedenceKey(run.version ?? '') ?? '',
			after: run.updatedAt,
		}));
		if (!candidates.length) return Effect.succeed([]);
		return Effect.gen({ self: this }, function*() {
			yield* this.normalize([...new Set(candidates.map(candidate => candidate.repositoryId))]);
			// Frontier timestamps strictly decrease as versions increase. Its first version above the candidate
			// is therefore the newest possible qualifying proof; test time after the bounded seek.
			const rows = yield* this.sql.all(
				`SELECT DISTINCT r.repository_id,r.completion_stream,r.completion_group,r.completion_release_version,r.completion_at
     FROM json_each(?) AS candidate JOIN releases AS r ON r.id=(
      SELECT proof.id FROM release_completion_frontier AS proof
      WHERE proof.repository_id=json_extract(candidate.value,'$.repositoryId')
       AND proof.completion_stream=json_extract(candidate.value,'$.stream')
       AND proof.completion_group IS json_extract(candidate.value,'$.group')
       AND proof.completion_sort>json_extract(candidate.value,'$.sort')
      ORDER BY proof.completion_sort LIMIT 1)
     WHERE r.completion_at>json_extract(candidate.value,'$.after')`,
				JSON.stringify(candidates),
			).pipe(Effect.flatMap(rows => parse(mutableArray(proofRow), rows)));
			return rows.map(row => ({
				repositoryId: row.repository_id,
				stream: row.completion_stream,
				...(row.completion_group === null ? {} : { group: row.completion_group }),
				version: row.completion_release_version,
				completedAt: row.completion_at,
			}));
		});
	}
}
