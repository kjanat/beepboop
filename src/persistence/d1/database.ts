import { Context, Effect, Layer } from 'effect';
import type { DomainError } from '@/contract/errors';
import { parseWith } from '@/decode';
import { fromPromise, fromSync } from '@/failure';

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

export interface Sql {
	readonly statement: (query: string, ...values: unknown[]) => SqlStatement;
	readonly first: (query: string, ...values: unknown[]) => Effect.Effect<unknown, DomainError>;
	readonly all: (query: string, ...values: unknown[]) => Effect.Effect<unknown[], DomainError>;
	readonly run: (query: string, ...values: unknown[]) => Effect.Effect<SqlResult, DomainError>;
	readonly batch: (statements: SqlStatement[]) => Effect.Effect<unknown[], DomainError>;
}

export function sql(db: SqlDatabase): Sql {
	const statement = (query: string, ...values: unknown[]) =>
		values.length ? db.prepare(query).bind(...values) : db.prepare(query);
	return {
		statement,
		first: (query, ...values) => fromPromise(() => statement(query, ...values).first()),
		all: (query, ...values) =>
			fromPromise(() => statement(query, ...values).all()).pipe(Effect.map(result => result.results)),
		run: (query, ...values) => fromPromise(() => statement(query, ...values).run()),
		batch: statements => fromPromise(() => db.batch(statements)),
	};
}

export const parse = parseWith(fromSync);

export class Database extends Context.Service<Database, Sql>()('beepboop/Database') {}

export function databaseLayer(db: SqlDatabase): Layer.Layer<Database> {
	return Layer.succeed(Database, sql(db));
}
