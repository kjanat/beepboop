import { Effect, Exit, Option, Schema } from 'effect';
import { rawFile, rawPreset } from '@/automation/github-raw';
import type { Snapshot } from '@/domain/inventory.ts';
import { parsePresetReference } from '@/domain/preset.ts';
import type { RefState } from '@/domain/refs.ts';
import type { BotIdentity, GitHubApp, InstallationState } from '@/github/app.ts';
import { makeGitHubApp, missingInstallationPermissions } from '@/github/app.ts';
import { downloadWorkflowArtifact } from '@/github/artifacts.ts';
import { copyReleaseAsset } from '@/github/releases.ts';
import type { GitObject } from '@/github/resources.ts';
import {
	commitSchema,
	comparisonSchema,
	contentSchema,
	issueEventSchema,
	matchingRefSchema,
	repositorySchema,
	treeSchema,
	workflowRunSchema,
} from '@/github/resources.ts';
import type { TagRequest } from '@/github/tags.ts';
import { createTag, peelTag, tagRefs } from '@/github/tags.ts';
import { GitHubTransport, gitHubRequest } from '@/github/transport.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { ioConcurrency } from '@/kernel/http/retry.ts';
import { decode, sha } from '@/kernel/schema/result.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableArray } from '@/kernel/schema/structs.ts';

type Permission = Record<string, 'read' | 'write'>;
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
		credentials: Credentials,
		ownerId: number,
		private transport: Fetcher = platformFetch,
		readonly defer?: (work: Promise<void>) => void,
		private api?: GitHubTransport['Service'],
		private app: GitHubApp['Service'] = Effect.runSync(makeGitHubApp(credentials, ownerId)),
	) {}
	private readonly requests = GitHubTransport.of({
		call: (path, token, method, body, readOnlyGraphql) => this.call(path, token, method, body, readOnlyGraphql),
	});
	private viaGateway<A>(work: Effect.Effect<A, DomainError, GitHubTransport>): Effect.Effect<A, DomainError> {
		return Effect.provideService(work, GitHubTransport, this.requests);
	}
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
		return this.viaGateway(this.app.installationToken(name, id, permissions));
	}
	mintToken(name: string, id: number, permissions: Permission): Effect.Effect<string, DomainError> {
		return this.viaGateway(this.app.mintToken(name, id, permissions));
	}
	readonly appPage: Effect.Effect<string, DomainError> = Effect.suspend(() => this.viaGateway(this.app.appPage));
	readonly botIdentity: Effect.Effect<BotIdentity, DomainError> = Effect.suspend(() =>
		this.viaGateway(this.app.botIdentity)
	);
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
	installation(name: string): Effect.Effect<InstallationState, DomainError> {
		return this.viaGateway(this.app.installation(name));
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
	ownerLogin(): Effect.Effect<string, DomainError> {
		return this.viaGateway(this.app.ownerLogin);
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
