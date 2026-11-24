import { Context, Effect, Layer } from 'effect';
import { Automation } from '@/automation/service.ts';
import { unchangedSince } from '@/automation/unchanged-paths.ts';
import { comparisonSchema } from '@/github/resources.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { releasePaths } from '@/release/domain/version.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

export class ReleaseCommits extends Context.Service<ReleaseCommits, {
	readonly contains: (execution: Execution, sha: string, token: string) => Effect.Effect<boolean, DomainError>;
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
			return ReleaseCommits.of({
				contains: Effect.fnUntraced(function*(execution: Execution, sha: string, token: string) {
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
				}),
			});
		}),
	);
}
