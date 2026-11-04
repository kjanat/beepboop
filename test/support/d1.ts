import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const migrationsDirectory = join(import.meta.dir, '../../migrations');

export function migrationFiles(): string[] {
	return readdirSync(migrationsDirectory).filter(file => file.endsWith('.sql')).sort();
}

export interface Query {
	sql: string;
	values: SQLQueryBindings[];
	writes: boolean;
}

function binding(value: unknown): SQLQueryBindings {
	if (value === null || typeof value === 'string' || typeof value === 'number') return value;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (value instanceof Uint8Array) return value;
	throw new TypeError(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`);
}

function transported(value: unknown): ReturnType<typeof JSON.parse> {
	return JSON.parse(JSON.stringify(value));
}

function meta(changes: number, lastRowId: number): D1Meta & Record<string, unknown> {
	return {
		duration: 0,
		size_after: 0,
		rows_read: 0,
		rows_written: changes,
		last_row_id: lastRowId,
		changed_db: changes > 0,
		changes,
	};
}

export class TestStatement {
	constructor(
		private readonly database: TestD1,
		readonly sql: string,
		readonly values: readonly SQLQueryBindings[] = [],
	) {}
	bind(...values: unknown[]): TestStatement {
		return new TestStatement(this.database, this.sql, values.map(binding));
	}
	execute(): { rows: Record<string, unknown>[]; changes: number; lastRowId: number } {
		return this.database.execute(this.sql, [...this.values]);
	}
	async first<T>(column?: string): Promise<T | null> {
		const [row] = this.execute().rows;
		if (row === undefined) return null;
		return transported(column === undefined ? row : (row[column] ?? null));
	}
	async run<T>(): Promise<D1Result<T>> {
		const result = this.execute();
		return { success: true, meta: meta(result.changes, result.lastRowId), results: transported(result.rows) };
	}
	async all<T>(): Promise<D1Result<T>> {
		return this.run<T>();
	}
	async raw(): Promise<never> {
		throw new Error('D1 raw() is not used by Beepboop');
	}
}

export class TestD1 {
	readonly sqlite = new Database(':memory:', { strict: true });
	readonly queries: Query[] = [];
	failBatch: Error | undefined;
	constructor(migrations: readonly string[] = migrationFiles()) {
		this.sqlite.run('PRAGMA foreign_keys = ON');
		for (const file of migrations) this.sqlite.run(readFileSync(join(migrationsDirectory, file), 'utf8'));
	}
	execute(
		sql: string,
		values: SQLQueryBindings[],
	): { rows: Record<string, unknown>[]; changes: number; lastRowId: number } {
		const writes = !/^\s*(SELECT|WITH)\b/i.test(sql);
		this.queries.push({ sql, values, writes });
		const statement = this.sqlite.prepare<Record<string, unknown>, SQLQueryBindings[]>(sql);
		const rows = statement.all(...values).map(row => ({ ...row }));
		if (!writes) return { rows, changes: 0, lastRowId: 0 };
		const changes = this.sqlite.query('SELECT changes() AS changes, last_insert_rowid() AS id').get();
		return {
			rows,
			changes: Number(Reflect.get(changes ?? {}, 'changes') ?? 0),
			lastRowId: Number(Reflect.get(changes ?? {}, 'id') ?? 0),
		};
	}
	prepare(query: string): TestStatement {
		return new TestStatement(this, query);
	}
	async batch<T>(statements: TestStatement[]): Promise<D1Result<T>[]> {
		if (this.failBatch) throw this.failBatch;
		const results: D1Result<T>[] = [];
		this.sqlite.transaction(() => {
			for (const statement of statements) {
				const result = statement.execute();
				results.push({
					success: true,
					meta: meta(result.changes, result.lastRowId),
					results: transported(result.rows),
				});
			}
		})();
		return results;
	}
	async exec(query: string): Promise<D1ExecResult> {
		this.queries.push({ sql: query, values: [], writes: true });
		this.sqlite.run(query);
		return { count: query.split(';').filter(part => part.trim()).length, duration: 0 };
	}
	withSession(): never {
		throw new Error('D1 sessions are not used by Beepboop');
	}
	async dump(): Promise<never> {
		throw new Error('D1 dump() is not used by Beepboop');
	}
	reset(): void {
		this.queries.length = 0;
	}
}
