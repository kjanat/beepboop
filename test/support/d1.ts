import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDatabase, SqlResult, SqlStatement } from '@/persistence/d1/database';

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

function transported(value: unknown): unknown {
	const parsed: unknown = JSON.parse(JSON.stringify(value));
	return parsed;
}

function rows(value: Record<string, unknown>[]): unknown[] {
	return value.map(transported);
}

export interface TestResult extends SqlResult {
	success: true;
	meta: D1Meta & Record<string, unknown>;
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

export class TestStatement implements SqlStatement {
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
	async first(): Promise<unknown> {
		const [row] = this.execute().rows;
		return row === undefined ? null : transported(row);
	}
	async run(): Promise<TestResult> {
		const result = this.execute();
		return { success: true, meta: meta(result.changes, result.lastRowId), results: rows(result.rows) };
	}
	async all(): Promise<TestResult> {
		return this.run();
	}
}

export class TestD1 implements SqlDatabase {
	readonly sqlite = new Database(':memory:', { strict: true });
	readonly queries: Query[] = [];
	failBatch: Error | undefined;
	failWrites: Error | undefined;
	constructor(migrations: readonly string[] = migrationFiles()) {
		this.sqlite.run('PRAGMA foreign_keys = ON');
		for (const file of migrations) this.sqlite.run(readFileSync(join(migrationsDirectory, file), 'utf8'));
	}
	execute(
		sql: string,
		values: SQLQueryBindings[],
	): { rows: Record<string, unknown>[]; changes: number; lastRowId: number } {
		const writes = !/^\s*(SELECT|WITH)\b/i.test(sql);
		if (writes && this.failWrites) throw this.failWrites;
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
	async batch(statements: SqlStatement[]): Promise<TestResult[]> {
		if (this.failBatch) throw this.failBatch;
		const results: TestResult[] = [];
		const executed = statements.map(statement => {
			if (!(statement instanceof TestStatement)) throw new TypeError('TestD1 batches only its own statements');
			return statement;
		});
		this.sqlite.transaction(() => {
			for (const statement of executed) {
				const result = statement.execute();
				results.push({ success: true, meta: meta(result.changes, result.lastRowId), results: rows(result.rows) });
			}
		})();
		return results;
	}
	reset(): void {
		this.queries.length = 0;
	}
}
