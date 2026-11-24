import { Context, Effect, Layer, Schema } from 'effect';
import { Automation } from '@/automation/service.ts';
import { unchangedSince } from '@/automation/unchanged-paths.ts';
import { commitSchema, comparisonSchema, gitRefSchema } from '@/github/resources.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { releasePaths } from '@/release/domain/version.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

export interface RefHead {
	readonly ref: string;
	readonly sha: string;
	readonly tag: boolean;
}

function moved(execution: Execution, head: RefHead): string {
	const release = execution.operation === 'prepare' || execution.operation === 'promote' || execution.releaseSet;
	return `${head.ref} is at ${head.sha.slice(0, 12)} but this execution builds ${execution.sourceSha.slice(0, 12)}; ${
		release ? 'prepare the release again' : 'trigger the operation again'
	}`;
}

export class ReleaseCommits extends Context.Service<ReleaseCommits, {
	readonly contains: (execution: Execution, sha: string, token: string) => Effect.Effect<boolean, DomainError>;
	readonly head: (
		execution: Execution,
		token: string,
		observedRef?: string,
	) => Effect.Effect<RefHead | undefined, DomainError>;
	readonly moved: (
		execution: Execution,
		token: string,
		observedRef?: string,
	) => Effect.Effect<string | undefined, DomainError>;
}>()('beepboop/automation/ReleaseCommits') {
	static readonly layer = Layer.effect(
		ReleaseCommits,
		Effect.gen(function*() {
			const { gateway, store } = yield* Automation;
			const executions = yield* Executions;
			const versionKept = Effect.fnUntraced(function*(execution: Execution, sha: string) {
				const stream = execution.configuration.streams[execution.stream];
				const record = yield* store.repositories.get(execution.repositoryId);
				if (!stream || !record) return false;
				if (JSON.stringify(record.configuration?.streams[execution.stream]) !== JSON.stringify(stream)) return false;
				const paths = releasePaths(record.inventory.packages, stream);
				const kept = (commit: string) =>
					unchangedSince(gateway, execution.repository, execution.repositoryId, commit, sha, paths);
				const newer = (yield* executions.all).filter(other =>
					other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
					&& other.version === execution.version && other.createdAt > execution.createdAt
					&& other.state !== 'cancelled' && other.state !== 'failed'
				);
				for (const other of newer) if (yield* kept(other.sourceSha)) return false;
				return yield* kept(execution.sourceSha);
			});
			const contains = Effect.fnUntraced(function*(execution: Execution, sha: string, token: string) {
				if (sha === execution.sourceSha) return true;
				if (!execution.eventId.startsWith('observed:') && !execution.currentWorkflow) {
					const all = yield* executions.all;
					let promotion = execution.operation === 'promote'
						? execution
						: all.find(other => other.operation === 'promote' && other.dependencies.includes(execution.id));
					const pending = [...execution.dependencies];
					const visited = new Set<string>();
					while (!promotion && pending.length) {
						const id = pending.pop();
						if (id === undefined || visited.has(id)) continue;
						visited.add(id);
						const dependency = all.find(other => other.id === id);
						if (
							dependency?.state !== 'succeeded' || dependency.sourceSha !== execution.sourceSha
							|| dependency.configurationSha !== execution.configurationSha
							|| dependency.stream !== execution.stream || dependency.version !== execution.version
						) continue;
						if (dependency.operation === 'promote') promotion = dependency;
						else pending.push(...dependency.dependencies);
					}
					return promotion !== undefined && (yield* versionKept(promotion, sha));
				}
				const comparison = yield* gateway.read(
					comparisonSchema,
					`/repos/${execution.repository}/compare/${execution.sourceSha}...${sha}`,
					token,
				);
				return comparison.status === 'ahead';
			});
			const head = Effect.fnUntraced(function*(execution: Execution, token: string, observedRef?: string) {
				const configured = execution.workflow?.ref;
				if (configured === undefined) return undefined;
				const namespace = /^refs\/(heads|tags)\//.exec(configured)?.[1] ?? execution.refNamespace;
				const pattern = configured.replace(/^refs\/(heads|tags)\//, '');
				const patterned = /[*?[]/.test(pattern);
				const ref = patterned ? observedRef : pattern;
				if (!ref) return undefined;
				if (patterned || namespace !== undefined) {
					for (const candidate of namespace === undefined ? ['tags', 'heads'] : [namespace]) {
						const found = yield* gateway.read(
							Schema.NullOr(gitRefSchema),
							`/repos/${execution.repository}/git/ref/${candidate}/${encodeURIComponent(ref)}`,
							token,
						);
						if (found === null) continue;
						const target = yield* gateway.peelTag(execution.repository, found.object, token);
						return { ref, sha: target.sha, tag: candidate === 'tags' } satisfies RefHead;
					}
					return yield* precondition(`Workflow ref ${ref} no longer exists`);
				}
				const commit = yield* gateway.read(
					Schema.NullOr(commitSchema),
					`/repos/${execution.repository}/commits/${encodeURIComponent(ref)}`,
					token,
				);
				if (commit === null) return yield* precondition(`Workflow ref ${ref} no longer exists`);
				return { ref, sha: commit.sha, tag: false } satisfies RefHead;
			});
			return ReleaseCommits.of({
				contains,
				head,
				moved: Effect.fnUntraced(function*(execution: Execution, token: string, observedRef?: string) {
					const current = yield* head(execution, token, observedRef);
					if (!current) return undefined;
					if (current.tag) {
						if (current.sha === execution.sourceSha) return undefined;
						return `Tag ${current.ref} moved to ${current.sha.slice(0, 12)}; this release builds ${
							execution.sourceSha.slice(0, 12)
						}`;
					}
					if (yield* contains(execution, current.sha, token)) return undefined;
					if (!execution.eventId.startsWith('observed:')) return moved(execution, current);
					return `${current.ref} at ${current.sha.slice(0, 12)} no longer contains ${execution.sourceSha.slice(0, 12)}`;
				}),
			});
		}),
	);
}
