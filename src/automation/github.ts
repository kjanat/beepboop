import { Clock, Effect, Exit, Option, Schema } from 'effect';
import { signJwt } from 'micro509/jose';
import { importPkcs8Pem } from 'micro509/keys';
import { rawFile, rawPreset } from '@/automation/github-raw';
import type { BotIdentity } from '@/automation/token';
import type { Snapshot } from '@/domain/inventory.ts';
import { parsePresetReference } from '@/domain/preset.ts';
import type { RefState } from '@/domain/refs.ts';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { downloadWorkflowArtifact } from '@/github/artifacts.ts';
import { copyReleaseAsset } from '@/github/releases.ts';
import type { GitObject } from '@/github/resources.ts';
import {
	accessTokenSchema,
	appSchema,
	commitSchema,
	comparisonSchema,
	contentSchema,
	installationSchema,
	issueEventSchema,
	matchingRefSchema,
	repositorySchema,
	treeSchema,
	userSchema,
	workflowRunSchema,
} from '@/github/resources.ts';
import type { TagRequest } from '@/github/tags.ts';
import { createTag, peelTag, tagRefs } from '@/github/tags.ts';
import type { GitHubTransport } from '@/github/transport.ts';
import { gitHubRequest } from '@/github/transport.ts';
import { fromPromise, fromSync, toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { ioConcurrency } from '@/kernel/http/retry.ts';
import { decode, sha } from '@/kernel/schema/result.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableArray } from '@/kernel/schema/structs.ts';

type Permission = Record<string, 'read' | 'write'>;
const missingInstallationPermissions = 'GitHub App installation lacks required permissions';
const ownerLogins = new Map<number, string>();
const botIdentities = new Map<string, BotIdentity>();
export interface VerificationContext {
	repository: string;
	github(path: string): Effect.Effect<unknown, DomainError>;
}
export interface TreeEntry {
	path: string;
	type: string;
	mode: string;
}
export interface SnapshotSource {
	repository: Snapshot['repository'];
	sha: string;
	entries: readonly TreeEntry[];
	read(path: string): Effect.Effect<string | null, DomainError>;
	tags(prefixes: readonly string[]): Effect.Effect<string[], DomainError>;
}
export class RepositoryGateway {
	constructor(
		private credentials: Credentials,
		private ownerId: number,
		private transport: Fetcher = platformFetch,
		readonly defer?: (work: Promise<void>) => void,
		private api?: GitHubTransport['Service'],
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
		return peelTag(this, repository, object, token);
	}
	downloadWorkflowArtifact(repository: string, id: number, token: string): Effect.Effect<Uint8Array, DomainError> {
		return downloadWorkflowArtifact(this.transport, repository, id, token);
	}
	copyReleaseAsset(
		repository: string,
		asset: { id: number; name: string; contentType: string },
		releaseId: number,
		token: string,
	): Effect.Effect<void, DomainError> {
		return copyReleaseAsset(this.transport, repository, asset, releaseId, token);
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
	createTag(name: string, id: number, tag: TagRequest): Effect.Effect<void, DomainError> {
		return this.token(name, id, { contents: 'write', workflows: 'write' }).pipe(
			Effect.flatMap(token => createTag(this, name, token, tag)),
		);
	}
	tagRefs(name: string, id: number): Effect.Effect<RefState[], DomainError> {
		return this.token(name, id, { contents: 'read' }).pipe(Effect.flatMap(token => tagRefs(this, name, token)));
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
	snapshotSource(name: string, id: number, revision?: string): Effect.Effect<SnapshotSource, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* self.token(name, id);
			const { default_branch: defaultBranch, private: hidden } = yield* self.read(
				repositorySchema,
				`/repos/${name}`,
				token,
			);
			const { sha: commitSha } = yield* self.read(
				commitSchema,
				`/repos/${name}/commits/${encodeURIComponent(revision ?? defaultBranch)}`,
				token,
			);
			const tree = yield* self.read(treeSchema, `/repos/${name}/git/trees/${commitSha}?recursive=1`, token);
			if (tree.truncated) {
				return yield* precondition('Repository tree truncated; discovery requires complete input');
			}
			const api = (path: string) => self.file(name, path, commitSha, token);
			const source: SnapshotSource = {
				repository: { id, name, defaultBranch },
				sha: commitSha,
				entries: tree.tree,
				read: hidden ? api : path =>
					rawFile(self.transport, name, commitSha, path).pipe(
						Effect.flatMap(Option.match({ onNone: () => api(path), onSome: Effect.succeed })),
					),
				tags: prefixes => self.tags(name, prefixes, token),
			};
			return source;
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
			if (parsed?.kind !== 'github') return yield* precondition('Invalid preset');
			const { repository: name, preset, ref } = parsed;
			const published = yield* rawPreset(self.transport, name, preset, ref);
			if (Option.isSome(published)) return published.value;
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
}

export interface Credentials {
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}
