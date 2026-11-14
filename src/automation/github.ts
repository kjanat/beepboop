import { Clock, Context, Data, Effect, Exit, Layer, Schema } from 'effect';
import { importPKCS8, SignJWT } from 'jose';
import { logRecovered } from '@/automation/failure-log';
import type { GitObject } from '@/automation/github-resources';
import {
	accessTokenSchema,
	appSchema,
	commitSchema,
	comparisonSchema,
	contentSchema,
	createdSchema,
	gitCommitSchema,
	gitRefSchema,
	gitTagSchema,
	installationSchema,
	issueEventSchema,
	matchingRefSchema,
	namedSchema,
	pullSchema,
	repositorySchema,
	ruleSchema,
	treeSchema,
	userSchema,
	workflowRunSchema,
} from '@/automation/github-resources';
import type { Fetcher, VerificationContext } from '@/automation/managers/registry';
import { parsePresetReference } from '@/automation/preset';
import type { RefState } from '@/automation/refs';
import { repositoryNamePattern } from '@/automation/repository-name';
import { marked, placeBlock, setupBlock, withStatus } from '@/automation/setup-body';
import { setupBranches } from '@/automation/setup-changes';
import { buildSnapshot } from '@/automation/snapshot';
import type { BotIdentity } from '@/automation/token';
import type { AutoMerge, Edit, PreparationResult, Snapshot } from '@/automation/types';
import { legacyDiagnostic } from '@/contract/diagnostics';
import { DomainError, domainError, invalid, precondition, upstream } from '@/contract/errors';
import { githubApiVersion } from '@/contract/http';
import type { AutoMergeMethod } from '@/contract/setup-terms';
import { parseRetryAfter } from '@/domain/http-date';
import { fromPromise, fromSync, toDomainError } from '@/failure';
import { decode, sha, textSchema } from '@/model';
import { responseBytes, responseJson, responseText, scopedResponse } from '@/runtime/http';
import { ioConcurrency, retryTransient } from '@/runtime/policy';
import type { Contract, Decoded } from '@/schema';
import { looseStruct, mutableArray, mutableStruct } from '@/schema';

type Permission = Record<string, 'read' | 'write'>;
const missingInstallationPermissions = 'GitHub App installation lacks required permissions';
const coAuthor = 'Co-authored-by: kjanat <6353477+kjanat@users.noreply.github.com>';
const ownerLogins = new Map<number, string>();
const botIdentities = new Map<string, BotIdentity>();
const contentEditsSchema = mutableStruct({
	data: mutableStruct({
		repository: mutableStruct({
			pullRequest: mutableStruct({
				userContentEdits: mutableStruct({
					nodes: mutableArray(
						mutableStruct({
							editor: Schema.NullOr(mutableStruct({ login: Schema.String })),
							diff: Schema.NullOr(Schema.String),
						}),
					),
				}),
			}),
		}),
	}),
});
const autoMergeSchema = mutableStruct({
	data: Schema.optional(Schema.NullOr(mutableStruct({
		enablePullRequestAutoMerge: Schema.NullOr(mutableStruct({
			pullRequest: mutableStruct({ autoMergeRequest: Schema.NullOr(mutableStruct({ mergeMethod: Schema.String })) }),
		})),
	}))),
	errors: Schema.optional(
		mutableArray(mutableStruct({ type: Schema.optional(Schema.String), message: Schema.String })),
	),
});
interface TagTarget {
	__typename: string;
	oid: string;
	target?: TagTarget | undefined;
}
const tagTargetSchema: Schema.Codec<TagTarget, unknown> = mutableStruct({
	__typename: textSchema,
	oid: textSchema,
	target: Schema.optional(Schema.suspend(() => tagTargetSchema)),
});
const graphqlEnvelope = looseStruct({
	errors: Schema.optional(mutableArray(looseStruct({ message: Schema.String, type: Schema.optional(Schema.String) }))),
});
const tagRefsSchema = mutableStruct({
	data: mutableStruct({
		repository: mutableStruct({
			refs: mutableStruct({
				pageInfo: mutableStruct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
				nodes: mutableArray(mutableStruct({ name: textSchema, target: tagTargetSchema })),
			}),
		}),
	}),
});
const tagPeelDepth = 8;
function tagTargetSelection(depth: number): string {
	return depth === 0 ? '__typename oid' : `__typename oid ... on Tag{target{${tagTargetSelection(depth - 1)}}}`;
}
const tagRefsQuery =
	`query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){refs(refPrefix:"refs/tags/",first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{name target{${
		tagTargetSelection(tagPeelDepth)
	}}}}}}`;
// GitHub signals a rate limit by GraphQL error type RATE_LIMITED with HTTP 200, or by HTTP 403 or 429 naming the limit.
function rateLimited(message: string, type?: string): boolean {
	return type === 'RATE_LIMITED' || /rate limit|HTTP 429/i.test(message);
}
function preparationPullNumber(repository: string, url: string): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const parsed = URL.parse(url);
		const prefix = `/${repository}/pull/`;
		if (
			parsed?.origin !== 'https://github.com' || !parsed.pathname.startsWith(prefix)
			|| !/^[1-9][0-9]*$/.test(parsed.pathname.slice(prefix.length))
		) return yield* precondition('Invalid preparation PR identity');
		return parsed.pathname.slice(prefix.length);
	});
}
function detailOf(body: string): string {
	try {
		const parsed: unknown = JSON.parse(body);
		return typeof parsed === 'object' && parsed !== null && 'message' in parsed
			? String(parsed.message)
			: body.slice(0, 200);
	} catch {
		return body.slice(0, 200);
	}
}

class ServerError extends Data.TaggedError('ServerError')<{ readonly message: string }> {}

export class GitHubRejection extends DomainError {
	constructor(readonly status: number, message: string, readonly retryAt?: number) {
		super({ problem: { code: 'precondition', diagnostics: [legacyDiagnostic(message)] }, message });
	}
}

export const gitHubRequest = Effect.fn('GitHub.request')(function*(
	transport: Fetcher,
	path: string,
	token: string,
	method = 'GET',
	body?: unknown,
	readOnlyGraphql = false,
) {
	const clock = yield* Clock.Clock;

	if (!path.startsWith('/')) {
		return yield* invalid('Invalid API path');
	}
	if (
		readOnlyGraphql
		&& !(method === 'POST' && path === '/graphql' && typeof body === 'object' && body !== null && 'query' in body
			&& typeof body.query === 'string' && /^\s*query\b/.test(body.query))
	) {
		return yield* invalid('Read-only retries require a GraphQL query');
	}
	const route = `${method} ${path.split('?')[0]}`;
	const reach = Effect.tryPromise({
		try: signal =>
			transport(`https://api.github.com${path}`, {
				method,
				redirect: 'manual',
				signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': githubApiVersion,
					'User-Agent': 'beepboop',
					'Content-Type': 'application/json',
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}),
		catch: error =>
			upstream('github', `GitHub unreachable on ${route}: ${error instanceof Error ? error.message : String(error)}`),
	});
	const failed = (response: Response) =>
		responseText(response, { maxBytes: 8192 }).pipe(
			Effect.timeout('2 seconds'),
			Effect.map(detailOf),
			Effect.orElseSucceed(() => ''),
			Effect.map(detail => `GitHub HTTP ${response.status} on ${route}${detail ? `: ${detail}` : ''}`),
		);
	const safeRead = method === 'GET' || readOnlyGraphql;
	const maxAttempts = 3;
	let attempt = 0;
	const answered = Effect.gen(function*() {
		attempt++;
		const response = yield* scopedResponse(reach);
		if (response.status === 404 && method === 'GET') return null;
		if (!response.ok) {
			if (safeRead && response.status >= 500 && attempt < maxAttempts) {
				return yield* new ServerError({ message: `GitHub HTTP ${response.status} on ${route}` });
			}
			const message = yield* failed(response);
			if (response.status >= 400 && response.status < 500 && response.status !== 408) {
				const retryAt = response.status === 429 || response.status === 403 && rateLimited(message)
					? parseRetryAfter(response.headers.get('retry-after') ?? '', clock.currentTimeMillisUnsafe())
						?? clock.currentTimeMillisUnsafe() + 60_000
					: undefined;
				return yield* new GitHubRejection(response.status, message, retryAt);
			}
			if (response.status >= 500 && safeRead) return yield* new ServerError({ message });
			return yield* response.status >= 500
				? upstream('github', message)
				: domainError({ code: 'precondition', diagnostics: [legacyDiagnostic(message)] }, message);
		}
		if (response.status === 204) return null;
		return yield* responseJson(response).pipe(
			Effect.mapError(() => upstream('github', `GitHub sent invalid JSON on ${route}`)),
		);
	}).pipe(Effect.scoped);
	return yield* answered.pipe(
		retryTransient<ServerError | DomainError>({
			attempts: maxAttempts,
			delay: 500,
			while: failure => failure._tag === 'ServerError',
		}),
		Effect.catchTag('ServerError', ({ message }) => upstream('github', message)),
	);
});

export class RepositoryGateway {
	constructor(
		private credentials: Credentials,
		private ownerId: number,
		private transport: Fetcher = fetch,
		private defer?: (work: Promise<void>) => void,
		private api?: GitHub['Service'],
	) {}
	call(
		path: string,
		token: string,
		method = 'GET',
		body?: unknown,
		readOnlyGraphql = false,
	): Effect.Effect<unknown, DomainError> {
		return this.api
			? this.api.call(path, token, method, body, readOnlyGraphql)
			: gitHubRequest(this.transport, path, token, method, body, readOnlyGraphql);
	}
	read<S extends Contract>(
		schema: S,
		path: string,
		token: string,
		method = 'GET',
		body?: unknown,
	): Effect.Effect<Decoded<S>, DomainError> {
		return this.call(path, token, method, body).pipe(Effect.flatMap(value => Effect.fromResult(decode(schema, value))));
	}
	peelTag(repository: string, object: GitObject, token: string): Effect.Effect<GitObject, DomainError> {
		if (object.type !== 'tag') return Effect.succeed(object);
		return this.read(gitTagSchema, `/repos/${repository}/git/tags/${object.sha}`, token).pipe(
			Effect.map(tag => tag.object),
		);
	}
	copyReleaseAsset(
		repository: string,
		asset: { id: number; name: string; contentType: string },
		releaseId: number,
		token: string,
	): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const headers = {
				Authorization: `Bearer ${token}`,
				'X-GitHub-Api-Version': githubApiVersion,
				'User-Agent': 'beepboop',
			};
			const download = yield* scopedResponse(
				fromPromise(signal =>
					self.transport(`https://api.github.com/repos/${repository}/releases/assets/${asset.id}`, {
						headers: { ...headers, Accept: 'application/octet-stream' },
						signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
					})
				),
			);
			if (!download.ok) {
				const message = `GitHub HTTP ${download.status} downloading release asset ${asset.name}`;
				return yield* (download.status >= 500 ? upstream('github', message) : precondition(message));
			}
			const content = yield* responseBytes(download).pipe(Effect.mapError(({ cause }) => toDomainError(cause)));
			const upload = yield* scopedResponse(fromPromise(signal =>
				self.transport(
					`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${
						encodeURIComponent(asset.name)
					}`,
					{
						method: 'POST',
						headers: { ...headers, Accept: 'application/vnd.github+json', 'Content-Type': asset.contentType },
						body: content,
						signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
					},
				)
			));
			if (!upload.ok) {
				const message = `GitHub HTTP ${upload.status} uploading release asset ${asset.name}`;
				return yield* (upload.status >= 500 ? upstream('github', message) : precondition(message));
			}
		}).pipe(Effect.scoped);
	}
	token(
		name: string,
		id: number | undefined,
		permissions: Permission = { contents: 'read', actions: 'read' },
	): Effect.Effect<string, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (!repositoryNamePattern.test(name)) return yield* precondition('Invalid repository');
			const jwt = yield* self.appToken();
			const installation = yield* self.read(installationSchema, `/repos/${name}/installation`, jwt);
			if (installation.account.id !== self.ownerId) {
				return yield* precondition('Owner mismatch');
			}
			if (installation.permissions) {
				const missing = Object.entries(permissions).filter(([name, level]) =>
					installation.permissions?.[name] !== 'write' && installation.permissions?.[name] !== level
				).map(([name, level]) => `${name}: ${level}`);
				if (missing.length) {
					return yield* precondition(
						`${missingInstallationPermissions} (${missing.join(', ')}). Update permissions for ${yield* self
							.appPage} and approve the installation update before retrying`,
					);
				}
			}
			const { token } = yield* self.read(
				accessTokenSchema,
				`/app/installations/${installation.id}/access_tokens`,
				jwt,
				'POST',
				{
					...(id === undefined ? { repositories: [name.split('/')[1]] } : { repository_ids: [id] }),
					permissions,
				},
			);
			const repository = yield* self.read(repositorySchema, `/repos/${name}`, token);
			if (
				(id !== undefined && repository.id !== id)
				|| repository.full_name !== name
				|| repository.owner.id !== self.ownerId
			) {
				return yield* precondition('Repository mismatch');
			}
			return token;
		});
	}
	/** JWT for the configured App, never the workflow's GITHUB_TOKEN. */
	private appToken(): Effect.Effect<string, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const clock = yield* Clock.Clock;

			const key = yield* fromPromise(() => importPKCS8(self.credentials.GITHUB_APP_PRIVATE_KEY, 'RS256'));
			const now = Math.floor(clock.currentTimeMillisUnsafe() / 1000);
			return yield* fromPromise(() =>
				new SignJWT({})
					.setProtectedHeader({ alg: 'RS256' })
					.setIssuer(self.credentials.GITHUB_APP_ID)
					.setIssuedAt(now - 60)
					.setExpirationTime(now + 9 * 60)
					.sign(key)
			);
		});
	}
	readonly appPage: Effect.Effect<string, DomainError> = Effect.gen({ self: this }, function*() {
		const { slug } = yield* this.read(appSchema, '/app', yield* this.appToken());
		return `https://github.com/apps/${encodeURIComponent(slug)}`;
	});
	readonly botIdentity: Effect.Effect<BotIdentity, DomainError> = Effect.gen({ self: this }, function*() {
		const cached = botIdentities.get(this.credentials.GITHUB_APP_ID);
		if (cached) return cached;
		const jwt = yield* this.appToken();
		const { slug } = yield* this.read(appSchema, '/app', jwt);
		if (!/^[a-z0-9-]+$/.test(slug)) return yield* precondition('Invalid App slug');
		const login = `${slug}[bot]`;
		const installation = yield* this.ownerInstallation(jwt);
		const { token } = yield* this.read(
			accessTokenSchema,
			`/app/installations/${installation.id}/access_tokens`,
			jwt,
			'POST',
			{ permissions: { metadata: 'read' } },
		);
		const user = yield* this.read(userSchema, `/users/${encodeURIComponent(login)}`, token);
		if (user.login !== login || user.type !== 'Bot') return yield* precondition('App bot identity mismatch');
		const id = user.id;
		const identity = { login, id, email: `${id}+${login}@users.noreply.github.com` };
		botIdentities.set(this.credentials.GITHUB_APP_ID, identity);
		return identity;
	});
	defaultRevision(name: string, id: number): Effect.Effect<{ ref: string; sha: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { contents: 'read' });
			const { default_branch: branch } = yield* self.read(repositorySchema, `/repos/${name}`, token);
			const commit = yield* self.read(commitSchema, `/repos/${name}/commits/${encodeURIComponent(branch)}`, token);
			return { ref: `refs/heads/${branch}`, sha: commit.sha };
		});
	}
	workflowRun(name: string, id: number, runId: number): Effect.Effect<{ title: string; path: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { actions: 'read' });
			const run = yield* self.read(workflowRunSchema, `/repos/${name}/actions/runs/${runId}`, token);
			if (run.repository.id !== id) return yield* precondition('Run identity changed');
			return { title: run.display_title, path: run.path };
		});
	}
	tagRefs(name: string, id: number): Effect.Effect<RefState[], DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { contents: 'read' });
			const [owner = '', repository = ''] = name.split('/');
			const result: RefState[] = [];
			let after: string | null = null;
			for (let page = 1; page <= 100; page++) {
				const raw: unknown = yield* self.call('/graphql', token, 'POST', {
					query: tagRefsQuery,
					variables: { owner, name: repository, after },
				}, true);
				const envelope = yield* Effect.fromResult(decode(graphqlEnvelope, raw));
				if (envelope.errors?.length) {
					const reason = `GitHub tag discovery failed: ${envelope.errors.map(error => error.message).join('; ')}`;
					if (envelope.errors.some(error => rateLimited(error.message, error.type))) {
						const clock = yield* Clock.Clock;
						return yield* new GitHubRejection(429, reason, clock.currentTimeMillisUnsafe() + 60_000);
					}
					return yield* precondition(reason);
				}
				const response: Decoded<typeof tagRefsSchema> = yield* Effect.fromResult(decode(tagRefsSchema, raw)).pipe(
					Effect.mapError(() => precondition('GitHub tag discovery returned missing or invalid repository/ref data')),
				);
				const { nodes, pageInfo } = response.data.repository.refs;
				for (const { name: tag, target } of nodes) {
					let peeled = target;
					while (peeled.target) peeled = peeled.target;
					if (peeled.__typename !== 'Commit') return yield* precondition('Tag does not resolve to a commit');
					result.push({ name: tag, oid: target.oid, commit: peeled.oid });
				}
				if (!pageInfo.hasNextPage) return result;
				if (pageInfo.endCursor === null || pageInfo.endCursor === after) {
					return yield* precondition('Tag discovery cursor did not advance');
				}
				after = pageInfo.endCursor;
			}
			return yield* precondition('Tag discovery limit exceeded');
		});
	}
	verification(name: string, id: number, permissions?: Permission): VerificationContext {
		const installation = Effect.runSync(
			Effect.cachedWithTTL(this.token(name, id, permissions), exit => Exit.isSuccess(exit) ? Infinity : 0),
		);
		return {
			repository: name,
			github: path => installation.pipe(Effect.flatMap(issued => this.call(path, issued))),
		};
	}
	installation(name: string): Effect.Effect<'active' | 'suspended' | 'uninstalled', DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (!repositoryNamePattern.test(name)) return yield* precondition('Invalid repository');
			const found = yield* self.call(`/repos/${name}/installation`, yield* self.appToken());
			if (found === null) return 'uninstalled';
			const installation = yield* Effect.fromResult(decode(installationSchema, found));
			if (installation.account.id !== self.ownerId) return yield* precondition('Owner mismatch');
			return installation.suspended_at ? 'suspended' : 'active';
		});
	}
	identify(name: string): Effect.Effect<number, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, undefined);
			return (yield* self.read(repositorySchema, `/repos/${name}`, token)).id;
		});
	}
	file(name: string, path: string, ref: string, token: string): Effect.Effect<string | null, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const result = yield* self.call(
				`/repos/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
				token,
			);
			if (result === null) return null;
			const data = yield* Effect.fromResult(decode(contentSchema, result));
			const content = data.content;
			if (data.encoding !== 'base64' || typeof content !== 'string' || Number(data.size) > 1_048_576) {
				return yield* precondition('Unsupported file');
			}
			return yield* fromSync(() =>
				new TextDecoder('utf-8', { fatal: true }).decode(
					Uint8Array.from(atob(content.replace(/\s/g, '')), (c) => c.charCodeAt(0)),
				)
			);
		});
	}
	snapshot(
		name: string,
		id: number,
		revision?: string,
		extraPaths: string[] = [],
	): Effect.Effect<Snapshot, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id);
			const { default_branch: defaultBranch } = yield* self.read(repositorySchema, `/repos/${name}`, token);
			const { sha: commitSha } = yield* self.read(
				commitSchema,
				`/repos/${name}/commits/${encodeURIComponent(revision ?? defaultBranch)}`,
				token,
			);
			const tree = yield* self.read(treeSchema, `/repos/${name}/git/trees/${commitSha}?recursive=1`, token);
			if (tree.truncated) {
				return yield* precondition('Repository tree truncated; discovery requires complete input');
			}
			return yield* buildSnapshot({
				repository: { id, name, defaultBranch },
				sha: commitSha,
				entries: tree.tree,
				read: path => self.file(name, path, commitSha, token),
				tags: prefixes => self.tags(name, prefixes, token),
			}, extraPaths);
		});
	}
	private tags(name: string, prefixes: readonly string[], token: string): Effect.Effect<string[], DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const refs = yield* Effect.forEach(prefixes, prefix =>
				self.read(
					Schema.NullOr(mutableArray(matchingRefSchema)),
					`/repos/${name}/git/matching-refs/tags${
						prefix ? `/${prefix.split('/').map(encodeURIComponent).join('/')}` : ''
					}`,
					token,
				).pipe(Effect.map(rows => (rows ?? []).map(row => row.ref.slice('refs/tags/'.length)))), {
				concurrency: ioConcurrency,
			});
			return refs.flat();
		});
	}
	preset(reference: string): Effect.Effect<{ value: unknown; sha: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const parsed = parsePresetReference(reference);
			if (!parsed) return yield* precondition('Invalid preset');
			const { repository: name, preset, ref } = parsed;
			// Public presets need no installation grant; repository configuration cannot redirect credential-bearing requests.
			const metadata = yield* self.read(repositorySchema, `/repos/${name}`, '');
			const { sha: commitSha } = yield* self.read(
				commitSchema,
				`/repos/${name}/commits/${encodeURIComponent(ref ?? metadata.default_branch)}`,
				'',
			);
			const content = yield* self.file(name, `${preset}.json`, commitSha, '');
			if (content === null) return yield* precondition('Preset missing');
			return { value: yield* fromSync((): unknown => JSON.parse(content)), sha: commitSha };
		});
	}
	/** Check an already-granted installation permission without changing repository contents. */
	canEditWorkflows(name: string, id: number): Effect.Effect<boolean, DomainError> {
		return this.token(name, id, { contents: 'read', workflows: 'write' }).pipe(
			Effect.as(true),
			Effect.catchIf(
				error =>
					/^GitHub HTTP (403|422) /.test(error.message)
					|| (error.problem.code === 'precondition' && error.message.startsWith(missingInstallationPermissions)),
				() => Effect.succeed(false),
			),
		);
	}
	/** Read the proposal head without modifying or creating a branch. */
	private ownerInstallation(jwt: string): Effect.Effect<Decoded<typeof installationSchema>, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const installation = (yield* self.read(mutableArray(installationSchema), '/app/installations?per_page=100', jwt))
				.find(installation => installation.account.id === self.ownerId);
			if (!installation) return yield* precondition('The GitHub App is not installed on the owner account');
			return installation;
		});
	}
	ownerLogin(): Effect.Effect<string, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const cached = ownerLogins.get(self.ownerId);
			if (cached) return cached;
			const login = (yield* self.ownerInstallation(yield* self.appToken())).account.login;
			ownerLogins.set(self.ownerId, login);
			return login;
		});
	}
	private generatedComparison(name: string, head: string, token: string) {
		const self = this;
		return Effect.gen(function*() {
			const base = (yield* self.read(repositorySchema, `/repos/${name}`, token)).default_branch;
			const comparison = yield* self.read(
				comparisonSchema,
				`/repos/${name}/compare/${encodeURIComponent(base)}...${head}`,
				token,
			);
			const commits = comparison.commits;
			if (!commits.length || commits.length !== Number(comparison.ahead_by) || commits.at(-1)?.sha !== head) {
				return undefined;
			}
			const bot = yield* self.botIdentity;
			const generated = commits.every(commit =>
				commit.author.id === bot.id && commit.commit.verification.verified === true
			);
			return generated ? comparison : undefined;
		});
	}
	generatedHead(name: string, id: number, head: string): Effect.Effect<boolean, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { contents: 'read' });
			return (yield* self.generatedComparison(name, head, token)) !== undefined;
		});
	}
	generatedFiles(name: string, id: number, head: string): Effect.Effect<Edit[] | undefined, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { contents: 'read' });
			const comparison = yield* self.generatedComparison(name, head, token);
			if (!comparison) return undefined;
			const files = comparison.files;
			if (files.length >= 300) return undefined;
			const mergeBase = comparison.merge_base_commit.sha;
			const paths = yield* Effect.fromResult(decode(mutableArray(textSchema), files.map(file => file.filename)));
			return yield* Effect.forEach(paths, path => {
				return Effect.all({
					path: Effect.succeed(path),
					before: self.file(name, path, mergeBase, token).pipe(Effect.map(content => content ?? '')),
					after: self.file(name, path, head, token).pipe(Effect.map(content => content ?? '')),
				});
			}, { concurrency: ioConcurrency });
		});
	}
	setupHead(name: string, id: number, branch: string): Effect.Effect<string | null, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id);
			const ref = yield* self.read(
				Schema.NullOr(gitRefSchema),
				`/repos/${name}/git/ref/heads/${branch}`,
				token,
			);
			return ref ? ref.object.sha : null;
		});
	}
	pullRequest<R = never>(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		edits: Edit[],
		expectedHead?: string,
		checkpoint?: (head: string) => Effect.Effect<void, DomainError, R>,
		setupEdits?: Edit[],
		existingPull?: number,
		options: { takeOver?: boolean; coAuthored?: boolean } = {},
	): Effect.Effect<{ url: string; head: string }, DomainError, R> {
		const { takeOver = false, coAuthored = false } = options;
		const self = this;
		return Effect.gen(function*() {
			const { name, id } = snapshot.repository;
			const token = yield* self.token(name, id, {
				contents: 'write',
				pull_requests: 'write',
				...(edits.some(edit => edit.path.startsWith('.github/workflows/'))
						|| setupEdits?.some(edit => edit.path.startsWith('.github/workflows/'))
					? { workflows: 'write' as const }
					: {}),
			});
			const existing = yield* self.read(
				Schema.NullOr(gitRefSchema),
				`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`,
				token,
			);
			const base = existing ? existing.object.sha : snapshot.sha;
			if (existing && (!expectedHead || expectedHead !== base)) {
				return yield* precondition('Branch changed; preserve user edits and review the conflict');
			}
			if (existing && setupEdits && !takeOver) {
				const changed = (yield* self.read(comparisonSchema, `/repos/${name}/compare/${snapshot.sha}...${base}`, token))
					.files;
				if (changed.length >= 300 || changed.some(file => !setupEdits.some(edit => edit.path === file.filename))) {
					return yield* precondition('Setup branch contains unrelated changes; review it before refreshing');
				}
				for (const edit of setupEdits) {
					if ((yield* self.file(name, edit.path, base, token)) !== edit.after) {
						return yield* precondition(`Setup branch was edited: ${edit.path}`);
					}
				}
			}
			const head = yield* self.editCommit(
				name,
				token,
				setupEdits ? snapshot.sha : base,
				edits,
				coAuthored ? `${title}\n\n${coAuthor}` : title,
			);
			const rules = yield* self.read(
				Schema.NullOr(mutableArray(ruleSchema)),
				`/repos/${name}/rules/branches/${encodeURIComponent(branch)}`,
				token,
			);
			if (rules === null) {
				return yield* precondition('Branch rules unavailable; publication of the preparation branch stopped');
			}
			if (rules.some((rule) => rule.type === 'required_signatures')) {
				const { verification } = yield* self.read(gitCommitSchema, `/repos/${name}/git/commits/${head}`, token);
				if (verification.verified !== true) {
					return yield* precondition('Preparation commit does not satisfy the branch signature requirement');
				}
			}
			if (existingPull !== undefined) {
				const pull = yield* self.read(pullSchema, `/repos/${name}/pulls/${existingPull}`, token);
				if (
					pull.state !== 'open' || pull.head.sha !== base || pull.head.ref !== branch || pull.head.repo.id !== id
				) return yield* precondition('Setup pull request changed during refresh');
			}
			if (checkpoint) yield* checkpoint(head);
			if (existing) {
				yield* self.call(
					`/repos/${name}/git/refs/heads/${encodeURIComponent(branch)}`,
					token,
					'PATCH',
					{ sha: head, force: setupEdits !== undefined },
				);
			} else {
				yield* self.call(`/repos/${name}/git/refs`, token, 'POST', {
					ref: `refs/heads/${branch}`,
					sha: head,
				});
			}
			return yield* self.finishPullRequest(snapshot, branch, title, body, head, token);
		});
	}
	private editCommit(
		name: string,
		token: string,
		base: string,
		edits: Edit[],
		message: string,
	): Effect.Effect<string, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const commit = yield* self.read(gitCommitSchema, `/repos/${name}/git/commits/${base}`, token);
			for (const edit of edits) {
				const current = yield* self.file(name, edit.path, base, token);
				if ((current ?? '') !== edit.before) return yield* precondition(`File changed: ${edit.path}`);
				if (
					edit.path.startsWith('/')
					|| edit.path.split('/').some((p) => p === '..' || p === '.git')
				) {
					return yield* precondition('Unsafe edit path');
				}
			}
			const tree = yield* self.read(createdSchema, `/repos/${name}/git/trees`, token, 'POST', {
				base_tree: commit.tree.sha,
				tree: edits.map((edit) => ({
					path: edit.path,
					mode: '100644',
					type: 'blob',
					content: edit.after,
				})),
			});
			const { sha: head } = yield* self.read(createdSchema, `/repos/${name}/git/commits`, token, 'POST', {
				message,
				tree: tree.sha,
				parents: [base],
			});
			return head;
		});
	}
	/** Fast-forward the default branch to a signed bot commit that applies the version bump. */
	commitVersion<R = never>(
		snapshot: Snapshot,
		message: string,
		edits: Edit[],
		head: string | undefined,
		checkpoint: (head: string) => Effect.Effect<void, DomainError, R>,
	): Effect.Effect<PreparationResult, DomainError, R> {
		const self = this;
		return Effect.gen(function*() {
			const { name, id, defaultBranch } = snapshot.repository;
			const token = yield* self.token(name, id, {
				contents: 'write',
				...(edits.some(edit => edit.path.startsWith('.github/workflows/')) ? { workflows: 'write' as const } : {}),
			});
			const branch = encodeURIComponent(defaultBranch);
			let commit = head;
			if (!commit) {
				commit = yield* self.editCommit(name, token, snapshot.sha, edits, message);
				yield* checkpoint(commit);
			}
			const current = yield* self.read(gitRefSchema, `/repos/${name}/git/ref/heads/${branch}`, token);
			const landed = current.object.sha === commit
				|| (current.object.sha !== snapshot.sha
					&& (yield* self.read(comparisonSchema, `/repos/${name}/compare/${commit}...${current.object.sha}`, token))
						.status === 'ahead');
			if (!landed) {
				if (current.object.sha !== snapshot.sha) {
					return yield* precondition(
						`${defaultBranch} moved to ${
							current.object.sha.slice(0, 12)
						} before the version commit landed. Start the release again.`,
					);
				}
				yield* self.call(`/repos/${name}/git/refs/heads/${branch}`, token, 'PATCH', { sha: commit, force: false })
					.pipe(
						Effect.catchIf(
							error => error.problem.code === 'precondition',
							error =>
								precondition(
									`GitHub refused the version commit on ${defaultBranch}: ${error.message}. Let the Beepboop app push to ${defaultBranch}, or set prepare.versionLands to "via-version-pr".`,
								),
						),
					);
			}
			return { url: `https://github.com/${name}/commit/${commit}`, head: commit, kind: 'commit' as const };
		});
	}
	/** Bind release execution to the merged preparation pull request. */
	private mergedPreparationPull(
		repository: string,
		repositoryId: number,
		result: { url: string; head: string },
		token: string,
	): Effect.Effect<{ mergeSha: string; base: string; defaultBranch: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const number = yield* preparationPullNumber(repository, result.url);
			const pull = yield* self.read(pullSchema, `/repos/${repository}/pulls/${number}`, token);
			const base = pull.base;
			const mergeSha = pull.merged === true ? yield* self.mergeCommit(repository, number, token) : undefined;
			if (!mergeSha || pull.head.sha !== result.head || base.repo.id !== repositoryId) {
				return yield* precondition('The preparation PR is not merged');
			}
			return { mergeSha, base: base.ref, defaultBranch: base.repo.default_branch };
		});
	}
	preparedSnapshot(
		repository: string,
		repositoryId: number,
		result: { url: string; head: string },
		target: string,
		extraPaths: string[] = [],
	): Effect.Effect<Snapshot, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(repository, repositoryId, { contents: 'read', pull_requests: 'read' });
			const pull = yield* self.mergedPreparationPull(repository, repositoryId, result, token);
			if (pull.mergeSha !== (yield* Effect.fromResult(sha(target)))) {
				return yield* precondition('Target is not the merged preparation revision');
			}
			const snapshot = yield* self.snapshot(repository, repositoryId, target, extraPaths);
			if (pull.base !== snapshot.repository.defaultBranch) {
				return yield* precondition('Preparation was merged into a different branch');
			}
			return snapshot;
		});
	}
	preparationMerge(
		repository: string,
		repositoryId: number,
		result: { url: string; head: string },
		target: string,
	): Effect.Effect<string | undefined, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(repository, repositoryId, { contents: 'read', pull_requests: 'read' });
			const pull = yield* self.mergedPreparationPull(repository, repositoryId, result, token);
			if (pull.base !== pull.defaultBranch) return undefined;
			const comparison = yield* self.read(
				comparisonSchema,
				`/repos/${repository}/compare/${pull.mergeSha}...${yield* Effect.fromResult(sha(target))}`,
				token,
			);
			return comparison.status === 'identical' || comparison.status === 'ahead' ? pull.mergeSha : undefined;
		});
	}
	contains(
		repository: string,
		repositoryId: number,
		commit: string,
		target: string,
	): Effect.Effect<boolean, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(repository, repositoryId, { contents: 'read' });
			const comparison = yield* self.read(
				comparisonSchema,
				`/repos/${repository}/compare/${yield* Effect.fromResult(sha(commit))}...${yield* Effect.fromResult(
					sha(target),
				)}`,
				token,
			);
			return comparison.status === 'identical' || comparison.status === 'ahead';
		});
	}
	private mergeCommit(
		repository: string,
		number: string,
		token: string,
	): Effect.Effect<string | undefined, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			for (let page = 1; page <= 10; page++) {
				const events = yield* self.read(
					mutableArray(issueEventSchema),
					`/repos/${repository}/issues/${number}/events?per_page=100&page=${page}`,
					token,
				);
				const merged = events.find((event) => event.event === 'merged');
				if (merged) return typeof merged.commit_id === 'string' ? merged.commit_id : undefined;
				if (events.length < 100) return undefined;
			}
			return undefined;
		});
	}
	/** Resume only the exact commit checkpointed before branch publication. */
	resumePreparation(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		head: string,
	): Effect.Effect<{ url: string; head: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const { name, id } = snapshot.repository;
			const token = yield* self.token(name, id, { contents: 'write', pull_requests: 'write' });
			const commit = yield* self.read(
				gitCommitSchema,
				`/repos/${name}/git/commits/${yield* Effect.fromResult(sha(head))}`,
				token,
			);
			const parents = commit.parents;
			if (parents.length !== 1 || parents[0]?.sha !== snapshot.sha) {
				return yield* precondition('Preparation commit ancestry changed');
			}
			const rules = yield* self.read(
				Schema.NullOr(mutableArray(ruleSchema)),
				`/repos/${name}/rules/branches/${encodeURIComponent(branch)}`,
				token,
			);
			if (rules === null) return yield* precondition('Branch rules unavailable');
			if (rules.some(rule => rule.type === 'required_signatures') && commit.verification.verified !== true) {
				return yield* precondition('Preparation commit signature is not verified');
			}
			const existing = yield* self.read(
				Schema.NullOr(gitRefSchema),
				`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`,
				token,
			);
			if (existing && existing.object.sha !== head) {
				return yield* precondition('Preparation branch changed');
			}
			if (!existing) {
				yield* self.call(`/repos/${name}/git/refs`, token, 'POST', { ref: `refs/heads/${branch}`, sha: head });
			}
			return yield* self.finishPullRequest(snapshot, branch, title, body, head, token);
		});
	}
	/** Inspect the existing setup proposal; automatic maintenance never opens a replacement PR. */
	openSetupPull(
		name: string,
		id: number,
	): Effect.Effect<
		{ number: number; head: string; branch: string; url: string; body: string } | undefined,
		DomainError
	> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { contents: 'read', pull_requests: 'read' });
			const rows: Decoded<typeof pullSchema>[] = [];
			for (const branch of setupBranches) {
				rows.push(
					...yield* self.read(
						mutableArray(pullSchema),
						`/repos/${name}/pulls?state=open&head=${encodeURIComponent(`${name.split('/')[0]}:${branch}`)}`,
						token,
					),
				);
			}
			if (rows.length > 1) return yield* precondition('Multiple open setup pull requests');
			const pull = rows[0];
			if (!pull) return;
			if (pull.head.repo.id !== id || !setupBranches.includes(pull.head.ref)) {
				return yield* precondition('Setup pull request repository mismatch');
			}
			return {
				number: pull.number,
				head: pull.head.sha,
				branch: pull.head.ref,
				url: pull.html_url,
				body: typeof pull.body === 'string' ? pull.body : '',
			};
		});
	}
	setupMerge(
		name: string,
		id: number,
		url: string,
	): Effect.Effect<{ sha: string; body: string } | undefined, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const prefix = `https://github.com/${name}/pull/`;
			const number = url.startsWith(prefix) ? url.slice(prefix.length) : '';
			if (!/^[1-9][0-9]*$/.test(number)) return undefined;
			const token = yield* self.token(name, id, { contents: 'read', pull_requests: 'read' });
			const pull = yield* self.read(pullSchema, `/repos/${name}/pulls/${number}`, token);
			if (pull.merged !== true || pull.head.repo.id !== id || !setupBranches.includes(pull.head.ref)) {
				return undefined;
			}
			const sha = yield* self.mergeCommit(name, number, token);
			return sha === undefined ? undefined : { sha, body: typeof pull.body === 'string' ? pull.body : '' };
		});
	}
	/** Update only the bot's status section, including when a human changed the proposal branch. */
	setupStatus(
		name: string,
		id: number,
		number: number,
		status: string,
		proposal?: { title: string; body: string },
	): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { pull_requests: 'write' });
			const pull = yield* self.read(pullSchema, `/repos/${name}/pulls/${number}`, token);
			if (pull.state !== 'open' || !setupBranches.includes(pull.head.ref) || pull.head.repo.id !== id) return;
			const current = typeof pull.body === 'string' ? pull.body : '';
			const body = proposal === undefined
				? withStatus(current, status)
				: placeBlock(
					current,
					setupBlock(proposal.body, status),
					yield* self.previousRender(name, number, current, token),
				);
			const title = proposal && proposal.title !== pull.title ? { title: proposal.title } : {};
			if (body !== current || 'title' in title) {
				yield* self.call(`/repos/${name}/pulls/${number}`, token, 'PATCH', { body, ...title });
			}
		});
	}
	private previousRender(
		name: string,
		number: number,
		current: string,
		token: string,
	): Effect.Effect<string, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (marked(current) || !current.trim()) return current;
			const [owner = '', repository = ''] = name.split('/');
			const { data } = yield* self.read(
				contentEditsSchema,
				'/graphql',
				token,
				'POST',
				{
					query:
						'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){userContentEdits(first:100){nodes{editor{login} diff}}}}}',
					variables: { owner, name: repository, number },
				},
			);
			const edits = data.repository.pullRequest.userContentEdits.nodes;
			const bot = (yield* self.botIdentity).login.replace(/\[bot\]$/, '');
			const render = edits.find(edit => edit.editor?.login === bot && typeof edit.diff === 'string');
			return typeof render?.diff === 'string' ? render.diff : current;
		});
	}
	/** Refresh setup documentation without creating an empty commit or overwriting branch edits. */
	refreshPullRequest(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		expectedHead: string,
	): Effect.Effect<{ url: string; head: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(snapshot.repository.name, snapshot.repository.id, {
				contents: 'read',
				pull_requests: 'write',
			});
			const current = yield* self.read(
				Schema.NullOr(gitRefSchema),
				`/repos/${snapshot.repository.name}/git/ref/heads/${encodeURIComponent(branch)}`,
				token,
			);
			if (!current || current.object.sha !== expectedHead) {
				return yield* precondition('Branch changed; preserve user edits and review the conflict');
			}
			return yield* self.finishPullRequest(snapshot, branch, title, body, expectedHead, token);
		});
	}
	enableAutoMerge(
		repository: string,
		repositoryId: number,
		url: string,
		method: AutoMergeMethod,
	): Effect.Effect<AutoMerge, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(repository, repositoryId, { contents: 'write', pull_requests: 'write' });
			const number = yield* preparationPullNumber(repository, url);
			const pull = yield* self.read(pullSchema, `/repos/${repository}/pulls/${number}`, token);
			const response = yield* self.read(autoMergeSchema, '/graphql', token, 'POST', {
				query:
					'mutation($id:ID!,$method:PullRequestMergeMethod!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method}){pullRequest{autoMergeRequest{mergeMethod}}}}',
				variables: { id: pull.node_id, method: method.toUpperCase() },
			}).pipe(
				Effect.catchIf(
					error => error.problem.code === 'precondition' || error.problem.code === 'forbidden',
					error =>
						Effect.succeed<Decoded<typeof autoMergeSchema>>({ data: null, errors: [{ message: error.message }] }),
				),
			);
			if (response.data?.enablePullRequestAutoMerge?.pullRequest.autoMergeRequest) {
				return { method, state: 'enabled' as const };
			}
			const reason = response.errors?.map(error => error.message).join('; ') || 'GitHub returned no auto-merge request';
			if (response.errors?.some(error => rateLimited(error.message, error.type))) {
				return yield* upstream('github', `GitHub rate-limited auto-merge for ${repository}#${number}: ${reason}`);
			}
			const note =
				`Beepboop could not turn on ${method} auto-merge for this version PR. GitHub said: ${reason}. The PR stays open until you merge it.`;
			yield* self.call(`/repos/${repository}/issues/${number}/comments`, token, 'POST', { body: note }).pipe(
				Effect.ignore,
			);
			return { method, state: 'refused' as const, note };
		});
	}
	private finishPullRequest(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		head: string,
		token: string,
	): Effect.Effect<{ url: string; head: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const { name } = snapshot.repository;
			const owner = name.split('/')[0];
			const unmerged = (yield* self.read(
				mutableArray(pullSchema),
				`/repos/${name}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`,
				token,
			)).filter(pull => pull.merged !== true && typeof pull.merged_at !== 'string');
			const setup = setupBranches.includes(branch);
			const pulls = setup ? unmerged.filter(pull => pull.state === 'open') : unmerged;
			if (pulls.length > 1) {
				return yield* precondition(`Several unmerged pull requests use ${branch}; keep one of them`);
			}
			if (pulls[0] && pulls[0].state !== 'open') {
				return yield* precondition(
					`The preparation PR #${pulls[0].number} was closed without merging. Reopen it to continue this release.`,
				);
			}
			const existing = pulls[0];
			const validBase = (pull: Decoded<typeof pullSchema>) =>
				pull.base.ref === snapshot.repository.defaultBranch ? Effect.void : precondition(
					`The preparation PR #${pull.number} targets ${pull.base.ref}; retarget it to ${snapshot.repository.defaultBranch} to continue this release.`,
				);
			if (existing) yield* validBase(existing);
			const previousBody = typeof existing?.body === 'string' ? existing.body : '';
			const pull = existing
				? yield* self.read(pullSchema, `/repos/${name}/pulls/${existing.number}`, token, 'PATCH', {
					title,
					body: setup
						? placeBlock(
							previousBody,
							setupBlock(body),
							yield* self.previousRender(name, existing.number, previousBody, token),
						)
						: body,
				})
				: yield* self.read(pullSchema, `/repos/${name}/pulls`, token, 'POST', {
					title,
					body: setup ? `${setupBlock(body)}\n` : body,
					head: branch,
					base: snapshot.repository.defaultBranch,
				});
			yield* validBase(pull);
			const metadata = Effect.gen(function*() {
				const available = yield* self.read(mutableArray(namedSchema), `/repos/${name}/labels?per_page=100`, token);
				let labels = available
					.map((label) => label.name)
					.filter((name) =>
						['maintenance', 'type:maintenance', 'area:release', 'release', 'dependencies'].includes(
							name,
						)
					);
				labels = labels.filter((name) => name !== 'dependencies');
				if (!labels.length) {
					yield* self.call(`/repos/${name}/labels`, token, 'POST', {
						name: 'maintenance',
						color: '527a67',
						description: 'Repository maintenance and release automation',
					});
					labels = ['maintenance'];
				}
				yield* self.read(
					mutableArray(namedSchema),
					`/repos/${name}/issues/${pull.number}/labels`,
					token,
					'POST',
					{ labels },
				);
				const maintainer = yield* self.ownerLogin();
				if (!pull.assignees?.some(assignee => assignee.login === maintainer)) {
					yield* self.call(`/repos/${name}/issues/${pull.number}/assignees`, token, 'POST', {
						assignees: [maintainer],
					});
				}
				if (!pull.requested_reviewers?.some(reviewer => reviewer.login === maintainer)) {
					yield* self.call(`/repos/${name}/pulls/${pull.number}/requested_reviewers`, token, 'POST', {
						reviewers: [maintainer],
					});
				}
			}).pipe(logRecovered('pull-request.metadata-failed', { repository: name, number: pull.number }));
			if (self.defer) self.defer(Effect.runPromiseWith(yield* Effect.context())(metadata));
			else yield* metadata;
			return { url: pull.html_url, head };
		});
	}
}

export interface Credentials {
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}

export class GitHub extends Context.Service<GitHub, {
	readonly call: (
		path: string,
		token: string,
		method?: string,
		body?: unknown,
		readOnlyGraphql?: boolean,
	) => Effect.Effect<unknown, DomainError>;
}>()('beepboop/GitHub') {}

export function gitHubLayer(transport: Fetcher): Layer.Layer<GitHub> {
	return Layer.succeed(GitHub, {
		call: (path, token, method, body, readOnlyGraphql) =>
			gitHubRequest(transport, path, token, method, body, readOnlyGraphql),
	});
}
