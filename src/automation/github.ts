import { Clock, Context, Data, Effect, Exit, Layer, Schema } from 'effect';
import { signJwt } from 'micro509/jose';
import { importPkcs8Pem } from 'micro509/keys';
import type { GitObject } from '@/automation/github-resources';
import {
	accessTokenSchema,
	appSchema,
	commitSchema,
	comparisonSchema,
	contentSchema,
	createdTagSchema,
	gitTagSchema,
	installationSchema,
	issueEventSchema,
	matchingRefSchema,
	repositorySchema,
	treeSchema,
	userSchema,
	workflowRunSchema,
} from '@/automation/github-resources';
import type { Fetcher, VerificationContext } from '@/automation/managers/registry';
import { platformFetch } from '@/automation/managers/registry';
import { callLimit, liveJobs, ownWorkflow, workflowDocuments } from '@/automation/release-graph/calls';
import { marked } from '@/automation/setup-body';
import { buildSnapshot } from '@/automation/snapshot';
import type { BotIdentity } from '@/automation/token';
import { githubApiVersion } from '@/contract/http';
import type { Snapshot } from '@/domain/inventory.ts';
import { parsePresetReference } from '@/domain/preset.ts';
import type { RefState } from '@/domain/refs.ts';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { fromPromise, fromSync, toDomainError } from '@/kernel/errors/classify.ts';
import { legacyDiagnostic } from '@/kernel/errors/diagnostics.ts';
import { DomainError, domainError, invalid, precondition, upstream } from '@/kernel/errors/domain-error.ts';
import { responseBytes, responseJson, responseText, scopedResponse } from '@/kernel/http/body.ts';
import { parseRetryAfter } from '@/kernel/http/http-date.ts';
import { ioConcurrency, retryTransient } from '@/kernel/http/retry.ts';
import { decode, sha, textSchema } from '@/kernel/schema/result.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

type Permission = Record<string, 'read' | 'write'>;
const missingInstallationPermissions = 'GitHub App installation lacks required permissions';
const workflowDirectory = '.github/workflows/';
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
export function rateLimited(message: string, type?: string): boolean {
	return type === 'RATE_LIMITED' || /rate limit|HTTP 429/i.test(message);
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
			Effect.map(detail => {
				const accepted = response.headers.get('x-accepted-github-permissions');
				return `GitHub HTTP ${response.status} on ${route}${detail ? `: ${detail}` : ''}${
					accepted ? ` (GitHub accepts ${accepted})` : ''
				}`;
			}),
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
		private transport: Fetcher = platformFetch,
		readonly defer?: (work: Promise<void>) => void,
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
	ensureIssue(name: string, id: number, issue: { title: string; body: string }): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const token = yield* this.token(name, id, { issues: 'write' });
			const path = `/repos/${name}/issues`;
			const issueList = mutableArray(looseStruct({
				title: Schema.String,
				pull_request: Schema.optional(Schema.Unknown),
			}));
			for (let page = 1;; page++) {
				const existing = yield* this.read(issueList, `${path}?state=all&per_page=100&page=${page}`, token);
				if (existing.some(candidate => !candidate.pull_request && candidate.title === issue.title)) return;
				if (existing.length < 100) break;
			}
			yield* this.call(path, token, 'POST', issue);
		});
	}
	peelTag(repository: string, object: GitObject, token: string): Effect.Effect<GitObject, DomainError> {
		if (object.type !== 'tag') return Effect.succeed(object);
		return this.read(gitTagSchema, `/repos/${repository}/git/tags/${object.sha}`, token).pipe(
			Effect.map(tag => tag.object),
		);
	}
	downloadWorkflowArtifact(repository: string, id: number, token: string): Effect.Effect<Uint8Array, DomainError> {
		return fromPromise(async signal => {
			const redirected = await this.transport(
				`https://api.github.com/repos/${repository}/actions/artifacts/${id}/zip`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						'X-GitHub-Api-Version': githubApiVersion,
						'User-Agent': 'beepboop',
					},
					signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
					redirect: 'manual',
				},
			);
			const location = redirected.headers.get('location');
			await redirected.body?.cancel();
			if (redirected.status !== 302 || !location) {
				throw precondition('GitHub did not provide a distribution artifact download URL');
			}
			const url = new URL(location);
			if (url.protocol !== 'https:' || url.username || url.password) {
				throw precondition('Invalid distribution artifact download URL');
			}
			const response = await this.transport(url.href, {
				signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
				redirect: 'error',
			});
			if (!response.ok || !response.body) {
				throw precondition(`GitHub HTTP ${response.status} downloading distribution artifact`);
			}
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const next = await reader.read();
					if (next.done) break;
					size += next.value.byteLength;
					if (size > 8 * 1024 * 1024) throw precondition('Distribution artifact exceeds 8 MiB');
					chunks.push(next.value);
				}
			} finally {
				await reader.cancel();
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return bytes;
		});
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

			const imported = yield* fromPromise(() =>
				importPkcs8Pem(self.credentials.GITHUB_APP_PRIVATE_KEY, { kind: 'rsa', hash: 'SHA-256' })
			);
			if (!imported.ok) return yield* toDomainError(new Error(imported.message));
			const now = Math.floor(clock.currentTimeMillisUnsafe() / 1000);
			return yield* fromPromise(() =>
				signJwt({
					privateKey: imported.value,
					algorithm: 'RS256',
					claims: { iss: self.credentials.GITHUB_APP_ID, iat: now - 60, exp: now + 9 * 60 },
				})
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
	/** GitHub builds the tag object from these fields; a signature appended to the message verifies when the fields reproduce the signed payload. */
	createTag(
		name: string,
		id: number,
		tag: {
			name: string;
			commit: string;
			message: string;
			tagger: { name: string; email: string; date: string };
			signed: boolean;
		},
	): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id, { contents: 'write', workflows: 'write' });
			const created = yield* self.read(createdTagSchema, `/repos/${name}/git/tags`, token, 'POST', {
				tag: tag.name,
				message: tag.message,
				object: tag.commit,
				type: 'commit',
				tagger: tag.tagger,
			});
			if (tag.signed && !created.verification.verified) {
				return yield* precondition(
					`GitHub did not verify the signature of ${tag.name} (${created.verification.reason ?? 'unknown reason'})`,
				);
			}
			yield* self.call(`/repos/${name}/git/refs`, token, 'POST', { ref: `refs/tags/${tag.name}`, sha: created.sha });
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
	unchangedSince(
		repository: string,
		repositoryId: number,
		commit: string,
		target: string,
		paths: ReadonlySet<string>,
	): Effect.Effect<boolean, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (commit === target) return true;
			const token = yield* self.token(repository, repositoryId, { contents: 'read' });
			const comparison = yield* self.read(
				comparisonSchema,
				`/repos/${repository}/compare/${yield* Effect.fromResult(sha(commit))}...${yield* Effect.fromResult(
					sha(target),
				)}`,
				token,
			);
			if (comparison.status !== 'ahead' || comparison.files.length >= 300) return false;
			const changed = comparison.files.map(file => String(file.filename));
			if (changed.some(path => paths.has(path))) return false;
			if (!changed.some(path => path.startsWith(workflowDirectory))) return true;
			const called = yield* self.calledWorkflows(
				repository,
				[...paths].filter(path => path.startsWith(workflowDirectory)),
				target,
				token,
			);
			return !changed.some(path => called.has(path));
		});
	}
	private calledWorkflows(
		repository: string,
		roots: string[],
		commit: string,
		token: string,
	): Effect.Effect<ReadonlySet<string>, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const seen = new Set<string>();
			const queue = [...roots];
			for (let path = queue.shift(); path !== undefined && seen.size < callLimit; path = queue.shift()) {
				if (seen.has(path)) continue;
				seen.add(path);
				const source = yield* self.file(repository, path, commit, token);
				if (source === null) continue;
				for (const { document } of workflowDocuments([[path, source]])) {
					for (const [, job] of liveJobs(document)) {
						const callee = typeof job.uses === 'string' ? ownWorkflow(job.uses, repository) : undefined;
						if (callee) queue.push(`${workflowDirectory}${callee.file}`);
					}
				}
			}
			return seen;
		});
	}
	mergeCommit(
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
	previousRender(
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
