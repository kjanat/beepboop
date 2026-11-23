import { Cache, Clock, Context, DateTime, Duration, Effect, Equal, Exit, Hash, Option, Schema } from 'effect';
import { signJwt } from 'micro509/jose';
import { importPkcs8Pem } from 'micro509/keys';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { accessTokenSchema, appSchema, installationSchema, repositorySchema, userSchema } from '@/github/resources.ts';
import { GitHubTransport } from '@/github/transport.ts';
import { fromPromise, toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { decode } from '@/kernel/schema/result.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray } from '@/kernel/schema/structs.ts';

export interface AppCredentials {
	readonly GITHUB_APP_ID: string;
	readonly GITHUB_APP_PRIVATE_KEY: string;
}

export type Permissions = Readonly<Record<string, 'read' | 'write'>>;

export interface BotIdentity {
	login: string;
	id: number;
	email: string;
}

export type InstallationState = 'active' | 'suspended' | 'uninstalled';

export const missingInstallationPermissions = 'GitHub App installation lacks required permissions';

const tokenMargin = 5 * 60_000;
const tokenLifetime = 60 * 60_000;
const identityLifetime = Duration.hours(1);
const installationsPerPage = 100;

const expiryTimestamp = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/));
const decodeExpiry = Schema.decodeUnknownOption(expiryTimestamp);

class TokenKey implements Equal.Equal {
	readonly canonical: string;
	readonly permissions: Permissions;
	constructor(
		readonly installation: number,
		readonly name: string,
		readonly id: number | undefined,
		permissions: Permissions,
	) {
		const entries = Object.entries(permissions).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
		this.permissions = Object.freeze(Object.fromEntries(entries));
		const granted = entries.map(([scope, level]) => `${scope}:${level}`);
		this.canonical = JSON.stringify([installation, name, id ?? null, granted]);
	}
	[Equal.symbol](that: Equal.Equal): boolean {
		return that instanceof TokenKey && that.canonical === this.canonical;
	}
	[Hash.symbol](): number {
		return Hash.string(this.canonical);
	}
}

interface IssuedToken {
	readonly token: string;
	readonly lifetime: Duration.Duration;
}

export class GitHubApp extends Context.Service<GitHubApp, {
	readonly appPage: Effect.Effect<string, DomainError, GitHubTransport>;
	readonly botIdentity: Effect.Effect<BotIdentity, DomainError, GitHubTransport>;
	readonly ownerLogin: Effect.Effect<string, DomainError, GitHubTransport>;
	readonly installation: (name: string) => Effect.Effect<InstallationState, DomainError, GitHubTransport>;
	readonly installationToken: (
		name: string,
		id: number | undefined,
		permissions: Permissions,
	) => Effect.Effect<string, DomainError, GitHubTransport>;
	readonly mintToken: (
		name: string,
		id: number | undefined,
		permissions: Permissions,
	) => Effect.Effect<string, DomainError, GitHubTransport>;
	readonly rejected: (token: string) => Effect.Effect<void>;
}>()('beepboopbot/github/GitHubApp') {}

// Workers keep module state for the lifetime of the isolate.
interface IsolateApp {
	readonly privateKey: string;
	readonly app: GitHubApp['Service'];
}
const isolateApps = new WeakMap<Fetcher, Map<string, IsolateApp>>();

export function isolateGitHubApp(
	transport: Fetcher,
	credentials: AppCredentials,
	ownerId: number,
): GitHubApp['Service'] {
	const apps = isolateApps.get(transport) ?? new Map<string, IsolateApp>();
	isolateApps.set(transport, apps);
	const key = `${ownerId}:${credentials.GITHUB_APP_ID}`;
	const known = apps.get(key);
	if (known && known.privateKey === credentials.GITHUB_APP_PRIVATE_KEY) return known.app;
	const app = Effect.runSync(makeGitHubApp(credentials, ownerId));
	apps.set(key, { privateKey: credentials.GITHUB_APP_PRIVATE_KEY, app });
	return app;
}

function read<S extends Contract>(
	schema: S,
	path: string,
	token: string,
	method?: string,
	body?: unknown,
): Effect.Effect<Decoded<S>, DomainError, GitHubTransport> {
	return GitHubTransport.use(github => github.call(path, token, method, body)).pipe(
		Effect.flatMap(value => Effect.fromResult(decode(schema, value))),
	);
}

function remembered<Key, A, E, R>(
	cache: Cache.Cache<Key, A, E, R>,
	key: Key,
	compute: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
	return Cache.getSuccess(cache, key).pipe(Effect.flatMap(Option.match({
		onSome: Effect.succeed,
		onNone: () => compute.pipe(Effect.tap(value => Cache.set(cache, key, value))),
	})));
}

export const makeGitHubApp = Effect.fnUntraced(function*(credentials: AppCredentials, ownerId: number) {
	/** JWT for the configured App, never the workflow's GITHUB_TOKEN. */
	const appToken = Effect.gen(function*() {
		const clock = yield* Clock.Clock;

		const imported = yield* fromPromise(() =>
			importPkcs8Pem(credentials.GITHUB_APP_PRIVATE_KEY, { kind: 'rsa', hash: 'SHA-256' })
		);
		if (!imported.ok) return yield* toDomainError(new Error(imported.message));
		const now = Math.floor(clock.currentTimeMillisUnsafe() / 1000);
		return yield* fromPromise(() =>
			signJwt({
				privateKey: imported.value,
				algorithm: 'RS256',
				claims: { iss: credentials.GITHUB_APP_ID, iat: now - 60, exp: now + 9 * 60 },
			})
		);
	});

	const appPage = Effect.gen(function*() {
		const { slug } = yield* read(appSchema, '/app', yield* appToken);
		return `https://github.com/apps/${encodeURIComponent(slug)}`;
	});

	const ownerInstallation = (jwt: string) =>
		Effect.gen(function*() {
			for (let page = 1;; page++) {
				const installations = yield* read(
					mutableArray(installationSchema),
					`/app/installations?per_page=${installationsPerPage}&page=${page}`,
					jwt,
				);
				const installation = installations.find(installation => installation.account.id === ownerId);
				if (installation) return installation;
				if (installations.length < installationsPerPage) {
					return yield* precondition('The GitHub App is not installed on the owner account');
				}
			}
		});

	const authorize = (name: string, permissions: Permissions) =>
		Effect.gen(function*() {
			if (!repositoryNamePattern.test(name)) return yield* precondition('Invalid repository');
			const jwt = yield* appToken;
			const installation = yield* read(installationSchema, `/repos/${name}/installation`, jwt);
			if (installation.account.id !== ownerId) {
				return yield* precondition('Owner mismatch');
			}
			if (installation.permissions) {
				const missing = Object.entries(permissions).filter(([name, level]) =>
					installation.permissions?.[name] !== 'write' && installation.permissions?.[name] !== level
				).map(([name, level]) => `${name}: ${level}`);
				if (missing.length) {
					return yield* precondition(
						`${missingInstallationPermissions} (${
							missing.join(', ')
						}). Update permissions for ${yield* appPage} and approve the installation update before retrying`,
					);
				}
			}
			return { installation: installation.id, suspended: Boolean(installation.suspended_at) };
		});

	const issue = (key: TokenKey) =>
		Effect.gen(function*() {
			const { name, id, permissions } = key;
			const issued = yield* read(
				accessTokenSchema,
				`/app/installations/${key.installation}/access_tokens`,
				yield* appToken,
				'POST',
				{
					...(id === undefined ? { repositories: [name.split('/')[1]] } : { repository_ids: [id] }),
					permissions,
				},
			);
			const repository = yield* read(repositorySchema, `/repos/${name}`, issued.token);
			if (
				(id !== undefined && repository.id !== id)
				|| repository.full_name !== name
				|| repository.owner.id !== ownerId
			) {
				return yield* precondition('Repository mismatch');
			}
			const now = yield* Clock.currentTimeMillis;
			const remaining = decodeExpiry(issued.expires_at).pipe(
				Option.flatMap(DateTime.make),
				Option.map(expiry => Math.min(DateTime.toEpochMillis(expiry) - now, tokenLifetime) - tokenMargin),
				Option.getOrElse(() => 0),
			);
			const lifetime = remaining > 0 ? Duration.millis(remaining) : Duration.zero;
			return { token: issued.token, lifetime } satisfies IssuedToken;
		});

	const token = (name: string, id: number | undefined, permissions: Permissions, reuse: boolean) =>
		authorize(name, permissions).pipe(
			Effect.flatMap(({ installation, suspended }) => {
				const key = new TokenKey(installation, name, id, permissions);
				if (suspended) return evict(cached => cached.installation === installation).pipe(Effect.andThen(issue(key)));
				return reuse && id !== undefined ? remembered(tokens, key, issue(key)) : issue(key);
			}),
			Effect.map(issued => issued.token),
		);

	const evict = (matches: (key: TokenKey, issued: IssuedToken) => boolean) =>
		Cache.entries(tokens).pipe(
			Effect.flatMap(entries =>
				Effect.forEach(
					Array.from(entries).filter(([key, issued]) => matches(key, issued)),
					([key]) => Cache.invalidate(tokens, key),
					{ discard: true },
				)
			),
		);

	const tokens = yield* Cache.makeWith(issue, {
		capacity: 1024,
		requireServicesAt: 'lookup',
		timeToLive: exit => Exit.isSuccess(exit) ? exit.value.lifetime : Duration.zero,
	});

	const rejected = (token: string) => evict((_, issued) => issued.token === token);

	const ownerLogin = Effect.gen(function*() {
		return (yield* ownerInstallation(yield* appToken)).account.login;
	});

	const botIdentity = Effect.gen(function*() {
		const jwt = yield* appToken;
		const { slug } = yield* read(appSchema, '/app', jwt);
		if (!/^[a-z0-9-]+$/.test(slug)) return yield* precondition('Invalid App slug');
		const login = `${slug}[bot]`;
		const installation = yield* ownerInstallation(jwt);
		const { token } = yield* read(
			accessTokenSchema,
			`/app/installations/${installation.id}/access_tokens`,
			jwt,
			'POST',
			{ permissions: { metadata: 'read' } },
		);
		const user = yield* read(userSchema, `/users/${encodeURIComponent(login)}`, token);
		if (user.login !== login || user.type !== 'Bot') return yield* precondition('App bot identity mismatch');
		const id = user.id;
		return { login, id, email: `${id}+${login}@users.noreply.github.com` } satisfies BotIdentity;
	});

	const bounded = (exit: Exit.Exit<unknown, unknown>) => Exit.isSuccess(exit) ? identityLifetime : Duration.zero;
	const owners = yield* Cache.makeWith((_: number) => ownerLogin, {
		capacity: 1,
		requireServicesAt: 'lookup',
		timeToLive: bounded,
	});
	const bots = yield* Cache.makeWith((_: string) => botIdentity, {
		capacity: 1,
		requireServicesAt: 'lookup',
		timeToLive: bounded,
	});

	return GitHubApp.of({
		appPage,
		botIdentity: remembered(bots, credentials.GITHUB_APP_ID, botIdentity),
		ownerLogin: remembered(owners, ownerId, ownerLogin),
		installation: name =>
			Effect.gen(function*() {
				if (!repositoryNamePattern.test(name)) return yield* precondition('Invalid repository');
				const jwt = yield* appToken;
				const found = yield* GitHubTransport.use(github => github.call(`/repos/${name}/installation`, jwt));
				if (found === null) return 'uninstalled';
				const installation = yield* Effect.fromResult(decode(installationSchema, found));
				if (installation.account.id !== ownerId) return yield* precondition('Owner mismatch');
				return installation.suspended_at ? 'suspended' : 'active';
			}),
		installationToken: (name, id, permissions) => token(name, id, permissions, true),
		mintToken: (name, id, permissions) => token(name, id, permissions, false),
		rejected,
	});
});
