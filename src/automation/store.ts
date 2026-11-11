import { Effect } from 'effect';
import { z } from 'zod';
import type { Listed } from '@/automation/execution-order';
import {
	executionOrderSql,
	listed,
	listOrder,
	newestActiveFirst,
	unfinishedStates,
	validJson,
} from '@/automation/execution-order';
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
import type { Access } from '@/domain/repository';
import { fromJson, fromSync, recover } from '@/failure';
import { record } from '@/model';
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
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

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
const executionRow = z.object({
	id: z.string(),
	repository_id: z.number(),
	state: z.string(),
	document: z.string(),
	created: z.number().nullable().catch(null),
});
type ExecutionRow = z.output<typeof executionRow>;
const executionColumns = `id, repository_id, state, document, ${validJson('$.createdAt')} AS created`;
function rowOrder(row: ExecutionRow): Listed {
	try {
		return listed(decodeExecutionV1(JSON.parse(row.document)));
	} catch {
		return {
			unfinished: unfinishedStates.some(state => state === row.state),
			createdAt: row.created ?? Number.NEGATIVE_INFINITY,
			id: row.id,
		};
	}
}
function rowState(row: ExecutionRow): string | undefined {
	try {
		return decodeExecutionV1(JSON.parse(row.document)).state;
	} catch {
		return undefined;
	}
}
function rankRows(rows: ExecutionRow[]): ExecutionRow[] {
	return rows.map(row => ({ row, order: rowOrder(row) })).sort((a, b) => listOrder(a.order, b.order)).map(entry =>
		entry.row
	);
}
const executionPage = 200;
// `decodeExecutionV1` reads a stored `blocked` row as unfinished only in these two cases.
const maybeUnfinishedSql = `(${validJson('$.operation')}='promote' AND ${validJson('$.attempts')}=0 AND ${
	validJson('$.approvedAt')
} IS NULL) OR ${validJson('$.runId')} IS NOT NULL`;
const legacyBlockedOutcomes: readonly string[] = ['blocked', 'awaiting-approval', 'verifying'];
export function readableValues<T>(entries: (Readable<T> | { kind: 'unreadable' })[]): T[] {
	return entries.flatMap(entry => entry.kind === 'readable' ? [entry.value] : []);
}
function readEach<R, T, U>(
	rows: R[],
	decode: (row: R) => T,
	unreadable: (row: R, error: string) => U,
): (Readable<T> | U)[] {
	return rows.map((row): Readable<T> | U => {
		try {
			return { kind: 'readable', value: decode(row) };
		} catch (error) {
			return unreadable(row, decodeError(error));
		}
	});
}
export function decodeError(error: unknown): string {
	if (error instanceof DomainError) return error.detail ?? error.message;
	if (error instanceof z.ZodError) return z.prettifyError(error);
	return error instanceof Error ? error.message : 'Unreadable document';
}

const onboardingRow = z.object({ repository_id: z.number(), document: z.string() });

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
	constructor(readonly db: SqlDatabase) {
		this.auditLog = new AuditStore(db);
		this.sql = sql(db);
	}
	repository(id: number): Effect.Effect<RepositoryRecord | undefined, DomainError> {
		return this.sql.first(`SELECT ${repositoryColumns} FROM repositories WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeRepository(repositoryRow.parse(row))) : Effect.undefined),
		);
	}
	private repositoryRows(): Effect.Effect<RepositoryRow[], DomainError> {
		return this.sql.all(
			`SELECT ${repositoryColumns} FROM repositories ORDER BY COALESCE(added_at, updated_at) DESC, name`,
		).pipe(Effect.flatMap(rows => parse(z.array(repositoryRow), rows)));
	}
	repositories(): Effect.Effect<RepositoryRecord[], DomainError> {
		return this.repositoryRows().pipe(Effect.flatMap(rows => fromSync(() => rows.map(decodeRepository))));
	}
	enrollment(id: number): Effect.Effect<Enrollment | undefined, DomainError> {
		return this.sql.first(`SELECT ${enrollmentColumns} FROM repositories WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeEnrollment(enrollmentRow.parse(row))) : Effect.undefined),
		);
	}
	enrollments(): Effect.Effect<Enrollment[], DomainError> {
		return this.sql.all(
			`SELECT ${enrollmentColumns} FROM repositories ORDER BY COALESCE(added_at, updated_at) DESC, name`,
		).pipe(Effect.flatMap(rows => fromSync(() => z.array(enrollmentRow).parse(rows).map(decodeEnrollment))));
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
			Effect.flatMap(rows => fromSync(() => z.array(onboardingRow).parse(rows))),
			Effect.flatMap(onboardingPulls),
		);
	}
	putRepository(repository: RepositoryRecord): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const document = yield* fromSync(() =>
				JSON.stringify(encodeRepository(identifyRepository(encodeRepository(repository))))
			);
			yield* this.sql.run(
				'INSERT INTO repositories(id,name,document,updated_at,added_at,access,suspended_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at',
				repository.id,
				repository.name,
				document,
				repository.updatedAt,
				repository.updatedAt,
				...encodeAccess(repository.access),
			);
		});
	}
	setAccess(id: number, access: Access): Effect.Effect<void, DomainError> {
		const [state, since] = encodeAccess(access);
		return this.sql.run(
			"UPDATE repositories SET access=?1, suspended_at=CASE WHEN ?1='active' THEN NULL WHEN access='suspended' THEN suspended_at ELSE ?2 END, document=CASE WHEN ?1='suspended' THEN json_set(document,'$.suspended',json('true')) ELSE json_remove(document,'$.suspended') END WHERE id=?3",
			state,
			since,
			id,
		).pipe(Effect.asVoid);
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
			Effect.flatMap(rows => parse(z.array(z.object({ id: z.string(), repository_id: z.number() })), rows)),
			Effect.map(rows => rows.map(row => ({ id: row.id, repositoryId: row.repository_id }))),
		);
	}
	private settledRows(conditions: string[], values: (string | number)[]): Effect.Effect<ExecutionRow[], DomainError> {
		return this.sql.all(
			`SELECT ${executionColumns} FROM executions WHERE ${
				[...conditions, "state<>'blocked'"].join(' AND ')
			} ORDER BY ${executionOrderSql} LIMIT ?`,
			...values,
			executionPage,
		).pipe(Effect.flatMap(rows => parse(z.array(executionRow), rows)));
	}
	private blockedRows(conditions: string[], values: (string | number)[]): Effect.Effect<ExecutionRow[], DomainError> {
		const rows = (unfinished: boolean) =>
			this.sql.all(
				`SELECT ${executionColumns} FROM executions WHERE ${
					[...conditions, "state='blocked'", `${unfinished ? '' : 'NOT '}COALESCE(${maybeUnfinishedSql}, 0)`].join(
						' AND ',
					)
				} ORDER BY ${executionOrderSql}${unfinished ? '' : ' LIMIT ?'}`,
				...values,
				...(unfinished ? [] : [executionPage]),
			).pipe(Effect.flatMap(found => parse(z.array(executionRow), found)));
		return Effect.all([rows(true), rows(false)]).pipe(Effect.map(([open, closed]) => [...open, ...closed]));
	}
	private executionRows(repositoryId?: number): Effect.Effect<ExecutionRow[], DomainError> {
		const conditions = repositoryId === undefined ? ['1=1'] : ['repository_id=?'];
		const values = repositoryId === undefined ? [] : [repositoryId];
		return Effect.gen({ self: this }, function*() {
			const settled = yield* this.settledRows(conditions, values);
			const blocked = yield* this.blockedRows(conditions, values);
			return rankRows([...settled, ...blocked]).slice(0, executionPage);
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
			const stored = wanted.some(state => legacyBlockedOutcomes.includes(state)) ? [...wanted, 'blocked'] : wanted;
			conditions.push(`state IN (${stored.map(() => '?').join(',')})`);
			values.push(...stored);
		}
		const limit = Math.min(filter.limit ?? 200, 200);
		return Effect.gen({ self: this }, function*() {
			const blocked = yield* this.blockedRows(conditions, values);
			const matching = wanted === undefined ? blocked : blocked.filter(row => {
				const state = rowState(row);
				return state !== undefined && wanted.includes(state);
			});
			const selected = rankRows([...(yield* this.settledRows(conditions, values)), ...matching]).slice(0, limit);
			const decoded = yield* fromSync(() => selected.map(row => decodeExecutionV1(JSON.parse(row.document))));
			return decoded.sort(newestActiveFirst);
		});
	}
	succeededExecutions(): Effect.Effect<Execution[], DomainError> {
		return this.sql.all(
			`SELECT ${executionColumns} FROM executions WHERE state='succeeded' ORDER BY ${executionOrderSql} LIMIT ?`,
			executionPage,
		).pipe(
			Effect.flatMap(rows => parse(z.array(executionRow), rows)),
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
	readExecutions(): Effect.Effect<(Readable<Execution> | UnreadableExecution)[], DomainError> {
		return this.executionRows().pipe(
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
			const serialized = JSON.stringify(event);
			yield* this.sql.batch([
				this.sql.statement(
					'INSERT OR IGNORE INTO release_events(id,document,created_at) VALUES(?,?,?)',
					event.id,
					serialized,
					Date.now(),
				),
				...deliveries.map(delivery =>
					this.sql.statement(
						"INSERT OR IGNORE INTO subscription_deliveries(id,event_id,repository_id,document,state,updated_at) SELECT ?,?,?,?,'pending',? WHERE EXISTS (SELECT 1 FROM release_events WHERE id=? AND document=?)",
						delivery.id,
						event.id,
						delivery.repositoryId,
						JSON.stringify(delivery),
						Date.now(),
						event.id,
						serialized,
					)
				),
			]);
			const saved = yield* parse(
				documentRow.nullable(),
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
		return this.sql.run(
			'UPDATE subscription_deliveries SET state=?,error=?,updated_at=? WHERE id=?',
			succeeded ? 'delivered' : 'pending',
			succeeded ? null : 'Delivery awaiting retry',
			Date.now(),
			id,
		).pipe(Effect.asVoid);
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
