import { Effect } from 'effect';
import { z } from 'zod';
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
import type { Access } from '@/domain/repository';
import { fromJson, fromSync } from '@/failure';
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
const executionRow = z.object({ id: z.string(), repository_id: z.number(), document: z.string() });
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
			Effect.map(entries => entries.flatMap(entry => entry.kind === 'readable' ? [entry.value] : [])),
		);
	}
	readRepositories(): Effect.Effect<(Readable<RepositoryRecord> | UnreadableRepository)[], DomainError> {
		return this.repositoryRows().pipe(
			Effect.map(rows =>
				rows.map((row): Readable<RepositoryRecord> | UnreadableRepository => {
					try {
						return { kind: 'readable', value: decodeRepository(row) };
					} catch (error) {
						return { kind: 'unreadable', id: row.id, name: row.name, error: decodeError(error) };
					}
				})
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
		return this.sql.first('SELECT document FROM executions WHERE id=?', id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeExecutionV1(rowDocument(row))) : Effect.undefined),
		);
	}
	private executionRows(repositoryId?: number): Effect.Effect<z.output<typeof executionRow>[], DomainError> {
		const rows = repositoryId === undefined
			? this.sql.all('SELECT id, repository_id, document FROM executions ORDER BY updated_at DESC LIMIT 200')
			: this.sql.all(
				'SELECT id, repository_id, document FROM executions WHERE repository_id=? ORDER BY updated_at DESC LIMIT 200',
				repositoryId,
			);
		return rows.pipe(Effect.flatMap(rows => parse(z.array(executionRow), rows)));
	}
	executions(repositoryId?: number): Effect.Effect<Execution[], DomainError> {
		return this.executionRows(repositoryId).pipe(
			Effect.flatMap(rows => fromSync(() => rows.map(row => decodeExecutionV1(JSON.parse(row.document))))),
		);
	}
	readExecutions(): Effect.Effect<(Readable<Execution> | UnreadableExecution)[], DomainError> {
		return this.executionRows().pipe(Effect.map(rows =>
			rows.map((row): Readable<Execution> | UnreadableExecution => {
				try {
					return { kind: 'readable', value: decodeExecutionV1(JSON.parse(row.document)) };
				} catch (error) {
					return { kind: 'unreadable', id: row.id, repositoryId: row.repository_id, error: decodeError(error) };
				}
			})
		));
	}
	event(id: string): Effect.Effect<AutomationEvent | undefined, DomainError> {
		return this.sql.first('SELECT document FROM release_events WHERE id=?', id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeEventV1(rowDocument(row))) : Effect.undefined),
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
}
