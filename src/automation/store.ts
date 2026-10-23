import type { AutomationEvent, Execution, RepositoryRecord, SubscriptionDelivery } from './types.ts';

export class Store {
	constructor(readonly db: D1Database) {}
	async repository(id: number): Promise<RepositoryRecord | undefined> {
		const row = await this.db
			.prepare('SELECT document FROM repositories WHERE id=?')
			.bind(id)
			.first<{ document: string }>();
		return row ? JSON.parse(row.document) : undefined;
	}
	async repositories(): Promise<RepositoryRecord[]> {
		const result = await this.db
			.prepare('SELECT document FROM repositories ORDER BY name')
			.all<{ document: string }>();
		return result.results.map((row) => JSON.parse(row.document));
	}
	async putRepository(repository: RepositoryRecord): Promise<void> {
		await this.db
			.prepare(
				'INSERT INTO repositories(id,name,document,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at',
			)
			.bind(repository.id, repository.name, JSON.stringify(repository), repository.updatedAt)
			.run();
	}
	async execution(id: string): Promise<Execution | undefined> {
		const row = await this.db
			.prepare('SELECT document FROM executions WHERE id=?')
			.bind(id)
			.first<{ document: string }>();
		return row ? JSON.parse(row.document) : undefined;
	}
	async executions(repositoryId?: number): Promise<Execution[]> {
		const query = repositoryId === undefined
			? this.db.prepare('SELECT document FROM executions ORDER BY updated_at DESC LIMIT 200')
			: this.db
				.prepare(
					'SELECT document FROM executions WHERE repository_id=? ORDER BY updated_at DESC LIMIT 200',
				)
				.bind(repositoryId);
		return (await query.all<{ document: string }>()).results.map((row) => JSON.parse(row.document));
	}
	async putExecution(execution: Execution): Promise<void> {
		await this.db
			.prepare(
				'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,document=excluded.document,updated_at=excluded.updated_at',
			)
			.bind(
				execution.id,
				execution.repositoryId,
				execution.state,
				JSON.stringify(execution),
				execution.updatedAt,
			)
			.run();
	}
	async event(id: string): Promise<AutomationEvent | undefined> {
		const row = await this.db.prepare('SELECT document FROM release_events WHERE id=?').bind(id).first<
			{ document: string }
		>();
		return row ? JSON.parse(row.document) : undefined;
	}
	async queueEvent(event: AutomationEvent, deliveries: SubscriptionDelivery[]): Promise<void> {
		const serialized = JSON.stringify(event);
		await this.db.batch([
			this.db.prepare('INSERT OR IGNORE INTO release_events VALUES(?,?,?)').bind(event.id, serialized, Date.now()),
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
		const saved = await this.db.prepare('SELECT document FROM release_events WHERE id=?').bind(event.id).first<
			{ document: string }
		>();
		if (saved?.document !== serialized) throw new Error('Event identity changed');
	}
	async pendingDeliveries(): Promise<SubscriptionDelivery[]> {
		const rows = await this.db.prepare(
			"SELECT document FROM subscription_deliveries WHERE state='pending' ORDER BY updated_at,id LIMIT 100",
		).all<{ document: string }>();
		return rows.results.map(row => JSON.parse(row.document));
	}
	async deliveryResult(id: string, succeeded: boolean): Promise<void> {
		await this.db.prepare('UPDATE subscription_deliveries SET state=?,error=?,updated_at=? WHERE id=?')
			.bind(succeeded ? 'delivered' : 'pending', succeeded ? null : 'Delivery awaiting retry', Date.now(), id).run();
	}
	async audit(actor: string, action: string, target: string): Promise<void> {
		await this.db
			.prepare('INSERT INTO audit VALUES(?,?,?,?,?)')
			.bind(crypto.randomUUID(), actor, action, target, Date.now())
			.run();
	}
}
