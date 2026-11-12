import { Context, Effect, Layer } from 'effect';
import type { DomainError } from '@/contract/errors';
import { parseWith } from '@/decode';
import { fromPromise, toDomainError } from '@/failure';
import type { Contract, Decoded } from '@/schema';

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

export function sql(db: SqlDatabase | Sql): Sql {
	if ('statement' in db) return db;
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

export const parse = parseWith(toDomainError);

export function optionalColumn<S extends Contract, T>(
	schema: S,
	pick: (row: Decoded<S>) => T,
): (row: unknown) => Effect.Effect<T | undefined, DomainError> {
	return row => row === null ? Effect.undefined : parse(schema, row).pipe(Effect.map(pick));
}

export function replaceDocument(
	db: Sql,
	table: string,
	key: string,
	id: unknown,
	previous: string,
	next: unknown,
): Effect.Effect<SqlResult, DomainError> {
	return db.run(`UPDATE ${table} SET document=? WHERE ${key}=? AND document=?`, JSON.stringify(next), id, previous);
}

export function upsertDocument(
	db: Sql,
	table: string,
	key: string,
	columns: Record<string, unknown>,
	document: unknown,
): Effect.Effect<void, DomainError> {
	const names = [...Object.keys(columns), 'document'];
	const updates = names.filter(name => name !== key).map(name => `${name}=excluded.${name}`);
	return db.run(
		`INSERT INTO ${table}(${names.join(',')}) VALUES(${
			names.map(() => '?').join(',')
		}) ON CONFLICT(${key}) DO UPDATE SET ${updates.join(',')}`,
		...Object.values(columns),
		JSON.stringify(document),
	).pipe(Effect.asVoid);
}

export class Database extends Context.Service<Database, Sql>()('beepboop/Database') {}

export function databaseLayer(db: SqlDatabase): Layer.Layer<Database> {
	return Layer.succeed(Database, sql(db));
}
