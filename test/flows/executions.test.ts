import { expect, setSystemTime, test } from 'bun:test';
import { MemoryStorage } from '@root/test/support/do-storage.ts';
import { Effect, Exit, Layer } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { ProjectionSink } from '@/persistence/durable/journal.ts';
import { decodeExecutionV1 } from '@/release/domain/execution/codec-v1.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import type { ExecutionCommitted } from '@/release/services/coordinator/executions.ts';
import { Executions, RepositoryRevisions } from '@/release/services/coordinator/executions.ts';
import type { CoordinatorServices } from '@/release/services/coordinator/layer.ts';
import { coordinatorLayer } from '@/release/services/coordinator/layer.ts';
import { AuditTrail } from '@/release/services/coordinator/retry-queue.ts';

const now = 1_000_000;
type Audited = [string, string, string];

function execution(id: string, fields: Partial<Execution> = {}): Execution {
	return {
		...decodeExecutionV1({
			id,
			repositoryId: 1,
			repository: 'octo/widget',
			stream: 'main',
			version: '1.0.0',
			configurationSha: 'configuration',
			sourceSha: 'source',
			eventId: `manual-${id}`,
			configuration: {
				extends: [],
				managers: ['npm'],
				subscriptions: [],
				streams: {
					main: {
						required: [],
						versioning: 'workspace',
						concurrency: 'queue',
						prepare: { version: 'manual' },
						promote: { approval: 'required' },
						workflows: {},
						credentials: [],
						channels: { stable: 'latest', prerelease: 'next' },
					},
				},
			},
			publications: [],
			operation: 'prepare',
			presetShas: {},
			dependencies: [],
			attempts: 0,
			artifacts: [],
			createdAt: 1,
			updatedAt: 1,
			state: 'ready',
		}),
		...fields,
	};
}

function run<A, E>(memory: MemoryStorage, audited: Audited[], work: Effect.Effect<A, E, CoordinatorServices>) {
	const ports = Layer.mergeAll(
		Layer.succeed(ProjectionSink, { apply: () => Effect.void }),
		Layer.succeed(AuditTrail, {
			record: (action, target, failure) =>
				Effect.sync(() => {
					audited.push([action, target, failure]);
				}),
		}),
		Layer.succeed(RepositoryRevisions, { get: () => Effect.undefined }),
	);
	setSystemTime(new Date(now));
	return Effect.runPromiseExit(work.pipe(Effect.provide(coordinatorLayer(memory).pipe(Layer.provide(ports)))))
		.finally(() => setSystemTime());
}

test('putting an execution stamps it, asks for a reconcile within fifteen seconds, then tells each listener in order', async () => {
	const memory = new MemoryStorage();
	await memory.put('reconcile-at', now + 60_000);
	const heard: string[] = [];
	const listener = (name: string) => ({ execution, previous }: ExecutionCommitted) =>
		Effect.sync(() => {
			heard.push(`${name} ${execution.state} after ${previous?.state ?? 'nothing'}`);
		});
	const first = execution('a');
	const exit = await run(
		memory,
		[],
		Effect.gen(function*() {
			const executions = yield* Executions;
			yield* executions.onCommitted(listener('first'));
			yield* executions.onCommitted(listener('second'));
			yield* executions.put(first);
			yield* executions.put({ ...first, state: 'running' });
			return yield* executions.get('a');
		}),
	);
	expect(exit).toEqual(Exit.succeed(expect.objectContaining({ id: 'a', state: 'running', updatedAt: now })));
	expect(first.updatedAt).toBe(now);
	expect(heard).toEqual([
		'first ready after nothing',
		'second ready after nothing',
		'first running after ready',
		'second running after ready',
	]);
	expect(memory.snapshot().get('reconcile-at')).toBe(now + 15_000);
});

test('putting a release set member wakes its release workflow once per change and keeps its member list', async () => {
	const memory = new MemoryStorage();
	await memory.put('release-wake:p', { members: ['b'], due: 5 });
	const releaseSet = { preparationId: 'p', group: 'g', required: [], workflowId: 'w' };
	const exit = await run(
		memory,
		[],
		Effect.gen(function*() {
			const executions = yield* Executions;
			yield* executions.put(execution('a', { releaseSet }));
			const woken = memory.snapshot().get('release-wake:p');
			yield* Effect.promise(() => memory.put('release-wake:p', { due: 1 }));
			yield* executions.put(yield* executions.get('a'));
			return [woken, memory.snapshot().get('release-wake:p')];
		}),
	);
	expect(exit).toEqual(Exit.succeed([{ members: ['b', 'a'], due: now }, { due: 1 }]));
	expect(memory.snapshot().has('reconcile-at')).toBe(false);
});

test('an execution that moves on drops the reason it carried, and isolating it records one reason', async () => {
	const memory = new MemoryStorage();
	const audited: Audited[] = [];
	const failure = precondition('the registry refused');
	const exit = await run(
		memory,
		audited,
		Effect.gen(function*() {
			const executions = yield* Executions;
			yield* executions.put(execution('a', { state: 'dispatching', reason: 'Waiting for a runner' }));
			yield* executions.put({ ...(yield* executions.get('a')), state: 'running' });
			const moved = (yield* executions.get('a')).reason;
			yield* executions.isolate('a', failure);
			const isolated = yield* executions.get('a');
			yield* executions.isolate('a', failure);
			return { moved, reason: isolated.reason, again: (yield* executions.get('a')).updatedAt === isolated.updatedAt };
		}),
	);
	expect(exit).toEqual(
		Exit.succeed({ moved: undefined, reason: 'Beepboop could not continue: the registry refused', again: true }),
	);
	expect(audited).toEqual([]);
});

test('isolating an execution that cannot be written quarantines it and audits the quarantine', async () => {
	const memory = new MemoryStorage();
	const audited: Audited[] = [];
	const exit = await run(
		memory,
		audited,
		Executions.use(executions => executions.isolate('missing', precondition('the registry refused'))),
	);
	expect(exit).toEqual(Exit.void);
	expect(memory.snapshot().get('quarantine:missing')).toEqual({ error: 'Unknown execution', at: now });
	expect(audited).toEqual([[
		'execution.quarantined',
		'missing: Unknown execution',
		'quarantine.audit-failed',
	]]);
});

test('reading the journal keeps unreadable executions apart, and getting a missing one is refused', async () => {
	const memory = new MemoryStorage();
	await memory.put({ 'execution:a': execution('a'), 'execution:b': { id: 'b', state: 'exploded' } });
	const exit = await run(
		memory,
		[],
		Effect.gen(function*() {
			const executions = yield* Executions;
			const read = yield* executions.read;
			return {
				readable: read.executions.map(entry => entry.id),
				unreadable: read.unreadable.map(entry => entry.id),
				all: (yield* executions.all).map(entry => entry.id),
				missing: yield* Effect.flip(executions.get('z')),
			};
		}),
	);
	expect(exit).toEqual(Exit.succeed({
		readable: ['a'],
		unreadable: ['b'],
		all: ['a'],
		missing: precondition('Unknown execution'),
	}));
});

test('a failing listener fails the put after the commit and stops the listeners after it', async () => {
	const memory = new MemoryStorage();
	const heard: string[] = [];
	const failure = precondition('release event refused');
	const exit = await run(
		memory,
		[],
		Effect.gen(function*() {
			const executions = yield* Executions;
			yield* executions.onCommitted(() => Effect.fail(failure));
			yield* executions.onCommitted(({ execution }) =>
				Effect.sync(() => {
					heard.push(execution.id);
				})
			);
			return yield* Effect.flip(executions.put(execution('a')));
		}),
	);
	expect(exit).toEqual(Exit.succeed(failure));
	expect(heard).toEqual([]);
	expect(memory.snapshot().has('execution:a')).toBe(true);
});

test('only a succeeded observed run with a waiting operation has continuations, and they need the repository', async () => {
	const memory = new MemoryStorage();
	const base = execution('o', { state: 'succeeded', eventId: 'observed:push:1', operation: 'prepare' });
	const main = base.configuration.streams.main;
	if (!main) throw new Error('No main stream');
	const publish = { file: 'publish.yml', inputs: {}, required: true, needs: ['prepare'] };
	const observed: Execution = {
		...base,
		configuration: { ...base.configuration, streams: { main: { ...main, workflows: { publish } } } },
	};
	const exit = await run(
		memory,
		[],
		Effect.gen(function*() {
			const executions = yield* Executions;
			return {
				pending: yield* executions.pendingContinuations(observed),
				running: yield* executions.pendingContinuations({ ...observed, state: 'running' }),
				manual: yield* executions.pendingContinuations({ ...observed, eventId: 'manual-o' }),
				refused: yield* Effect.flip(executions.continuations(observed)),
			};
		}),
	);
	expect(exit).toEqual(Exit.succeed({
		pending: ['publish'],
		running: [],
		manual: [],
		refused: precondition('Repository unavailable while completing observed operation'),
	}));
});
