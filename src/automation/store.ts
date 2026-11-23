import { Effect, Schema } from 'effect';
import { executionOrderSql, newestActiveFirst, validJson } from '@/automation/execution-order';
import type { ActivityEntry, Execution } from '@/automation/types';
import type { ExecutionFilter } from '@/contract/routes';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import type { Access, RepositoryDiscovery } from '@/domain/repository';
import { fromJson, fromSync, recover } from '@/kernel/errors/classify.ts';
import type { Readable } from '@/kernel/errors/decoding.ts';
import { decodeError, isDecodingFailure, readEach } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { record } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Enrollment, RepositoryRow } from '@/persistence/codecs/repository';
import {
	decodeEnrollment,
	decodeRepository,
	encodeAccess,
	enrollmentColumns,
	enrollmentRow,
	repositoryColumns,
	repositoryRow,
} from '@/persistence/codecs/repository';
import { encodeRepository, identifyRepository } from '@/persistence/codecs/stored';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { AuditStore } from '@/persistence/d1/audit';
import { backfillPage, drainBackfill } from '@/persistence/d1/backfill-page';
import type { CompletionCandidate } from '@/persistence/d1/completions';
import { CompletionStore } from '@/persistence/d1/completions';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';
import { rowDocument } from '@/persistence/d1/document-row';
import { GateSkipStore } from '@/persistence/d1/gate-skips';
import { jsonBatches } from '@/persistence/d1/json-batches';
import { readyRead } from '@/persistence/d1/ready-read';

export interface UnreadableRepository {
	kind: 'unreadable';
	id: number;
	name: string;
	error: string;
}
export interface UnreadableExecution {
	kind: 'unreadable';
	id: string;
	repositoryId: number;
	error: string;
}
const executionRow = mutableStruct({
	id: Schema.String,
	repository_id: Schema.Finite,
	state: Schema.String,
	document: Schema.String,
	created: Schema.NullOr(Schema.Finite).pipe(Schema.catchDecoding(() => Effect.succeedSome(null))),
});
type ExecutionRow = Decoded<typeof executionRow>;
function discoveryDocument(discovery: RepositoryDiscovery): Effect.Effect<string, DomainError> {
	const repository = { ...discovery, access: { kind: 'active' as const } };
	return fromSync(() => JSON.stringify(encodeRepository(identifyRepository(encodeRepository(repository)))));
}
const executionColumns = `id, repository_id, state, document, ${validJson('$.createdAt')} AS created`;
const executionPage = 200;

export function readableValues<T>(entries: (Readable<T> | { kind: 'unreadable' })[]): T[] {
	return entries.flatMap(entry => entry.kind === 'readable' ? [entry.value] : []);
}
const onboardingRow = mutableStruct({ repository_id: Schema.Finite, document: Schema.String });

export function onboardingPulls(
	rows: { repository_id: number; document: string }[],
): Effect.Effect<Map<number, string>, DomainError> {
	return Effect.gen(function*() {
		const pulls = new Map<number, string>();
		for (const row of rows) {
			const { url } = yield* Effect.fromResult(record(yield* fromJson(row.document)));
			if (typeof url === 'string') pulls.set(row.repository_id, url);
		}
		return pulls;
	});
}

export class Store {
	private readonly auditLog: AuditStore;
	readonly gateSkips: GateSkipStore;
	private readonly sql: Sql;
	constructor(readonly db: SqlDatabase | Sql) {
		this.auditLog = new AuditStore(db);
		this.gateSkips = new GateSkipStore(db);
		this.sql = sql(db);
	}
	repository(id: number): Effect.Effect<RepositoryRecord | undefined, DomainError> {
		return this.sql.first(`SELECT ${repositoryColumns} FROM repositories WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeRepository(decodeSync(repositoryRow, row))) : Effect.undefined),
		);
	}
	private repositoryRows(): Effect.Effect<RepositoryRow[], DomainError> {
		return this.sql.all(
			`SELECT ${repositoryColumns} FROM repositories ORDER BY COALESCE(added_at, updated_at) DESC, name`,
		).pipe(Effect.flatMap(rows => parse(mutableArray(repositoryRow), rows)));
	}
	repositories(): Effect.Effect<RepositoryRecord[], DomainError> {
		return this.repositoryRows().pipe(Effect.flatMap(rows => fromSync(() => rows.map(decodeRepository))));
	}
	enrollment(id: number): Effect.Effect<Enrollment | undefined, DomainError> {
		return this.sql.first(`SELECT ${enrollmentColumns} FROM repositories WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeEnrollment(decodeSync(enrollmentRow, row))) : Effect.undefined),
		);
	}
	enrollments(): Effect.Effect<Enrollment[], DomainError> {
		return this.sql.all(
			`SELECT ${enrollmentColumns} FROM repositories ORDER BY COALESCE(added_at, updated_at) DESC, name`,
		).pipe(Effect.flatMap(rows => fromSync(() => decodeSync(mutableArray(enrollmentRow), rows).map(decodeEnrollment))));
	}
	readableRepositories(): Effect.Effect<RepositoryRecord[], DomainError> {
		return this.readRepositories().pipe(
			Effect.map(readableValues),
		);
	}
	readRepositories(): Effect.Effect<(Readable<RepositoryRecord> | UnreadableRepository)[], DomainError> {
		return this.repositoryRows().pipe(
			Effect.map(rows =>
				readEach(rows, decodeRepository, (row, error): UnreadableRepository => ({
					kind: 'unreadable',
					id: row.id,
					name: row.name,
					error,
				}))
			),
		);
	}
	onboardingPulls(): Effect.Effect<Map<number, string>, DomainError> {
		return this.sql.all('SELECT repository_id, document FROM onboarding').pipe(
			Effect.flatMap(rows => fromSync(() => decodeSync(mutableArray(onboardingRow), rows))),
			Effect.flatMap(onboardingPulls),
		);
	}
	saveDiscovery(
		discovery: RepositoryDiscovery,
	): Effect.Effect<{ repository: RepositoryRecord; document: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const document = yield* discoveryDocument(discovery);
			const row = yield* this.sql.first(
				`INSERT INTO repositories(id,name,document,updated_at,added_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at RETURNING ${repositoryColumns}`,
				discovery.id,
				discovery.name,
				document,
				discovery.updatedAt,
				discovery.updatedAt,
			);
			return { repository: yield* fromSync(() => decodeRepository(decodeSync(repositoryRow, row))), document };
		});
	}
	replaceDiscovery(document: string, discovery: RepositoryDiscovery): Effect.Effect<void, DomainError> {
		return discoveryDocument(discovery).pipe(
			Effect.flatMap(next =>
				this.sql.run('UPDATE repositories SET document=? WHERE id=? AND document=?', next, discovery.id, document)
			),
			Effect.asVoid,
		);
	}
	setAccess(id: number, access: Access): Effect.Effect<boolean, DomainError> {
		const [state, since] = encodeAccess(access);
		return this.sql.run(
			"UPDATE repositories SET access=?1, suspended_at=CASE WHEN ?1='active' THEN NULL WHEN access='suspended' THEN suspended_at ELSE ?2 END WHERE id=?3 AND access<>?1",
			state,
			since,
			id,
		).pipe(Effect.map(result => result.meta.changes > 0));
	}
	completionEvidence(visible: readonly CompletionCandidate[]) {
		return new CompletionStore(this.sql).evidence(visible);
	}

	execution(id: string): Effect.Effect<Execution | undefined, DomainError> {
		return this.document('executions', id, decodeExecutionV1);
	}
	executionsStarting(prefix: string): Effect.Effect<{ id: string; repositoryId: number }[], DomainError> {
		return this.sql.all(
			'SELECT id, repository_id FROM executions WHERE id>=?1 AND id<?2 ORDER BY id LIMIT 2',
			prefix,
			`${prefix}g`,
		).pipe(
			Effect.flatMap(rows =>
				parse(mutableArray(mutableStruct({ id: Schema.String, repository_id: Schema.Finite })), rows)
			),
			Effect.map(rows => rows.map(row => ({ id: row.id, repositoryId: row.repository_id }))),
		);
	}
	private normalizeExecutions(limit = 10, scope = '', values: (string | number)[] = []) {
		return Effect.gen({ self: this }, function*() {
			const rows = yield* this.sql.all(
				backfillPage('executions', `${executionColumns},revision`, 'state_version IS NULL', scope),
				...values,
				limit,
			).pipe(
				Effect.flatMap(rows =>
					parse(mutableArray(mutableStruct({ ...executionRow.fields, revision: Schema.NullOr(Schema.Finite) })), rows)
				),
			);
			if (!rows.length) return { selected: 0, changed: 0 };
			let changed = 0;
			const normalized = rows.map(row => {
				let state = row.state;
				try {
					state = decodeExecutionV1(JSON.parse(row.document)).state;
				} catch (error) {
					if (!isDecodingFailure(error)) throw error;
				}
				return { id: row.id, state, document: row.document, revision: row.revision };
			});
			for (const batch of jsonBatches(normalized)) {
				if ('row' in batch) {
					const row = batch.row;
					changed += (yield* this.sql.all(
						'UPDATE executions SET state=?,state_version=1,state_revision=? WHERE id=? AND document=? AND revision IS ? AND state_version IS NULL RETURNING id',
						row.state,
						row.revision,
						row.id,
						row.document,
						row.revision,
					)).length;
				} else {
					changed += (yield* this.sql.all(
						`UPDATE executions SET state=normalized.state,state_version=1,state_revision=normalized.revision
        FROM (SELECT json_extract(value,'$.id') AS id,
         json_extract(value,'$.state') AS state,json_extract(value,'$.document') AS document,json_extract(value,'$.revision') AS revision FROM json_each(?)) AS normalized
        WHERE executions.id=normalized.id AND executions.document=normalized.document AND executions.revision IS normalized.revision AND executions.state_version IS NULL RETURNING id`,
						batch.json,
					)).length;
				}
			}
			return { selected: rows.length, changed };
		});
	}
	backfillExecutions(): Effect.Effect<number, DomainError> {
		return drainBackfill(() => this.normalizeExecutions(100));
	}

	private executionRows(repositoryId?: number): Effect.Effect<ExecutionRow[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* this.normalizeExecutions(
				10,
				repositoryId === undefined ? '' : 'AND repository_id=?',
				repositoryId === undefined ? [] : [repositoryId],
			);
			return yield* readyRead(
				this.sql,
				{
					query: `SELECT id FROM executions WHERE state_version IS NULL ${
						repositoryId === undefined ? '' : 'AND repository_id=?'
					} LIMIT 1`,
					values: repositoryId === undefined ? [] : [repositoryId],
				},
				{
					query: `SELECT ${executionColumns} FROM executions ${
						repositoryId === undefined ? '' : 'WHERE repository_id=?'
					} ORDER BY ${executionOrderSql} LIMIT ?`,
					values: [...(repositoryId === undefined ? [] : [repositoryId]), executionPage],
				},
				'Execution history maintenance is pending; run the database migration command before retrying',
			).pipe(Effect.flatMap(rows => parse(mutableArray(executionRow), rows)));
		});
	}
	executions(repositoryId?: number): Effect.Effect<Execution[], DomainError> {
		return this.executionRows(repositoryId).pipe(
			Effect.flatMap(rows => fromSync(() => rows.map(row => decodeExecutionV1(JSON.parse(row.document))))),
			Effect.map(decoded => decoded.sort(newestActiveFirst)),
		);
	}
	filteredExecutions(filter: ExecutionFilter): Effect.Effect<Execution[], DomainError> {
		const conditions: string[] = ['1=1'], values: (string | number)[] = [];
		if (filter.repository !== undefined) {
			conditions.push('repository_id IN (SELECT id FROM repositories WHERE LOWER(name)=LOWER(?))');
			values.push(filter.repository);
		}
		for (
			const [column, value] of [
				['stream', filter.stream],
				['operation', filter.operation],
				['version', filter.version],
			] as const
		) {
			if (value === undefined) continue;
			conditions.push(`${validJson(`$.${column}`)}=?`);
			values.push(value);
		}
		const wanted = filter.states?.split(',');
		if (wanted !== undefined) {
			const stored = wanted;
			conditions.push(`state IN (${stored.map(() => '?').join(',')})`);
			values.push(...stored);
		}
		const limit = Math.min(filter.limit ?? 200, 200);
		return Effect.gen({ self: this }, function*() {
			yield* this.normalizeExecutions(
				10,
				filter.repository === undefined
					? ''
					: 'AND repository_id IN (SELECT id FROM repositories WHERE LOWER(name)=LOWER(?))',
				filter.repository === undefined ? [] : [filter.repository],
			);
			const selected = yield* readyRead(
				this.sql,
				{
					query: `SELECT id FROM executions WHERE state_version IS NULL ${
						filter.repository === undefined
							? ''
							: 'AND repository_id IN (SELECT id FROM repositories WHERE LOWER(name)=LOWER(?))'
					} LIMIT 1`,
					values: filter.repository === undefined ? [] : [filter.repository],
				},
				{
					query: `SELECT ${executionColumns} FROM executions WHERE ${
						conditions.join(' AND ')
					} ORDER BY ${executionOrderSql} LIMIT ?`,
					values: [...values, limit],
				},
				'Execution history maintenance is pending; run the database migration command before retrying',
			).pipe(Effect.flatMap(rows => parse(mutableArray(executionRow), rows)));
			const decoded = yield* fromSync(() => selected.map(row => decodeExecutionV1(JSON.parse(row.document))));
			return decoded.sort(newestActiveFirst);
		});
	}
	succeededExecutions(): Effect.Effect<Execution[], DomainError> {
		return this.sql.all(
			`SELECT ${executionColumns} FROM executions WHERE state='succeeded' ORDER BY ${executionOrderSql} LIMIT ?`,
			executionPage,
		).pipe(
			Effect.flatMap(rows => parse(mutableArray(executionRow), rows)),
			Effect.map(rows =>
				readableValues(
					readEach(
						rows,
						row => decodeExecutionV1(JSON.parse(row.document)),
						(): { kind: 'unreadable' } => ({ kind: 'unreadable' }),
					),
				)
					.sort(newestActiveFirst)
			),
		);
	}
	readExecutions(repositoryId?: number): Effect.Effect<(Readable<Execution> | UnreadableExecution)[], DomainError> {
		return this.executionRows(repositoryId).pipe(
			Effect.map(rows => {
				const entries = readEach(
					rows,
					row => decodeExecutionV1(JSON.parse(row.document)),
					(row, error): UnreadableExecution => ({
						kind: 'unreadable',
						id: row.id,
						repositoryId: row.repository_id,
						error,
					}),
				);
				return [
					...readableValues(entries).sort(newestActiveFirst).map((value): Readable<Execution> => ({
						kind: 'readable',
						value,
					})),
					...entries.flatMap(entry => entry.kind === 'unreadable' ? [entry] : []),
				];
			}),
		);
	}
	private document<T>(
		table: 'executions',
		id: string,
		decode: (value: unknown) => T,
	): Effect.Effect<T | undefined, DomainError> {
		return this.sql.first(`SELECT document FROM ${table} WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decode(rowDocument(row))) : Effect.undefined),
		);
	}
	activity(): Effect.Effect<ActivityEntry[], DomainError> {
		return this.auditLog.recent();
	}
	audit(actor: string, action: string, target: string): Effect.Effect<void, DomainError> {
		return this.auditLog.record(actor, action, target);
	}
	auditFailure(actor: string, action: string, name: string) {
		return recover(error => this.audit(actor, action, `${name}: ${decodeError(error)}`));
	}
}
