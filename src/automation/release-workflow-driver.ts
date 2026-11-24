import { Effect } from 'effect';
import { CoordinatorClient } from '@/automation/coordinator-client.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export interface ReleaseSteps {
	readonly run: <A extends Rpc.Serializable<A>>(
		name: string,
		work: Effect.Effect<A, DomainError>,
	) => Effect.Effect<A, DomainError>;
	readonly sleep: (name: string, milliseconds: number) => Effect.Effect<void, DomainError>;
	readonly wait: (name: string, type: string) => Effect.Effect<void, DomainError>;
}

export interface ReleaseRun {
	readonly repositoryId: number;
	readonly preparationId: string;
	readonly workflowId: string;
}

export function roundName(name: string, round: number): string {
	return round === 1 ? name : `${name} ${round}`;
}

export function untilSlotHeld(
	reserve: (round: number) => Effect.Effect<number, DomainError>,
	sleep: (round: number, wait: number) => Effect.Effect<void, DomainError>,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		for (let round = 1;; round++) {
			const wait = yield* reserve(round);
			if (wait <= 0) return;
			yield* sleep(round, wait);
		}
	});
}

export const driveRelease = Effect.fnUntraced(function*(steps: ReleaseSteps, release: ReleaseRun) {
	const client = yield* CoordinatorClient;
	const { repositoryId, preparationId, workflowId } = release;
	const operations = yield* steps.run(
		'Load release operations',
		client.releaseOperations(repositoryId, preparationId, workflowId),
	);
	const pending = new Map<string, Effect.Effect<void, DomainError>>();
	const advance = (id: string, label: string): Effect.Effect<void, DomainError> =>
		Effect.gen(function*() {
			for (let attempt = 0;; attempt++) {
				// The journal records dispatch intent before GitHub is called. Replaying this
				// RPC reconciles that intent rather than issuing another dispatch.
				const state = yield* steps.run(
					`${label}: reconcile ${attempt}`,
					client.advanceReleaseOperation(repositoryId, preparationId, workflowId, id),
				);
				if (state === 'succeeded') return;
				const delay = yield* steps.run(
					`${label}: delay ${attempt}`,
					client.operationDelay(repositoryId, preparationId, workflowId, id),
				);
				if (delay > 0) {
					yield* steps.sleep(`${label}: deferred ${attempt}`, delay);
					continue;
				}
				// Events are hints; the journal, never the event payload, decides progress.
				yield* steps.wait(`${label}: wait ${attempt}`, id);
			}
		});
	const run = (id: string): Effect.Effect<void, DomainError> =>
		Effect.gen(function*() {
			const existing = pending.get(id);
			if (existing) return yield* existing;
			const operation = operations.find(operation => operation.id === id);
			if (!operation) return yield* Effect.die(new Error('Release dependency is missing'));
			const once = yield* Effect.cached(Effect.gen(function*() {
				yield* Effect.forEach(operation.dependencies, run, { concurrency: 'unbounded', discard: true });
				if (operation.paced) {
					yield* untilSlotHeld(
						round =>
							steps.run(
								roundName(`${operation.operation}: reserve`, round),
								client.reservePublication(repositoryId, preparationId, workflowId, id),
							),
						(round, wait) => steps.sleep(roundName(`${operation.operation}: paced`, round), wait),
					);
				}
				yield* advance(id, operation.operation);
			}));
			pending.set(id, once);
			return yield* once;
		});
	yield* Effect.forEach(operations, operation => run(operation.id), { concurrency: 'unbounded', discard: true });
	yield* steps.run('Complete release', client.completeReleaseWorkflow(repositoryId, preparationId, workflowId));
	return { preparationId, operations: operations.map(operation => operation.id) };
}, (effect, steps, release) =>
	effect.pipe(
		Effect.withSpan('release.coordinate', { attributes: { ...release } }),
		Effect.annotateLogs({ ...release }),
		Effect.tapCause(() =>
			Effect.flatMap(CoordinatorClient, client =>
				steps.run(
					'Record coordination failure',
					client.releaseWorkflowInterrupted(release.repositoryId, release.preparationId, release.workflowId),
				))
		),
	));
