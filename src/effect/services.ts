import { Context, Effect, Layer } from 'effect';
import type { RepositoryGateway } from '@/automation/github';
import type { Fetcher } from '@/automation/managers/registry';
import type { Vault } from '@/automation/vault';
import { attempt, type Failure } from '@/effect/errors';
import type { SqlDatabase, SqlResult } from '@/persistence/d1/database';

export class GitHub extends Context.Service<GitHub, {
	readonly call: (path: string, token: string, method?: string, body?: unknown) => Effect.Effect<unknown, Failure>;
}>()('beepboop/GitHub') {}

export class Registry extends Context.Service<Registry, {
	readonly fetch: (url: string, init?: RequestInit) => Effect.Effect<Response, Failure>;
}>()('beepboop/Registry') {}

export class Database extends Context.Service<Database, {
	readonly first: (query: string, values: readonly unknown[]) => Effect.Effect<unknown, Failure>;
	readonly all: (query: string, values: readonly unknown[]) => Effect.Effect<unknown[], Failure>;
	readonly run: (query: string, values: readonly unknown[]) => Effect.Effect<SqlResult, Failure>;
}>()('beepboop/Database') {}

export class Secrets extends Context.Service<Secrets, {
	readonly reveal: (alias: string, actor: string) => Effect.Effect<string, Failure>;
}>()('beepboop/Secrets') {}

export function gitHubLayer(gateway: Pick<RepositoryGateway, 'call'>): Layer.Layer<GitHub> {
	return Layer.succeed(GitHub, {
		call: (path, token, method, body) => attempt(() => gateway.call(path, token, method, body)),
	});
}

export function registryLayer(transport: Fetcher): Layer.Layer<Registry> {
	return Layer.succeed(Registry, {
		fetch: (url, init) => attempt(() => transport(url, init ?? {})),
	});
}

export function databaseLayer(db: SqlDatabase): Layer.Layer<Database> {
	const statement = (query: string, values: readonly unknown[]) => db.prepare(query).bind(...values);
	return Layer.succeed(Database, {
		first: (query, values) => attempt(() => statement(query, values).first()),
		all: (query, values) => attempt(() => statement(query, values).all()).pipe(Effect.map(result => result.results)),
		run: (query, values) => attempt(() => statement(query, values).run()),
	});
}

export function secretsLayer(vault: Pick<Vault, 'reveal'>): Layer.Layer<Secrets> {
	return Layer.succeed(Secrets, {
		reveal: (alias, actor) =>
			attempt(() => vault.reveal(alias, actor)).pipe(Effect.map(credential => credential.value)),
	});
}
