import type { Execution, RepositoryRecord } from './types.ts';

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
	async audit(actor: string, action: string, target: string): Promise<void> {
		await this.db
			.prepare('INSERT INTO audit VALUES(?,?,?,?,?)')
			.bind(crypto.randomUUID(), actor, action, target, Date.now())
			.run();
	}
}
