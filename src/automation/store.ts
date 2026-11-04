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
import type { Access } from '@/domain/repository';
import { record } from '@/model';
import {
	decodeRepository,
	encodeAccess,
	type RepositoryRow,
	repositoryColumns,
	repositoryRow,
} from '@/persistence/codecs/repository';
import { decodeDeliveryV1, decodeEventV1, decodeExecutionV1 } from '@/persistence/codecs/v1';
import { AuditStore } from '@/persistence/d1/audit';
import type { SqlDatabase } from '@/persistence/d1/database';

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
	if (error instanceof z.ZodError) return z.prettifyError(error);
	return error instanceof Error ? error.message : 'Unreadable document';
}

const onboardingRow = z.object({ repository_id: z.number(), document: z.string() });

export function onboardingPulls(rows: { repository_id: number; document: string }[]): Map<number, string> {
	const pulls = new Map<number, string>();
	for (const row of rows) {
		const url = record(JSON.parse(row.document)).url;
		if (typeof url === 'string') pulls.set(row.repository_id, url);
	}
	return pulls;
}

export class Store {
	private readonly auditLog: AuditStore;
	constructor(readonly db: SqlDatabase) {
		this.auditLog = new AuditStore(db);
	}
	async repository(id: number): Promise<RepositoryRecord | undefined> {
		const row = await this.db
			.prepare(`SELECT ${repositoryColumns} FROM repositories WHERE id=?`)
			.bind(id)
			.first();
		return row ? decodeRepository(repositoryRow.parse(row)) : undefined;
	}
	private async repositoryRows(): Promise<RepositoryRow[]> {
		const result = await this.db
			.prepare(
				`SELECT ${repositoryColumns} FROM repositories ORDER BY COALESCE(added_at, updated_at) DESC, name`,
			)
			.all();
		return z.array(repositoryRow).parse(result.results);
	}
	async repositories(): Promise<RepositoryRecord[]> {
		return (await this.repositoryRows()).map(decodeRepository);
	}
	async readRepositories(): Promise<(Readable<RepositoryRecord> | UnreadableRepository)[]> {
		return (await this.repositoryRows()).map(row => {
			try {
				return { kind: 'readable', value: decodeRepository(row) };
			} catch (error) {
				return { kind: 'unreadable', id: row.id, name: row.name, error: decodeError(error) };
			}
		});
	}
	async onboardingPulls(): Promise<Map<number, string>> {
		const result = await this.db.prepare('SELECT repository_id, document FROM onboarding').all();
		return onboardingPulls(z.array(onboardingRow).parse(result.results));
	}
	async putRepository(repository: RepositoryRecord): Promise<void> {
		await this.db
			.prepare(
				'INSERT INTO repositories(id,name,document,updated_at,added_at,access,suspended_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at',
			)
			.bind(
				repository.id,
				repository.name,
				JSON.stringify(encodeRepository(identifyRepository(encodeRepository(repository)))),
				repository.updatedAt,
				repository.updatedAt,
				...encodeAccess(repository.access),
			)
			.run();
	}
	async setAccess(id: number, access: Access): Promise<void> {
		const [state, since] = encodeAccess(access);
		await this.db
			.prepare(
				"UPDATE repositories SET access=?1, suspended_at=CASE WHEN ?1='active' THEN NULL WHEN access='suspended' THEN suspended_at ELSE ?2 END, document=CASE WHEN ?1='suspended' THEN json_set(document,'$.suspended',json('true')) ELSE json_remove(document,'$.suspended') END WHERE id=?3",
			)
			.bind(state, since, id)
			.run();
	}
	async execution(id: string): Promise<Execution | undefined> {
		const row = await this.db
			.prepare('SELECT document FROM executions WHERE id=?')
			.bind(id)
			.first();
		return row ? decodeExecutionV1(rowDocument(row)) : undefined;
	}
	private async executionRows(repositoryId?: number): Promise<z.output<typeof executionRow>[]> {
		const query = repositoryId === undefined
			? this.db.prepare('SELECT id, repository_id, document FROM executions ORDER BY updated_at DESC LIMIT 200')
			: this.db
				.prepare(
					'SELECT id, repository_id, document FROM executions WHERE repository_id=? ORDER BY updated_at DESC LIMIT 200',
				)
				.bind(repositoryId);
		return z.array(executionRow).parse((await query.all()).results);
	}
	async executions(repositoryId?: number): Promise<Execution[]> {
		return (await this.executionRows(repositoryId)).map(row => decodeExecutionV1(JSON.parse(row.document)));
	}
	async readExecutions(): Promise<(Readable<Execution> | UnreadableExecution)[]> {
		return (await this.executionRows()).map(row => {
			try {
				return { kind: 'readable', value: decodeExecutionV1(JSON.parse(row.document)) };
			} catch (error) {
				return { kind: 'unreadable', id: row.id, repositoryId: row.repository_id, error: decodeError(error) };
			}
		});
	}
	async event(id: string): Promise<AutomationEvent | undefined> {
		const row = await this.db.prepare('SELECT document FROM release_events WHERE id=?').bind(id).first();
		return row ? decodeEventV1(rowDocument(row)) : undefined;
	}
	async queueEvent(event: AutomationEvent, deliveries: SubscriptionDelivery[]): Promise<void> {
		const serialized = JSON.stringify(event);
		await this.db.batch([
			this.db.prepare('INSERT OR IGNORE INTO release_events(id,document,created_at) VALUES(?,?,?)').bind(
				event.id,
				serialized,
				Date.now(),
			),
			...deliveries.map(delivery =>
				this.db.prepare(
					"INSERT OR IGNORE INTO subscription_deliveries(id,event_id,repository_id,document,state,updated_at) SELECT ?,?,?,?,'pending',? WHERE EXISTS (SELECT 1 FROM release_events WHERE id=? AND document=?)",
				)
					.bind(
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
		const saved = documentRow.nullable().parse(
			await this.db.prepare('SELECT document FROM release_events WHERE id=?').bind(event.id).first(),
		);
		if (saved?.document !== serialized) throw new Error('Event identity changed');
	}
	async pendingDeliveries(): Promise<SubscriptionDelivery[]> {
		const rows = await this.db.prepare(
			"SELECT document FROM subscription_deliveries WHERE state='pending' ORDER BY updated_at,id LIMIT 100",
		).all();
		return rows.results.map(row => decodeDeliveryV1(rowDocument(row)));
	}
	async deliveryResult(id: string, succeeded: boolean): Promise<void> {
		await this.db.prepare('UPDATE subscription_deliveries SET state=?,error=?,updated_at=? WHERE id=?')
			.bind(succeeded ? 'delivered' : 'pending', succeeded ? null : 'Delivery awaiting retry', Date.now(), id).run();
	}
	activity(): Promise<ActivityEntry[]> {
		return this.auditLog.recent();
	}
	audit(actor: string, action: string, target: string): Promise<void> {
		return this.auditLog.record(actor, action, target);
	}
}
