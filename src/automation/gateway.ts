import { Effect, Exit } from 'effect';
import type { RefState } from '@/domain/refs.ts';
import { workflowRun } from '@/github/actions.ts';
import type { BotIdentity, GitHubApp, InstallationState } from '@/github/app.ts';
import { makeGitHubApp, missingInstallationPermissions } from '@/github/app.ts';
import { downloadWorkflowArtifact } from '@/github/artifacts.ts';
import type { RevisionFiles, SnapshotSource } from '@/github/contents.ts';
import { loadPreset, readFile, revisionFiles, snapshotSource } from '@/github/contents.ts';
import { ensureIssue, mergeCommit } from '@/github/issues.ts';
import { copyReleaseAsset } from '@/github/releases.ts';
import { contains, defaultRevision, repositoryId } from '@/github/repositories.ts';
import type { GitObject } from '@/github/resources.ts';
import type { TagRequest } from '@/github/tags.ts';
import { createTag, peelTag, tagRefs } from '@/github/tags.ts';
import { GitHubRejection, GitHubTransport, gitHubRequest } from '@/github/transport.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { decode } from '@/kernel/schema/result.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import type { VerificationContext } from '@/publication/registries/context.ts';

type Permission = Record<string, 'read' | 'write'>;
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
		const sent = this.api
			? this.api.call(path, token, method, body, readOnlyGraphql)
			: gitHubRequest(this.transport, path, token, method, body, readOnlyGraphql);
		return sent.pipe(
			Effect.tapError(error =>
				error instanceof GitHubRejection && error.status === 401 ? this.app.rejected(token) : Effect.void
			),
		);
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
		return this.token(name, id, { issues: 'write' }).pipe(
			Effect.flatMap(token => ensureIssue(this, name, token, issue)),
		);
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
		return this.token(name, id, { contents: 'read' }).pipe(Effect.flatMap(token => defaultRevision(this, name, token)));
	}
	revisionFiles(name: string, id: number, sha: string): Effect.Effect<RevisionFiles, DomainError> {
		return this.token(name, id, { contents: 'read' }).pipe(
			Effect.flatMap(token => revisionFiles(this, name, sha, token)),
		);
	}
	workflowRun(name: string, id: number, runId: number): Effect.Effect<{ title: string; path: string }, DomainError> {
		return this.token(name, id, { actions: 'read' }).pipe(
			Effect.flatMap(token => workflowRun(this, { name, id }, runId, token)),
		);
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
		return this.token(name, undefined).pipe(Effect.flatMap(token => repositoryId(this, name, token)));
	}
	file(name: string, path: string, ref: string, token: string): Effect.Effect<string | null, DomainError> {
		return readFile(this, name, path, ref, token);
	}
	snapshotSource(name: string, id: number, revision?: string): Effect.Effect<SnapshotSource, DomainError> {
		return this.token(name, id).pipe(
			Effect.flatMap(token => snapshotSource(this, this.transport, { name, id, revision }, token)),
		);
	}
	preset(reference: string): Effect.Effect<{ value: unknown; sha: string }, DomainError> {
		return loadPreset(this, this.transport, reference);
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
		return this.token(repository, repositoryId, { contents: 'read' }).pipe(
			Effect.flatMap(token => contains(this, repository, commit, target, token)),
		);
	}
	mergeCommit(
		repository: string,
		number: string,
		token: string,
	): Effect.Effect<string | undefined, DomainError> {
		return mergeCommit(this, repository, number, token);
	}
}

export interface Credentials {
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}
