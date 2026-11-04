export interface SqlResult {
	results: unknown[];
	meta: { changes: number };
}

export interface SqlStatement {
	bind(...values: unknown[]): SqlStatement;
	first(): Promise<unknown>;
	run(): Promise<SqlResult>;
	all(): Promise<SqlResult>;
}

export interface SqlDatabase {
	prepare(query: string): SqlStatement;
	batch(statements: SqlStatement[]): Promise<unknown[]>;
}
