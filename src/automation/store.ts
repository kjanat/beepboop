import { Clock, Effect, Schema } from 'effect';
import { executionOrderSql, newestActiveFirst, validJson } from '@/automation/execution-order';
import { encodeRepository, identifyRepository } from '@/automation/package-identity';
import { documentRow, rowDocument } from '@/automation/schemas';
import type {
	ActivityEntry,
	AutomationEvent,
	Execution,
	RepositoryRecord,
	SubscriptionDelivery,
} from '@/automation/types';
import { DomainError, precondition } from '@/contract/errors';
import type { ExecutionFilter } from '@/contract/routes';
import type { Access, RepositoryDiscovery } from '@/domain/repository';
import { fromJson, fromSync, recover } from '@/failure';
import { record } from '@/model';
import { InvalidPackageUrl } from '@/package-url';
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
import { decodeDeliveryV1, decodeEventV1, decodeExecutionV1 } from '@/persistence/codecs/v1';
import { AuditStore } from '@/persistence/d1/audit';
import type { CompletionCandidate } from '@/persistence/d1/completions';
import { CompletionStore } from '@/persistence/d1/completions';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';
import { jsonBatches } from '@/persistence/d1/json-batches';
import type { Decoded } from '@/schema';
import { decodeSync, mutableArray, mutableStruct } from '@/schema';

export type Readable<T> = { kind: 'readable'; value: T };
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
const executionColumns = `id, repository_id, state, document, ${validJson('$.createdAt')} AS created`;
const executionPage = 200;

export function readableValues<T>(entries: (Readable<T> | { kind: 'unreadable' })[]): T[] {
	return entries.flatMap(entry => entry.kind === 'readable' ? [entry.value] : []);
}
export function readEach<R, T, U>(
	rows: R[],
	decode: (row: R) => T,
	unreadable: (row: R, error: string) => U,
): (Readable<T> | U)[] {
	return rows.map((row): Readable<T> | U => {
		try {
			return { kind: 'readable', value: decode(row) };
		} catch (error) {
			if (!isDecodingFailure(error)) throw error;
			return unreadable(row, decodeError(error));
		}
	});
}
export function isDecodingFailure(error: unknown): boolean {
	return error instanceof Schema.SchemaError || error instanceof SyntaxError || error instanceof InvalidPackageUrl
		|| (error instanceof DomainError && (error.problem.code === 'invalid' || error.problem.code === 'precondition'));
}
export function decodeError(error: unknown): string {
	if (error instanceof DomainError) return error.detail ?? error.message;
	if (error instanceof Schema.SchemaError) return error.message;
	return error instanceof Error ? error.message : 'Unreadable document';
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
	private readonly sql: Sql;
	constructor(readonly db: SqlDatabase | Sql) {
		this.auditLog = new AuditStore(db);
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
	saveDiscovery(discovery: RepositoryDiscovery): Effect.Effect<RepositoryRecord, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const repository = { ...discovery, access: { kind: 'active' as const } };
			const document = yield* fromSync(() =>
				JSON.stringify(encodeRepository(identifyRepository(encodeRepository(repository))))
			);
			const row = yield* this.sql.first(
				`INSERT INTO repositories(id,name,document,updated_at,added_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at RETURNING ${repositoryColumns}`,
				repository.id,
				repository.name,
				document,
				repository.updatedAt,
				repository.updatedAt,
			);
			return yield* fromSync(() => decodeRepository(decodeSync(repositoryRow, row)));
		});
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
	private normalizeExecutions(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			while (true) {
				const rows = yield* this.sql.all(
					`SELECT ${executionColumns} FROM executions WHERE state_version IS NULL LIMIT 100`,
				).pipe(Effect.flatMap(rows => parse(mutableArray(executionRow), rows)));
				if (!rows.length) return;
				const normalized = rows.map(row => {
					let state = row.state;
					try {
						state = decodeExecutionV1(JSON.parse(row.document)).state;
					} catch (error) {
						if (!isDecodingFailure(error)) throw error;
					}
					return { id: row.id, state, document: row.document };
				});
				for (const batch of jsonBatches(normalized)) {
					if ('row' in batch) {
						const row = batch.row;
						yield* this.sql.run(
							'UPDATE executions SET state=?,state_version=1 WHERE id=? AND document=? AND state_version IS NULL',
							row.state,
							row.id,
							row.document,
						);
					} else {
						yield* this.sql.run(
							`UPDATE executions SET state=normalized.state,state_version=1
        FROM (SELECT json_extract(value,'$.id') AS id,
         json_extract(value,'$.state') AS state,json_extract(value,'$.document') AS document FROM json_each(?)) AS normalized
        WHERE executions.id=normalized.id AND executions.document=normalized.document AND executions.state_version IS NULL`,
							batch.json,
						);
					}
				}
			}
		});
	}
	private executionRows(repositoryId?: number): Effect.Effect<ExecutionRow[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* this.normalizeExecutions();
			return yield* this.sql.all(
				`SELECT ${executionColumns} FROM executions ${
					repositoryId === undefined ? '' : 'WHERE repository_id=?'
				} ORDER BY ${executionOrderSql} LIMIT ?`,
				...(repositoryId === undefined ? [] : [repositoryId]),
				executionPage,
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
			yield* this.normalizeExecutions();
			const selected = yield* this.sql.all(
				`SELECT ${executionColumns} FROM executions WHERE ${
					conditions.join(' AND ')
				} ORDER BY ${executionOrderSql} LIMIT ?`,
				...values,
				limit,
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
	event(id: string): Effect.Effect<AutomationEvent | undefined, DomainError> {
		return this.document('release_events', id, decodeEventV1);
	}
	private document<T>(
		table: 'executions' | 'release_events',
		id: string,
		decode: (value: unknown) => T,
	): Effect.Effect<T | undefined, DomainError> {
		return this.sql.first(`SELECT document FROM ${table} WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decode(rowDocument(row))) : Effect.undefined),
		);
	}
	queueEvent(event: AutomationEvent, deliveries: SubscriptionDelivery[]): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const serialized = JSON.stringify(event);
			yield* this.sql.batch([
				this.sql.statement(
					'INSERT OR IGNORE INTO release_events(id,document,created_at) VALUES(?,?,?)',
					event.id,
					serialized,
					clock.currentTimeMillisUnsafe(),
				),
				...deliveries.map(delivery =>
					this.sql.statement(
						"INSERT OR IGNORE INTO subscription_deliveries(id,event_id,repository_id,document,state,updated_at) SELECT ?,?,?,?,'pending',? WHERE EXISTS (SELECT 1 FROM release_events WHERE id=? AND document=?)",
						delivery.id,
						event.id,
						delivery.repositoryId,
						JSON.stringify(delivery),
						clock.currentTimeMillisUnsafe(),
						event.id,
						serialized,
					)
				),
			]);
			const saved = yield* parse(
				Schema.NullOr(documentRow),
				yield* this.sql.first('SELECT document FROM release_events WHERE id=?', event.id),
			);
			if (saved?.document !== serialized) return yield* precondition('Event identity changed');
		});
	}
	pendingDeliveries(): Effect.Effect<SubscriptionDelivery[], DomainError> {
		return this.sql.all(
			"SELECT document FROM subscription_deliveries WHERE state='pending' ORDER BY updated_at,id LIMIT 100",
		).pipe(Effect.flatMap(rows => fromSync(() => rows.map(row => decodeDeliveryV1(rowDocument(row))))));
	}
	deliveryResult(id: string, succeeded: boolean): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run(
				'UPDATE subscription_deliveries SET state=?,error=?,updated_at=? WHERE id=?',
				succeeded ? 'delivered' : 'pending',
				succeeded ? null : 'Delivery awaiting retry',
				clock.currentTimeMillisUnsafe(),
				id,
			).pipe(Effect.asVoid);
		});
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
