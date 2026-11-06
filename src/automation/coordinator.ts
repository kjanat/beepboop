import { DurableObject } from 'cloudflare:workers';
import { Effect, Semaphore } from 'effect';
import { z } from 'zod';
import type { WorkflowIdentity } from '@/automation/auth';
import {
	completion,
	createExecution,
	dependenciesReady,
	expectedRunTitle,
	mergePublications,
	runTitle,
	validatePublicationIdentity,
} from '@/automation/execution';
import { RepositoryGateway } from '@/automation/github';
import {
	artifactSchema,
	checkRunsSchema,
	commitSchema,
	commitStatusSchema,
	dispatchSchema,
	type GitHubRelease,
	gitRefSchema,
	gitTagSchema,
	releaseSchema,
	workflowRunSchema,
	workflowRunsSchema,
} from '@/automation/github-resources';
import { type InboxEvent, inboxEntry } from '@/automation/inbox';
import { canVerifyPublication, discover, observedVersion, verifyPublication } from '@/automation/managers';
import { tagPrefix } from '@/automation/managers/tags';
import { verifyManifest } from '@/automation/manifest';
import { mergeArtifacts, resolveInputs } from '@/automation/outputs';
import {
	identifyExecution,
	matchesPackage,
	matchesPublication,
	packageId,
	parseIdentity,
	publicationIdentity,
	selectorKey,
} from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { matchesRef } from '@/automation/policy';
import type { PublishBudget } from '@/automation/publish-budget';
import { planRefs, type RefPlan } from '@/automation/refs';
import { compileReleaseSet } from '@/automation/release-set';
import { manifestProblems } from '@/automation/release-version';
import type { ReleaseWorkflowParams } from '@/automation/release-workflow';
import { type AutomationBindings, AutomationService } from '@/automation/service';
import { maintainSetup } from '@/automation/setup-maintenance';
import type { SetupEdit } from '@/automation/setup-types';
import { decodeError, Store } from '@/automation/store';
import type { Artifact, AutomationEvent, Edit, Execution, Publication, ReleaseReference } from '@/automation/types';
import { type DomainError, precondition } from '@/contract/errors';
import { defaultTagPolicy, isPrerelease, semVer, tagFor } from '@/contract/version';
import { readiness } from '@/domain/repository';
import { fromPromise, fromSync, recover, retryable, toDomainError } from '@/failure';
import { sha } from '@/model';
import { decodeEventV1, decodeExecutionV1, decodeSetupEditV1 } from '@/persistence/codecs/v1';
import type { SqlDatabase } from '@/persistence/d1/database';
import { ProjectionStore } from '@/persistence/d1/projection';
import { executionId, releaseEventId } from '@/persistence/identity-keys';
import { type Committed, earliest, Journal } from '@/persistence/journal';

export interface CoordinatorBindings extends AutomationBindings {
	DB: SqlDatabase;
	OWNER_ID: string;
	RELEASE_WORKFLOW: Workflow<ReleaseWorkflowParams>;
	PUBLISH_BUDGET: DurableObjectNamespace<PublishBudget>;
}
interface ReleaseSetRecord {
	target: string;
	ids: string[];
	workflowId?: string;
	started?: boolean;
	completed?: boolean;
}
interface ReleaseOperation {
	id: string;
	operation: string;
	paced: boolean;
	dependencies: string[];
}
const releaseSetRecord: z.ZodType<ReleaseSetRecord> = z.object({
	target: z.string(),
	ids: z.array(z.string()),
	workflowId: z.string().optional(),
	started: z.boolean().optional(),
	completed: z.boolean().optional(),
});
const observation = z.object({
	repositoryId: z.number(),
	runId: z.number(),
	due: z.number().optional(),
	attempts: z.number().int().nonnegative().optional(),
	error: z.string().optional(),
});
const releaseWake = z.union([
	z.literal(true),
	z.object({ members: z.array(z.string()).optional(), due: z.number() }),
]);
type ReleaseWake = z.output<typeof releaseWake>;
const reconcileDue = z.number().nullable();
const inboxAttempts = 8;
const access = z.object({ suspended: z.boolean() });
const reconcileInterval = 60_000;
const settleInterval = 15_000;
const projectionRetry = 10_000;
function wakeDue(wake: ReleaseWake): number {
	return wake === true ? 0 : wake.due;
}
function wakeMembers(wake: ReleaseWake | undefined, member: string): string[] | undefined {
	if (wake === undefined) return [member];
	if (wake === true || wake.members === undefined) return undefined;
	return [...new Set([...wake.members, member])];
}
function githubRelease(execution: Execution): { tag: string; prerelease: boolean } | undefined {
	if (!execution.version) return undefined;
	const version = semVer.parse(execution.version);
	return { tag: tagFor(execution.workflow?.refs ?? defaultTagPolicy, version), prerelease: isPrerelease(version) };
}
function publishesGithubRelease(execution: Execution): boolean {
	const key = selectorKey(`github-release:${execution.repository}`);
	return execution.workflow?.publications?.some(id => selectorKey(id) === key) ?? false;
}
function moved(execution: Execution, head: { ref: string; sha: string }): string {
	const release = execution.operation === 'prepare' || execution.operation === 'promote' || execution.releaseSet;
	return `${head.ref} is at ${head.sha.slice(0, 12)} but this execution builds ${execution.sourceSha.slice(0, 12)}; ${
		release ? 'prepare the release again' : 'trigger the operation again'
	}`;
}
function verifying(publication: Publication): boolean {
	return canVerifyPublication(publication.manager) && ['pending', 'uncertain'].includes(publication.outcome);
}
export class AutomationCoordinator extends DurableObject<CoordinatorBindings> {
	private readonly lock = Semaphore.makeUnsafe(1);
	private readonly journal = new Journal(this.ctx.storage);
	private projectionRetryAt: number | undefined;
	private serialized<A>(work: Effect.Effect<A, DomainError>): Effect.Effect<A, DomainError> {
		return Semaphore.withPermit(
			this.lock,
			Effect.exit(work).pipe(Effect.flatMap(exit => this.settle().pipe(Effect.andThen(exit)))),
		);
	}
	private serial<A>(work: Effect.Effect<A, DomainError>): Promise<A> {
		return Effect.runPromise(this.serialized(work));
	}
	private read(key: string): Effect.Effect<unknown, DomainError> {
		return fromPromise(() => this.ctx.storage.get(key));
	}
	private list(options: DurableObjectListOptions): Effect.Effect<Map<string, unknown>, DomainError> {
		return fromPromise(() => this.ctx.storage.list(options));
	}
	private write(key: string, value: unknown): Effect.Effect<void, DomainError> {
		return fromPromise(() => this.ctx.storage.put(key, value));
	}
	private writeAll(entries: Record<string, unknown>): Effect.Effect<void, DomainError> {
		return fromPromise(() => this.ctx.storage.put(entries));
	}
	private remove(key: string): Effect.Effect<void, DomainError> {
		return fromPromise(() => this.ctx.storage.delete(key)).pipe(Effect.asVoid);
	}
	private commit(
		entries: readonly [Committed, ...Committed[]],
		extra?: Record<string, unknown>,
	): Effect.Effect<void, DomainError> {
		return this.journal.commit(entries, extra);
	}
	private arm(at: number | undefined): Effect.Effect<void, DomainError> {
		return this.journal.arm(at);
	}
	private settle(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* this.project();
			yield* this.arm(yield* this.nextAlarm());
		});
	}
	private project(): Effect.Effect<void> {
		return this.journal.drain(rows => new ProjectionStore(this.env.DB).apply(rows)).pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					this.projectionRetryAt = undefined;
				})
			),
			recover(error =>
				Effect.sync(() => {
					this.projectionRetryAt = Date.now() + projectionRetry;
					console.error(JSON.stringify({ event: 'projection.failed', error: decodeError(error) }));
				})
			),
		);
	}
	private nextAlarm(): Effect.Effect<number | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const now = Date.now();
			const wakes = [...(yield* this.list({ prefix: 'release-wake:' })).values()].map(value => {
				const wake = releaseWake.safeParse(value);
				return wake.success ? wakeDue(wake.data) : now;
			});
			const observations = [...(yield* this.list({ prefix: 'observe:' })).values()].map(value =>
				observation.safeParse(value).data?.due ?? now
			);
			const inbox = [...(yield* this.list({ prefix: 'inbox:' })).values()].map(value =>
				inboxEntry.safeParse(value).data?.due ?? now
			);
			const pending = yield* this.journal.pending();
			const reconcileAt = yield* this.reconcileAt();
			const setupEdit = yield* this.setupEdit();
			return earliest([
				pending ? (this.projectionRetryAt ?? now) : undefined,
				reconcileAt,
				setupEdit?.due,
				...wakes,
				...observations,
				...inbox,
			]);
		});
	}
	private reconcileAt(): Effect.Effect<number | undefined, DomainError> {
		return this.read('reconcile-at').pipe(
			Effect.map(value => {
				const parsed = reconcileDue.safeParse(value);
				return parsed.success ? (parsed.data ?? undefined) : undefined;
			}),
		);
	}
	private requestReconcile(at: number): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const current = yield* this.reconcileAt();
			if (current === undefined || current > at) yield* this.write('reconcile-at', at);
		});
	}
	private store(): Store {
		return new Store(this.env.DB);
	}
	protected gateway(): RepositoryGateway {
		return new RepositoryGateway(this.env, Number(this.env.OWNER_ID));
	}
	private readJournal(): Effect.Effect<
		{ executions: Execution[]; unreadable: { id: string; error: string }[] },
		DomainError
	> {
		return this.list({ prefix: 'execution:' }).pipe(Effect.map(entries => {
			const executions: Execution[] = [];
			const unreadable: { id: string; error: string }[] = [];
			for (const [key, value] of entries) {
				try {
					executions.push(decodeExecutionV1(value));
				} catch (error) {
					unreadable.push({ id: key.slice('execution:'.length), error: decodeError(error) });
				}
			}
			return { executions, unreadable };
		}));
	}
	private executions(): Effect.Effect<Execution[], DomainError> {
		return this.readJournal().pipe(Effect.map(journal => journal.executions));
	}
	private auditQuietly(action: string, target: string, failure: string): Effect.Effect<void> {
		return this.store().audit('beepboop', action, target).pipe(
			recover(error =>
				Effect.sync(() => console.error(JSON.stringify({ event: failure, target, error: decodeError(error) })))
			),
		);
	}
	private quarantine(id: string, error: string): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* this.write(`quarantine:${id}`, { error, at: Date.now() });
			yield* this.auditQuietly('execution.quarantined', `${id}: ${error}`, 'quarantine.audit-failed');
		});
	}
	private isolate(id: string, error: DomainError): Effect.Effect<void, DomainError> {
		const reason = `Beepboop could not continue: ${decodeError(error)}`;
		return Effect.gen({ self: this }, function*() {
			const current = yield* this.get(id);
			if (current.reason !== reason) yield* this.put({ ...current, reason });
		}).pipe(recover(failure => this.quarantine(id, decodeError(failure))));
	}
	private stored(id: string): Effect.Effect<Execution | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const value = yield* this.read(`execution:${id}`);
			return value === undefined ? undefined : yield* fromSync(() => decodeExecutionV1(value));
		});
	}
	private releaseSet(key: string): Effect.Effect<ReleaseSetRecord | undefined, DomainError> {
		return this.read(key).pipe(Effect.flatMap(value => fromSync(() => releaseSetRecord.optional().parse(value))));
	}
	private put(execution: Execution): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			Object.assign(execution, identifyExecution(execution));
			const previous = yield* this.stored(execution.id);
			if (
				previous && previous.state !== execution.state && ['running', 'succeeded'].includes(execution.state)
				&& execution.reason === previous.reason
			) {
				delete execution.reason;
			}
			const now = Date.now();
			execution.updatedAt = now;
			const extra: Record<string, unknown> = {};
			const set = execution.releaseSet;
			if (!set?.workflowId) {
				const current = yield* this.reconcileAt();
				extra['reconcile-at'] = Math.min(current ?? Number.POSITIVE_INFINITY, now + settleInterval);
			} else if (JSON.stringify({ ...previous, updatedAt: 0 }) !== JSON.stringify({ ...execution, updatedAt: 0 })) {
				const key = `release-wake:${set.preparationId}`;
				const members = wakeMembers(releaseWake.safeParse(yield* this.read(key)).data, execution.id);
				extra[key] = { ...(members ? { members } : {}), due: now };
			}
			yield* this.commit(
				[{ entity: 'execution', id: execution.id, repositoryId: execution.repositoryId, value: execution }],
				extra,
			);
			if (execution.state === 'succeeded') yield* this.captureReleaseEvent(execution);
		});
	}
	private putReleaseSet(preparationId: string, record: ReleaseSetRecord): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const preparation = yield* this.get(preparationId);
			yield* this.commit([
				{ entity: 'release-set', id: preparationId, repositoryId: preparation.repositoryId, value: record },
			]);
		});
	}
	private captureReleaseEvent(execution: Execution): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (!execution.version) return;
			const required = execution.releaseSet?.required ?? execution.configuration.streams[execution.stream]?.required
				?? [];
			if (!required.length) return;
			const id = releaseEventId({ ...execution, version: execution.version });
			if (yield* this.read(`release-emitted:${id}`)) return;
			const group = (yield* this.executions())
				.filter(e =>
					e.state === 'succeeded' && e.stream === execution.stream && e.version === execution.version
					&& e.sourceSha === execution.sourceSha && e.configurationSha === execution.configurationSha
					&& e.releaseSet?.preparationId === execution.releaseSet?.preparationId
					&& e.releaseSet?.group === execution.releaseSet?.group
				);
			if (
				!required.every(key =>
					group.some(e => e.publications.some(p => matchesPublication(key, p) && p.outcome === 'succeeded'))
				)
			) {
				return;
			}
			const references = group.flatMap(e => e.release ? [e.release] : []);
			if (references.some(r => r.tag !== references[0]?.tag || r.releaseId !== references[0]?.releaseId)) {
				return yield* precondition('Conflicting release identities');
			}
			const release: ReleaseReference = {
				id,
				...(execution.releaseSet ? { group: execution.releaseSet.group } : {}),
				repository: { id: execution.repositoryId, name: execution.repository },
				stream: execution.stream,
				commit: execution.sourceSha,
				version: execution.version,
				...(references[0]?.tag ? { tag: references[0].tag, releaseId: references[0].releaseId } : {}),
				publications: yield* mergePublications([], group.flatMap(e => e.publications)),
				artifacts: [...new Map(group.flatMap(e => e.artifacts).map(a => [a.id, a])).values()],
			};
			const event: AutomationEvent = {
				id,
				source: execution.repository,
				event: 'release',
				version: execution.version,
				release,
			};
			yield* this.commit([{ entity: 'release', id, repositoryId: execution.repositoryId, value: event }], {
				[`release-event:${id}`]: event,
				[`release-emitted:${id}`]: true,
			});
		});
	}
	execution(id: string): Promise<Execution | undefined> {
		return Effect.runPromise(this.stored(id));
	}
	preparationResults(stream: string, version: string): Promise<{ url: string; head: string }[]> {
		return Effect.runPromise(
			this.executions().pipe(Effect.map(executions =>
				executions.flatMap(execution => {
					const result = execution.prepared?.result ?? execution.managed?.result;
					return result && execution.stream === stream && execution.version === version
							&& execution.state === 'succeeded'
						? [result]
						: [];
				})
			)),
		);
	}
	reindex(repositoryId: number): Promise<number> {
		return this.serial(this.journal.reindex(repositoryId));
	}
	setAccess(suspended: boolean): Promise<void> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const prior = access.safeParse(yield* this.read('access'));
			yield* this.write('access', { suspended });
			if (prior.success && prior.data.suspended && !suspended) yield* this.wakeUp();
		}));
	}
	private suspended(repositoryId: number): Effect.Effect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const copy = access.safeParse(yield* this.read('access'));
			if (copy.success) return copy.data.suspended;
			const stored = yield* this.store().repository(repositoryId);
			const suspended = stored !== undefined && readiness(stored).kind === 'suspended';
			yield* this.write('access', { suspended });
			return suspended;
		});
	}
	exportJournal(): Promise<{ key: string; value: unknown }[]> {
		return Effect.runPromise(
			this.list({}).pipe(Effect.map(entries => [...entries].map(([key, value]) => ({ key, value })))),
		);
	}
	releaseEvents(): Promise<AutomationEvent[]> {
		return Effect.runPromise(
			this.list({ prefix: 'release-event:', limit: 100 }).pipe(
				Effect.flatMap(entries => fromSync(() => [...entries.values()].map(decodeEventV1))),
			),
		);
	}
	acknowledgeReleaseEvent(id: string): Promise<void> {
		return Effect.runPromise(this.remove(`release-event:${id}`));
	}
	/** Persist wake-ups separately so failed delivery survives Worker restarts. */
	private wakeReleaseWorkflows(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const wakes: Record<string, unknown> = {};
			for (const [key, value] of yield* this.list({ prefix: 'release-set:' })) {
				const release = yield* fromSync(() => releaseSetRecord.parse(value));
				if (!release.workflowId || release.completed) continue;
				wakes[`release-wake:${key.slice('release-set:'.length)}`] = { due: Date.now() };
			}
			if (Object.keys(wakes).length) yield* this.writeAll(wakes);
		});
	}
	private deliverReleaseWake(
		preparationId: string,
		release: ReleaseSetRecord & { workflowId: string },
		wake: ReleaseWake,
	): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const binding = this.env.RELEASE_WORKFLOW;
			const workflowId = release.workflowId;
			if (!release.started) {
				const preparation = yield* this.get(preparationId);
				yield* fromPromise(() =>
					binding.create({
						id: workflowId,
						params: { repositoryId: preparation.repositoryId, preparationId },
					})
				).pipe(
					// A create response can be lost after Cloudflare accepts the instance.
					Effect.catch(error =>
						fromPromise(() => binding.get(workflowId)).pipe(
							Effect.flatMap(instance => fromPromise(() => instance.status())),
							Effect.mapError(() => error),
						)
					),
				);
				release.started = true;
				yield* this.putReleaseSet(preparationId, release);
			}
			const instance = yield* fromPromise(() => binding.get(workflowId));
			const status = yield* fromPromise(() => instance.status());
			if (['errored', 'terminated'].includes(status.status)) {
				yield* this.recordReleaseWorkflowInterruption(preparationId, workflowId);
			}
			if (!['complete', 'errored', 'terminated'].includes(status.status)) {
				const members = wake === true ? undefined : wake.members;
				for (const id of release.ids.filter(id => !members || members.includes(id))) {
					yield* fromPromise(() => instance.sendEvent({ type: id, payload: {} }));
				}
			}
		});
	}
	private deliverReleaseEvents(now: number): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const [key, value] of yield* this.list({ prefix: 'release-wake:' })) {
				const parsed = releaseWake.safeParse(value);
				if (!parsed.success) {
					yield* this.remove(key);
					continue;
				}
				const wake = parsed.data;
				if (wakeDue(wake) > now) continue;
				const preparationId = key.slice('release-wake:'.length);
				const release = yield* this.releaseSet(`release-set:${preparationId}`);
				const workflowId = release?.workflowId;
				if (!release || !workflowId || release.completed) {
					yield* this.remove(key);
					continue;
				}
				yield* this.deliverReleaseWake(preparationId, { ...release, workflowId }, wake).pipe(
					Effect.andThen(this.remove(key)),
					recover(error =>
						Effect.gen({ self: this }, function*() {
							yield* this.write(key, { ...(wake === true ? {} : wake), due: now + reconcileInterval });
							console.error(JSON.stringify({ event: 'release-wake.failed', preparationId, error: decodeError(error) }));
						})
					),
				);
			}
		});
	}
	private operations(preparationId: string, workflowId: string): Effect.Effect<ReleaseOperation[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const release = yield* this.releaseSet(`release-set:${preparationId}`);
			if (!release || release.workflowId !== workflowId) {
				return yield* precondition('Release Workflow identity mismatch');
			}
			return yield* Effect.forEach(release.ids, id =>
				this.get(id).pipe(Effect.map(execution => ({
					id,
					operation: execution.package ? `${execution.operation} ${execution.package.id}` : execution.operation,
					paced: execution.package?.manager === 'cargo',
					dependencies: execution.dependencies,
				}))), { concurrency: 'unbounded' });
		});
	}
	releaseOperations(preparationId: string, workflowId: string): Promise<ReleaseOperation[]> {
		return Effect.runPromise(this.operations(preparationId, workflowId));
	}
	reservePublication(preparationId: string, workflowId: string, id: string): Promise<number> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const operations = yield* this.operations(preparationId, workflowId);
			if (!operations.some(operation => operation.id === id && operation.paced)) {
				return yield* precondition('Operation is not a paced publication in this release');
			}
			const execution = yield* this.get(id);
			const target = execution.package;
			if (!target) return yield* precondition('Paced operation has no package');
			if (!execution.reservation) {
				const repository = yield* this.store().repository(execution.repositoryId);
				const status = repository?.inventory.packages.find(pkg => matchesPackage(target.id, pkg))?.publicationStatus;
				const reservation = status === 'missing' ? 'new' : 'update';
				const allowedAt = yield* fromPromise(() => this.env.PUBLISH_BUDGET.getByName('crates-io').reserve(reservation));
				yield* this.put({ ...execution, reservation, notBefore: Math.max(execution.notBefore ?? 0, allowedAt) });
			}
			return Math.max(0, ((yield* this.get(id)).notBefore ?? 0) - Date.now());
		}));
	}
	operationDelay(preparationId: string, workflowId: string, id: string): Promise<number> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const operations = yield* this.operations(preparationId, workflowId);
			if (!operations.some(operation => operation.id === id)) {
				return yield* precondition('Operation is not in this release');
			}
			return Math.max(0, ((yield* this.get(id)).notBefore ?? 0) - Date.now());
		}));
	}
	advanceReleaseOperation(preparationId: string, workflowId: string, id: string): Promise<Execution['state']> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const operations = yield* this.operations(preparationId, workflowId);
			if (!operations.some(operation => operation.id === id)) {
				return yield* precondition('Operation is not in this release');
			}
			yield* this.reconcile(id);
			return (yield* this.get(id)).state;
		}));
	}
	releaseWorkflowInterrupted(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(this.recordReleaseWorkflowInterruption(preparationId, workflowId));
	}
	private recordReleaseWorkflowInterruption(
		preparationId: string,
		workflowId: string,
		interrupted = true,
	): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const operation of yield* this.operations(preparationId, workflowId)) {
				const execution = yield* this.get(operation.id);
				if (!execution.releaseSet) continue;
				execution.releaseSet.workflowError = interrupted
					? 'Release coordination interrupted. Check coordination to resume.'
					: undefined;
				yield* this.commit([
					{ entity: 'execution', id: execution.id, repositoryId: execution.repositoryId, value: execution },
				]);
			}
		});
	}
	completeReleaseWorkflow(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const operations = yield* this.operations(preparationId, workflowId);
			for (const operation of operations) {
				if ((yield* this.get(operation.id)).state !== 'succeeded') return yield* precondition('Release is incomplete');
			}
			const release = yield* this.releaseSet(`release-set:${preparationId}`);
			if (!release) return yield* precondition('Release set is missing');
			yield* this.putReleaseSet(preparationId, { ...release, completed: true });
		}));
	}
	startReleaseSet(preparationId: string, target: string): Promise<Execution[]> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const preparation = yield* this.get(preparationId);
			if (yield* this.suspended(preparation.repositoryId)) {
				return yield* precondition('Repository is suspended');
			}
			const key = `release-set:${preparationId}`;
			const prior = yield* this.releaseSet(key);
			if (prior) {
				if (prior.target !== target) return yield* precondition('Release set already targets another revision');
				return yield* Effect.forEach(prior.ids, id => this.get(id), { concurrency: 'unbounded' });
			}
			const result = preparation.managed?.result ?? preparation.prepared?.result;
			const plan = preparation.managed?.plan ?? preparation.plan;
			if (!result || !plan) return yield* precondition('Preparation result unavailable');
			const revision = yield* Effect.fromResult(sha(target));
			const snapshot = yield* this.gateway().preparedSnapshot(
				preparation.repository,
				preparation.repositoryId,
				result,
				revision,
				(preparation.prepared?.edits ?? plan.edits).map(edit => edit.path),
			);
			for (const edit of preparation.prepared?.edits ?? []) {
				if (snapshot.files[edit.path] !== edit.after) {
					return yield* precondition(`Generated preparation file changed: ${edit.path}`);
				}
			}
			const executions = yield* compileReleaseSet(preparation, snapshot);
			const workflowId = `release-${preparationId}`;
			for (const execution of executions) {
				if (execution.releaseSet) {
					execution.releaseSet.workflowId = workflowId;
					execution.releaseSet.operationCount = executions.length;
				}
			}
			const record: ReleaseSetRecord = { target, ids: executions.map(execution => execution.id), workflowId };
			const members = executions.map((execution): Committed => ({
				entity: 'execution',
				id: execution.id,
				repositoryId: execution.repositoryId,
				value: execution,
			}));
			yield* this.commit([
				{ entity: 'release-set', id: preparationId, repositoryId: preparation.repositoryId, value: record },
				...members,
			], { [`release-wake:${preparationId}`]: { due: Date.now() } });
			return executions;
		}));
	}
	enqueue(execution: Execution): Promise<Execution> {
		return this.serial(Effect.gen({ self: this }, function*() {
			if (Boolean(execution.workflow) === Boolean(execution.managed)) {
				return yield* precondition('Execution needs exactly one runner');
			}
			const prior = yield* this.stored(execution.id);
			if (prior) return prior;
			if (execution.configuration.streams[execution.stream]?.concurrency === 'supersede-pending') {
				for (const old of yield* this.executions()) {
					if (
						old.stream === execution.stream
						&& old.operation === execution.operation
						&& ['pending', 'ready'].includes(old.state)
					) {
						yield* this.put({ ...old, state: 'cancelled', reason: 'Superseded before dispatch' });
					}
				}
			}
			yield* this.put(execution);
			return execution;
		}));
	}
	private get(id: string): Effect.Effect<Execution, DomainError> {
		return this.stored(id).pipe(
			Effect.filterOrFail(
				(execution): execution is Execution => execution !== undefined,
				() => precondition('Unknown execution'),
			),
		);
	}
	prepared(id: string, identity: WorkflowIdentity, edits: Edit[]): Promise<{ url: string; head: string }> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			if (
				!execution.workflow || execution.managed || execution.operation !== 'prepare' || !execution.plan
				|| execution.state !== 'running' || execution.repositoryId !== identity.repositoryId
				|| execution.runId !== identity.runId || execution.runAttempt !== identity.attempt
				|| execution.workflowSha !== identity.workflowSha
			) return yield* precondition('Preparation run identity mismatch');
			const ordered = [...edits].sort((a, b) => a.path.localeCompare(b.path));
			if (execution.prepared && JSON.stringify(execution.prepared.edits) !== JSON.stringify(ordered)) {
				return yield* precondition('Submitted preparation changed; create a new preparation');
			}
			if (execution.prepared?.result) return execution.prepared.result;
			const prepared = execution.prepared ?? { edits: ordered };
			execution.prepared = prepared;
			yield* this.put(execution);
			const gateway = this.gateway();
			const source = yield* gateway.snapshot(
				execution.repository,
				execution.repositoryId,
				execution.sourceSha,
				ordered.map(edit => edit.path),
			);
			const branch = `release/${execution.stream}/${execution.id}`;
			const title = `chore(release): prepare ${execution.version ?? 'release set'}`;
			const body =
				`Source: ${execution.sourceSha}\nPreparation execution: ${execution.id}\n\nPromotion requires approval.`;
			const result = prepared.head
				? yield* gateway.resumePreparation(source, branch, title, body, prepared.head)
				: yield* gateway.pullRequest(source, branch, title, body, ordered, undefined, head => {
					prepared.head = head;
					return this.put(execution);
				});
			prepared.result = result;
			yield* this.put(execution);
			return result;
		}));
	}
	register(id: string, identity: WorkflowIdentity): Promise<Execution> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			const workflow = execution.workflow;
			if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
			const dependencies = yield* Effect.forEach(execution.dependencies, id => this.get(id), {
				concurrency: 'unbounded',
			});
			if (!dependenciesReady(execution, dependencies)) {
				return yield* precondition('Execution dependencies have not succeeded');
			}
			if (execution.attempts === 0 && execution.eventId !== `observed:${identity.runId}`) {
				return yield* precondition('Execution has not been dispatched');
			}
			if (
				execution.repositoryId !== identity.repositoryId
				|| execution.repository !== identity.repository
				|| !['pending', 'ready', 'dispatching', 'uncertain', 'running'].includes(execution.state)
			) {
				return yield* precondition('Execution cannot register this run');
			}
			const expected = `${identity.repository}/.github/workflows/${workflow.file}@`;
			if (!identity.workflowRef.startsWith(expected)) return yield* precondition('Workflow binding mismatch');
			if (execution.runId && execution.runId !== identity.runId) {
				return yield* precondition('Execution is already bound to a run');
			}
			if (execution.runAttempt && identity.attempt < execution.runAttempt) {
				return yield* precondition('Stale run attempt');
			}
			const gateway = this.gateway();
			const token = yield* gateway.token(execution.repository, execution.repositoryId);
			const run = yield* gateway.read(
				workflowRunSchema,
				`/repos/${execution.repository}/actions/runs/${identity.runId}`,
				token,
			);
			if (
				run.repository.id !== execution.repositoryId
				|| run.head_sha !== identity.sha
				|| run.path !== `.github/workflows/${workflow.file}`
				|| run.run_attempt !== identity.attempt
			) {
				return yield* precondition('Run identity mismatch');
			}
			if (run.head_sha !== execution.sourceSha) {
				return yield* precondition(
					`The run is at ${run.head_sha.slice(0, 12)} but this execution releases ${execution.sourceSha.slice(0, 12)}`,
				);
			}
			if (!matchesRef(workflow.ref, identity.ref)) return yield* precondition('Workflow ref mismatch');
			if (execution.attempts > 0 && !execution.runId && run.display_title !== expectedRunTitle(execution)) {
				return yield* precondition('Dispatch correlation mismatch');
			}
			const resolvedInputs = yield* resolveInputs(execution, dependencies);
			const next: Execution = {
				...execution,
				resolvedInputs,
				state: 'running',
				runId: identity.runId,
				runAttempt: identity.attempt,
				workflowSha: identity.workflowSha,
				helperShas: [
					...new Set([...(execution.helperShas ?? []), identity.helperSha ?? identity.workflowSha]),
				],
			};
			yield* this.put(next);
			return next;
		}));
	}
	refs(id: string, identity: WorkflowIdentity, complete = false): Promise<RefPlan> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			const workflow = execution.workflow;
			if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
			if (
				execution.state !== 'running' || execution.repositoryId !== identity.repositoryId
				|| execution.repository !== identity.repository || execution.runId !== identity.runId
				|| execution.runAttempt !== identity.attempt || execution.workflowSha !== identity.workflowSha
			) return yield* precondition('Ref operation identity mismatch');
			const policy = workflow.refs;
			const version = execution.version;
			if (!policy || !version) return yield* precondition('No configured ref operation');
			if (!(yield* this.promoted(execution))) return yield* precondition('Ref operation requires completed promotion');
			const gateway = this.gateway();
			const refs = yield* gateway.tagRefs(execution.repository, execution.repositoryId);
			if (!execution.refPlan) {
				if (complete) return yield* precondition('Ref plan has not been authorized');
				const changes = yield* planRefs(policy, version, execution.sourceSha, refs);
				execution.refPlan = { repository: execution.repository, executionId: id, version, changes };
				yield* this.put(execution);
			}
			const plan = execution.refPlan;
			if (complete) {
				for (const change of plan.changes) {
					const actual = refs.find(ref => ref.name === change.name);
					if (actual?.commit !== change.commit) return yield* precondition('Published ref does not match the plan');
					if (change.annotated) {
						const token = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
						const tag = yield* gateway.read(
							gitTagSchema,
							`/repos/${execution.repository}/git/tags/${actual.oid}`,
							token,
						);
						if (
							tag.object.sha !== change.commit || tag.tag !== change.name
							|| (change.signed && tag.verification?.verified !== true)
						) return yield* precondition('Version tag verification failed');
					}
				}
				execution.publications = yield* mergePublications(execution.publications, [{
					id: `refs:${execution.operation}`,
					manager: 'workflow',
					name: execution.repository,
					version,
					outcome: 'succeeded',
					required: true,
				}]);
				yield* this.put(execution);
			}
			return plan;
		}));
	}
	private promoted(execution: Execution): Effect.Effect<boolean, DomainError> {
		if (execution.operation === 'promote') return Effect.succeed(true);
		const visited = new Set<string>();
		const approved = (current: Execution): Effect.Effect<boolean, DomainError> =>
			Effect.gen({ self: this }, function*() {
				if (visited.has(current.id)) return false;
				visited.add(current.id);
				if (current.state !== 'succeeded' || current.sourceSha !== execution.sourceSha) return false;
				if (current.operation === 'promote') return true;
				for (const dependency of current.dependencies) if (yield* approved(yield* this.get(dependency))) return true;
				return false;
			});
		return Effect.gen({ self: this }, function*() {
			for (const dependency of execution.dependencies) if (yield* approved(yield* this.get(dependency))) return true;
			return false;
		});
	}
	publishRelease(id: string, identity: WorkflowIdentity): Promise<Execution> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const publication = yield* this.serialized(this.releasePublication(id, identity));
			return yield* this.serialized(this.recordReport(id, identity, [publication], []));
		}));
	}
	private releasePublication(id: string, identity: WorkflowIdentity): Effect.Effect<Publication, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			if (!execution.workflow || execution.managed) return yield* precondition('Operation is not a workflow');
			if (
				execution.state !== 'running' || execution.repositoryId !== identity.repositoryId
				|| execution.repository !== identity.repository || execution.runId !== identity.runId
				|| execution.runAttempt !== identity.attempt || execution.workflowSha !== identity.workflowSha
			) return yield* precondition('Release operation identity mismatch');
			if (!publishesGithubRelease(execution)) {
				return yield* precondition(`Add github-release:${execution.repository} to this operation's publications`);
			}
			if (!(yield* this.promoted(execution))) {
				return yield* precondition('Release operation requires completed promotion');
			}
			const target = yield* fromSync(() => githubRelease(execution));
			if (!target) return yield* precondition('Release operation has no version');
			const { tag, prerelease } = target;
			const gateway = this.gateway();
			const repository = `/repos/${execution.repository}`;
			const read = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
			const ref = yield* gateway.read(
				gitRefSchema.nullable(),
				`${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
				read,
			);
			if (ref === null) return yield* precondition('Publish the release tag before the release');
			const object = ref.object;
			if (object.type !== 'tag') return yield* precondition('Release tag must be annotated');
			const tagged = (yield* gateway.read(gitTagSchema, `${repository}/git/tags/${object.sha}`, read)).object;
			if (tagged.type !== 'commit' || tagged.sha !== execution.sourceSha) {
				return yield* precondition('Release tag points to another commit');
			}
			const write = yield* gateway.token(execution.repository, execution.repositoryId, {
				contents: 'write',
				workflows: 'write',
			});
			const release = execution.draftRelease
				? yield* this.publishDraft(execution, execution.draftRelease, target, write)
				: (yield* gateway.read(
					releaseSchema.nullable(),
					`${repository}/releases/tags/${encodeURIComponent(tag)}`,
					read,
				))
					?? (yield* gateway.read(releaseSchema, `${repository}/releases`, write, 'POST', {
						tag_name: tag,
						target_commitish: execution.sourceSha,
						name: tag,
						generate_release_notes: true,
						prerelease,
					}));
			if (release.tag_name !== tag || release.draft !== false || release.prerelease !== prerelease) {
				return yield* precondition('Existing GitHub release does not match the release operation');
			}
			return {
				id: `github-release:${execution.repository}`,
				manager: 'github-release',
				name: execution.repository,
				version: tag,
				outcome: 'succeeded',
				required: true,
				...(typeof release.html_url === 'string' ? { url: release.html_url } : {}),
			};
		});
	}
	private draftRelease(execution: Execution): Effect.Effect<Execution['draftRelease'], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const target = yield* fromSync(() => githubRelease(execution));
			if (!target || !publishesGithubRelease(execution)) return execution.draftRelease;
			const gateway = this.gateway();
			const write = yield* gateway.token(execution.repository, execution.repositoryId, {
				contents: 'write',
				workflows: 'write',
			});
			if (execution.draftRelease) {
				const kept = yield* gateway.call(`/repos/${execution.repository}/releases/${execution.draftRelease.id}`, write);
				if (kept !== null) return execution.draftRelease;
			}
			const bot = yield* gateway.botIdentity;
			const drafts = (yield* gateway.read(
				z.array(releaseSchema),
				`/repos/${execution.repository}/releases?per_page=100`,
				write,
			)).filter(release => release.draft === true && release.tag_name === target.tag);
			const matches = (release: GitHubRelease) =>
				release.target_commitish === execution.sourceSha && release.prerelease === target.prerelease;
			for (const stale of drafts.filter(release => !matches(release) && release.author.id === bot.id)) {
				yield* gateway.call(`/repos/${execution.repository}/releases/${stale.id}`, write, 'DELETE');
			}
			const existing = drafts.find(matches);
			const release = existing ?? (yield* gateway.read(
				releaseSchema,
				`/repos/${execution.repository}/releases`,
				write,
				'POST',
				{
					tag_name: target.tag,
					target_commitish: execution.sourceSha,
					name: target.tag,
					generate_release_notes: true,
					prerelease: target.prerelease,
					draft: true,
				},
			));
			return { id: release.id, tag: target.tag };
		});
	}
	private publishDraft(
		execution: Execution,
		draft: { id: number; tag: string },
		target: { tag: string; prerelease: boolean },
		token: string,
	): Effect.Effect<GitHubRelease, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const gateway = this.gateway();
			const path = `/repos/${execution.repository}/releases/${draft.id}`;
			const release = yield* gateway.read(releaseSchema.nullable(), path, token);
			if (release === null) return yield* precondition('Draft GitHub release no longer exists');
			if (draft.tag !== target.tag || release.tag_name !== target.tag || release.prerelease !== target.prerelease) {
				return yield* precondition('Draft GitHub release does not match the release operation');
			}
			if (release.draft !== true) return release;
			const bot = yield* gateway.botIdentity;
			const listed = yield* gateway.read(
				z.array(releaseSchema),
				`/repos/${execution.repository}/releases?per_page=100`,
				token,
			);
			const siblings = listed.filter(other =>
				other.draft === true && other.tag_name === target.tag && other.id !== draft.id && other.author.id === bot.id
			);
			const names = new Set(release.assets.map(asset => asset.name));
			for (const other of siblings) {
				for (const asset of other.assets) {
					if (asset.state !== 'uploaded' || names.has(asset.name)) continue;
					yield* gateway.copyReleaseAsset(
						execution.repository,
						{ id: asset.id, name: asset.name, contentType: asset.content_type },
						draft.id,
						token,
					);
					names.add(asset.name);
				}
				yield* gateway.call(`/repos/${execution.repository}/releases/${other.id}`, token, 'DELETE');
			}
			const current = yield* gateway.read(releaseSchema, path, token);
			if (current.assets.some(asset => asset.state !== 'uploaded')) {
				return yield* precondition('Draft GitHub release has unfinished asset uploads');
			}
			return yield* gateway.read(releaseSchema, path, token, 'PATCH', { draft: false });
		});
	}
	report(
		id: string,
		identity: WorkflowIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	): Promise<Execution> {
		return this.serial(this.recordReport(id, identity, publications, artifacts));
	}
	private releaseIdentity(
		execution: Execution,
		publication: Publication,
	): Effect.Effect<Publication, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (publication.name !== execution.repository) {
				return yield* precondition('Release repository mismatch');
			}
			const gateway = this.gateway();
			const token = yield* gateway.token(execution.repository, execution.repositoryId);
			const base = `/repos/${execution.repository}`;
			const release = yield* gateway.read(
				releaseSchema,
				`${base}/releases/tags/${encodeURIComponent(publication.version)}`,
				token,
			);
			const tag = yield* gateway.read(
				gitRefSchema,
				`${base}/git/ref/tags/${encodeURIComponent(publication.version)}`,
				token,
			);
			let target = tag.object;
			if (target.type === 'tag') {
				target = (yield* gateway.read(gitTagSchema, `${base}/git/tags/${target.sha}`, token)).object;
			}
			const valid = release.draft === false
				&& release.tag_name === publication.version
				&& target.type === 'commit'
				&& target.sha === execution.sourceSha;
			if (valid) {
				const releaseId = release.id;
				const reference: ReleaseReference = {
					id: `github:${execution.repositoryId}:${releaseId}`,
					repository: { id: execution.repositoryId, name: execution.repository },
					stream: execution.stream,
					commit: execution.sourceSha,
					version: execution.version ?? publication.version.replace(/^v/, ''),
					tag: publication.version,
					releaseId,
					artifacts: [],
					publications: [],
				};
				if (
					execution.release
					&& (execution.release.tag !== reference.tag || execution.release.releaseId !== reference.releaseId)
				) return yield* precondition('Release identity changed');
				execution.release = reference;
			}
			return { ...publication, outcome: valid ? 'succeeded' : 'failed' };
		});
	}
	private recordReport(
		id: string,
		identity: WorkflowIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	): Effect.Effect<Execution, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			const workflow = execution.workflow;
			if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
			if (
				execution.repositoryId !== identity.repositoryId
				|| execution.runId !== identity.runId
				|| execution.runAttempt !== identity.attempt
				|| execution.workflowSha !== identity.workflowSha
				|| execution.state !== 'running'
			) {
				return yield* precondition('Report identity mismatch');
			}
			for (const artifact of artifacts) {
				if (artifact.runId !== identity.runId) return yield* precondition('Artifact producer mismatch');
				if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest) || !(Date.parse(artifact.expiresAt) > Date.now())) {
					return yield* precondition('Artifact has no usable digest or has expired');
				}
				const gateway = this.gateway();
				const token = yield* gateway.token(execution.repository, execution.repositoryId);
				const actual = yield* gateway.read(
					artifactSchema,
					`/repos/${execution.repository}/actions/artifacts/${artifact.id}`,
					token,
				);
				if (
					actual.workflow_run.id !== identity.runId
					|| actual.expired
					|| actual.name !== artifact.name
					|| actual.digest !== artifact.digest
					|| actual.expires_at !== artifact.expiresAt
				) {
					return yield* precondition('Reported artifact does not match GitHub');
				}
			}
			const verified: Publication[] = [];
			for (const reported of publications) {
				const identity = yield* Effect.fromResult(parseIdentity(reported, execution.repository)).pipe(
					Effect.mapError(toDomainError),
				);
				const publication = { ...reported, identity };
				if (publication.id.startsWith('refs:')) {
					return yield* precondition('Ref results are verified by the ref completion endpoint');
				}
				yield* validatePublicationIdentity(execution, publication);
				if (canVerifyPublication(publication.manager) && publication.outcome === 'succeeded') {
					const context = this.gateway().verification(execution.repository, execution.repositoryId);
					verified.push(yield* verifyPublication(publication, fetch, context));
				} else if (publication.manager === 'manifest' && publication.outcome === 'succeeded') {
					verified.push(yield* verifyManifest(publication, this.gateway()));
				} else if (publication.manager === 'github-release' && publication.outcome === 'succeeded') {
					verified.push(yield* this.releaseIdentity(execution, publication));
				} else verified.push(publication);
			}
			const merged = yield* mergeArtifacts(execution.artifacts, artifacts, workflow.outputs);
			const next = {
				...execution,
				publications: yield* mergePublications(execution.publications, verified),
				artifacts: merged,
			};
			yield* this.put(next);
			return next;
		});
	}
	private supersedeVersion(execution: Execution): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (execution.operation !== 'promote' || !execution.version) return;
			for (const other of yield* this.executions()) {
				if (
					other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
					&& other.version === execution.version && ['blocked', 'pending', 'ready', 'failed'].includes(other.state)
				) {
					yield* this.put({ ...other, state: 'cancelled', reason: `Superseded by ${execution.id}` });
				}
			}
		});
	}
	private approveFromPush(execution: Execution, executions: Execution[]): Effect.Effect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const newer = executions.find(other =>
				other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
				&& other.version === execution.version && other.createdAt > execution.createdAt
				&& !['succeeded', 'cancelled', 'failed'].includes(other.state)
			);
			if (newer) {
				yield* this.put({ ...execution, state: 'cancelled', reason: `Superseded by ${newer.id}` });
				return true;
			}
			const problems = yield* this.approvalProblems(execution);
			if (problems.length) {
				const reason = `Releases when the commit is verified and its checks pass: ${problems.join('; ')}`;
				if (execution.reason !== reason) yield* this.put({ ...execution, reason });
				return false;
			}
			yield* this.store().audit('beepboop', 'promotion.approve', `${execution.id}:${execution.sourceSha}:push`);
			const next: Execution = { ...execution, state: 'ready', approvedAt: Date.now() };
			delete next.reason;
			yield* this.supersedeVersion(next);
			yield* this.put(next);
			return true;
		});
	}
	approve(id: string, commitSha: string, actor: string, force = false): Promise<Execution> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			const commit = yield* Effect.fromResult(sha(commitSha));
			if (
				execution.operation !== 'promote'
				|| execution.state !== 'blocked'
				|| execution.sourceSha !== commit
			) {
				return yield* precondition('Approval does not match promotion target');
			}
			const token = yield* this.gateway().token(execution.repository, execution.repositoryId);
			const head = yield* this.refHead(execution, token);
			if (head && head.sha !== execution.sourceSha) {
				return yield* precondition(`${head.ref} is at ${head.sha.slice(0, 12)}. Approve the release for that commit.`);
			}
			const problems = yield* this.approvalProblems(execution);
			if (problems.length && !force) return yield* precondition(problems.join('; '));
			yield* this.store().audit(
				actor,
				'promotion.approve',
				`${id}:${commitSha}${problems.length ? ` overriding: ${problems.join('; ')}` : ''}`,
			);
			const next: Execution = { ...execution, state: 'ready', approvedAt: Date.now() };
			yield* this.supersedeVersion(next);
			yield* this.put(next);
			return next;
		}));
	}
	approvalReadiness(id: string): Promise<{ problems: string[] }> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			if (execution.operation !== 'promote' || execution.state !== 'blocked') {
				return { problems: ['This promotion is not waiting for approval'] };
			}
			return { problems: yield* this.approvalProblems(execution) };
		}));
	}
	private approvalProblems(execution: Execution): Effect.Effect<string[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const gateway = this.gateway();
			const token = yield* gateway.token(execution.repository, execution.repositoryId);
			const base = `/repos/${execution.repository}`;
			const problems: string[] = [];
			const repository = yield* this.store().repository(execution.repositoryId);
			const references = execution.configuration.streams[execution.stream]?.packages;
			if (repository) {
				problems.push(...manifestProblems(
					repository.inventory,
					repository.inventory.packages.filter(pkg =>
						!references || references.some(reference => matchesPackage(reference, pkg))
					),
				));
			}
			const commit = yield* gateway.read(commitSchema, `${base}/commits/${execution.sourceSha}`, token);
			if (commit.commit.verification.verified !== true) {
				problems.push('The commit signature is not verified');
			}
			const checks = yield* gateway.read(
				checkRunsSchema,
				`${base}/commits/${execution.sourceSha}/check-runs?per_page=100&filter=latest`,
				token,
			);
			const runs = checks.check_runs;
			if (checks.total_count !== runs.length) problems.push('The commit has more than 100 check runs');
			const releaseFiles = new Set(
				Object.values(execution.configuration.streams).flatMap(stream =>
					[stream.prepare.workflow, stream.promote.workflow, ...Object.values(stream.workflows)]
						.flatMap(binding => binding ? [`.github/workflows/${binding.file}`] : [])
				),
			);
			const { workflow_runs: workflowRuns } = yield* gateway.read(
				workflowRunsSchema,
				`${base}/actions/runs?head_sha=${execution.sourceSha}&per_page=100`,
				token,
			);
			const paths = new Map(workflowRuns.map(run => [String(run.id), run.path]));
			const gating = runs.filter(run => {
				const runId = /\/actions\/runs\/(\d+)\//.exec(String(run.details_url))?.[1];
				return !(runId && releaseFiles.has(paths.get(runId) ?? ''));
			});
			if (!gating.length) problems.push('No checks have run on this commit');
			for (const run of gating) {
				if (run.status !== 'completed') problems.push(`${String(run.name)} is still running`);
				else if (!['success', 'neutral', 'skipped'].includes(String(run.conclusion))) {
					problems.push(`${String(run.name)} ${String(run.conclusion)}`);
				}
			}
			const status = yield* gateway.read(commitStatusSchema, `${base}/commits/${execution.sourceSha}/status`, token);
			if (Number(status.total_count) > 0 && status.state !== 'success') {
				problems.push(`Commit status is ${String(status.state)}`);
			}
			return problems;
		});
	}
	private refHead(
		execution: Execution,
		token: string,
	): Effect.Effect<{ ref: string; sha: string } | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const ref = execution.workflow?.ref.replace(/^refs\/(heads|tags)\//, '');
			if (!ref) return undefined;
			const commit = yield* this.gateway().read(
				commitSchema.nullable(),
				`/repos/${execution.repository}/commits/${encodeURIComponent(ref)}`,
				token,
			);
			if (commit === null) return yield* precondition(`Workflow ref ${ref} no longer exists`);
			return { ref, sha: commit.sha };
		});
	}
	private redispatch(execution: Execution, publications: Publication[]): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const gateway = this.gateway();
			const token = yield* gateway.token(execution.repository, execution.repositoryId, {
				contents: 'read',
				actions: 'write',
			});
			const head = yield* this.refHead(execution, token);
			if (head && head.sha !== execution.sourceSha) return yield* precondition(moved(execution, head));
			const run = execution.runId
				? yield* gateway.read(
					workflowRunSchema,
					`/repos/${execution.repository}/actions/runs/${execution.runId}`,
					token,
				)
				: null;
			if (run !== null && run.head_sha === execution.sourceSha) {
				yield* gateway.call(
					`/repos/${execution.repository}/actions/runs/${execution.runId}/rerun-failed-jobs`,
					token,
					'POST',
				);
				yield* this.put({
					...execution,
					state: 'uncertain',
					runAttempt: run.run_attempt,
					reason: 'Retry requested; re-running the failed jobs',
					publications,
				});
			} else {
				yield* this.put({
					...execution,
					state: 'ready',
					supersededRuns: [...(execution.supersededRuns ?? []), ...(execution.runId ? [execution.runId] : [])],
					runId: undefined,
					runAttempt: undefined,
					workflowSha: undefined,
					reason: 'Retry requested; dispatching a new run',
					publications,
				});
			}
			yield* this.requestReconcile(Date.now());
		});
	}
	recover(id: string, action: 'reconcile' | 'retry', actor: string): Promise<Execution> {
		return this.serial(Effect.gen({ self: this }, function*() {
			if (action === 'reconcile') yield* this.remove(`quarantine:${id}`);
			const execution = yield* this.get(id);
			if (action === 'retry') {
				if (!['failed', 'cancelled'].includes(execution.state)) {
					return yield* precondition('Only failed or cancelled operations can be retried');
				}
				if (execution.operation === 'prepare' && !execution.plan && !execution.managed) {
					return yield* precondition('This preparation has no plan; prepare the release from Prepare a release');
				}
				if (execution.artifacts.some((a) => Date.parse(a.expiresAt) <= Date.now())) {
					return yield* precondition('Artifacts expired; use the configured preparation/recovery producer');
				}
				const publications = execution.publications.map(publication =>
					publication.outcome === 'succeeded' ? publication : { ...publication, outcome: 'pending' as const }
				);
				if (execution.operation === 'promote' && execution.attempts === 0 && execution.approvedAt === undefined) {
					const next: Execution = { ...execution, state: 'blocked', publications };
					delete next.reason;
					yield* this.put(next);
				} else yield* this.redispatch(execution, publications);
			} else yield* this.wakeUp();
			const releaseSet = execution.releaseSet;
			const workflowId = releaseSet?.workflowId;
			if (releaseSet && workflowId) {
				const instance = yield* fromPromise(() => this.env.RELEASE_WORKFLOW.get(workflowId));
				const status = yield* fromPromise(() => instance.status());
				if (['errored', 'terminated'].includes(status.status)) {
					yield* fromPromise(() => instance.restart());
					yield* this.recordReleaseWorkflowInterruption(releaseSet.preparationId, workflowId, false);
				}
			}
			yield* this.store().audit(actor, `execution.${action}`, id);
			return yield* this.get(id);
		}));
	}
	cancel(id: string, actor: string): Promise<Execution> {
		return this.serial(Effect.gen({ self: this }, function*() {
			const execution = yield* this.get(id);
			if (['succeeded', 'cancelled'].includes(execution.state)) {
				return yield* precondition('Execution has already finished');
			}
			if (execution.runId && ['dispatching', 'running', 'uncertain'].includes(execution.state)) {
				const gateway = this.gateway();
				const token = yield* gateway.token(execution.repository, execution.repositoryId, {
					contents: 'read',
					actions: 'write',
				});
				const path = `/repos/${execution.repository}/actions/runs/${execution.runId}`;
				if ((yield* gateway.read(workflowRunSchema, path, token)).status !== 'completed') {
					yield* gateway.call(`${path}/cancel`, token, 'POST');
				}
			}
			const next: Execution = { ...execution, state: 'cancelled', reason: 'Cancelled from the dashboard' };
			yield* this.put(next);
			yield* this.store().audit(actor, 'execution.cancel', id);
			return next;
		}));
	}
	private wakeUp(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* this.wakeReleaseWorkflows();
			yield* this.requestReconcile(Date.now());
			yield* this.arm(Date.now());
		});
	}
	wake(): Promise<void> {
		return Effect.runPromise(this.wakeUp());
	}
	receive(delivery: string, repositoryId: number, event: InboxEvent): Promise<void> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const key = `inbox:${delivery}`;
			if (yield* this.read(key)) return;
			const now = Date.now();
			yield* this.write(key, { delivery, repositoryId, event, attempts: 0, due: now });
			yield* this.arm(now);
		}));
	}
	private drainInbox(now: number): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const [key, value] of yield* this.list({ prefix: 'inbox:' })) {
				const parsed = inboxEntry.safeParse(value);
				if (!parsed.success) {
					yield* this.remove(key);
					continue;
				}
				const entry = parsed.data;
				if (entry.due > now) continue;
				yield* new AutomationService(this.env).receive(entry.delivery, entry.repositoryId, entry.event).pipe(
					Effect.andThen(this.remove(key)),
					recover(error =>
						Effect.gen({ self: this }, function*() {
							const attempts = entry.attempts + 1;
							const failed = {
								...entry,
								attempts,
								due: now + reconcileInterval * 2 ** entry.attempts,
								error: decodeError(error),
							};
							if (retryable(error) && attempts < inboxAttempts) yield* this.write(key, failed);
							else {
								yield* this.write(`inbox-dead:${entry.delivery}`, failed);
								yield* this.remove(key);
								yield* this.auditQuietly(
									'inbox.dead',
									`${entry.delivery}: ${entry.event.kind} after ${attempts} attempts: ${failed.error}`,
									'inbox.audit-failed',
								);
							}
						})
					),
				);
			}
		});
	}
	observeRun(repositoryId: number, runId: number): Promise<void> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			yield* this.write(`observe:${runId}`, { repositoryId, runId });
			yield* this.wakeUp();
		}));
	}
	private observe(event: z.output<typeof observation>): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const stored = yield* this.store().repository(event.repositoryId);
			const state = stored && readiness(stored);
			if (state?.kind !== 'ready') return;
			const repository = state.repository;
			const gateway = this.gateway();
			const token = yield* gateway.token(repository.name, repository.id);
			const run = yield* gateway.read(
				workflowRunSchema,
				`/repos/${repository.name}/actions/runs/${event.runId}`,
				token,
			);
			if (
				run.repository.id !== repository.id
				|| !['push', 'release', 'workflow_dispatch', 'schedule', 'workflow_run', 'repository_dispatch'].includes(
					String(run.event),
				)
			) {
				return;
			}
			const branch = String(run.head_branch);
			for (const [streamName, stream] of Object.entries(repository.configuration.streams)) {
				for (const [operation, binding] of Object.entries(stream.workflows)) {
					const pattern = binding.ref ?? repository.defaultBranch;
					const tagged = run.event === 'release'
						|| (run.event === 'push' && pattern.startsWith('refs/tags/')
							&& matchesRef(pattern, `refs/tags/${branch}`))
						|| /^v?\d+\.\d+\.\d+/.test(branch);
					const ref = tagged ? `refs/tags/${branch}` : `refs/heads/${branch}`;
					if (
						binding.mode !== 'observe'
						|| run.path !== `.github/workflows/${binding.file}`
						|| !matchesRef(pattern, ref)
					) {
						continue;
					}
					const prefix = [
						stream.versionSource?.prefix,
						pattern.startsWith('refs/tags/') ? /^[^*?[]*/.exec(pattern.slice('refs/tags/'.length))?.[0] : undefined,
					].filter((value): value is string => value !== undefined && branch.startsWith(value))
						.sort((a, b) => b.length - a.length)[0] ?? '';
					const version = tagged
						? branch.slice(prefix.length).replace(/^v/, '')
						: undefined;
					const manifestVersions = !tagged && run.event === 'workflow_dispatch';
					const eventId = `observed:${event.runId}`;
					const id = yield* executionId(repository.id, streamName, operation, eventId);
					if (yield* this.read(`execution:${id}`)) continue;
					const snapshot = yield* gateway.snapshot(repository.name, repository.id, run.head_sha);
					const execution = yield* (
						createExecution(repository, {
							stream: streamName,
							operation,
							eventId,
							sourceSha: snapshot.sha,
							version,
							observed: true,
						})
					);
					execution.runId = event.runId;
					execution.runAttempt = run.run_attempt;
					execution.state = 'running';
					if (version) {
						const commit = yield* gateway.read(
							commitSchema,
							`/repos/${repository.name}/commits/${snapshot.sha}`,
							token,
						);
						const tag = yield* gateway.read(
							gitRefSchema,
							`/repos/${repository.name}/git/ref/tags/${encodeURIComponent(branch)}`,
							token,
						);
						let target = tag.object;
						if (target.type === 'tag') {
							target = (yield* gateway.read(
								gitTagSchema,
								`/repos/${repository.name}/git/tags/${target.sha}`,
								token,
							)).object;
						}
						if (
							commit.commit.verification.verified !== true
							|| target.type !== 'commit'
							|| target.sha !== snapshot.sha
						) {
							yield* this.put({
								...execution,
								state: 'failed',
								reason: 'Source commit signature or release tag identity is invalid',
							});
							continue;
						}
					}
					const inventory = discover(snapshot, repository.configuration.managers);
					if (
						inventory.diagnostics.some(d =>
							d.severity === 'blocking'
							&& (d.code === 'invalid-manifest' || d.code === 'cycle' || d.code === 'duplicate-identity')
						)
					) {
						return yield* precondition('Producer inventory is incomplete');
					}
					for (
						const pkg of inventory.packages.filter(
							(p) =>
								(Boolean(version) || (manifestVersions && tagPrefix(p.versionSource) === undefined))
								&& publishable(p)
								&& (!stream.packages || stream.packages.some(reference => matchesPackage(reference, p))),
						)
					) {
						if (!canVerifyPublication(pkg.manager)) continue;
						const released = version === undefined ? pkg.version : observedVersion(pkg, branch);
						if (released === undefined) continue;
						const publication: Publication = {
							id: packageId(pkg),
							identity: publicationIdentity(pkg, released),
							manager: pkg.manager,
							name: pkg.name,
							version: released,
							outcome: 'pending',
							required: !pkg.optional,
						};
						const context = this.gateway().verification(repository.name, repository.id);
						execution.publications.push(yield* verifyPublication(publication, fetch, context));
					}
					yield* this.put(execution);
				}
			}
		});
	}
	private observations(now: number): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const [key, value] of yield* this.list({ prefix: 'observe:' })) {
				const parsed = observation.safeParse(value);
				if (!parsed.success) {
					yield* this.remove(key);
					continue;
				}
				const event = parsed.data;
				if ((event.due ?? 0) > now) continue;
				yield* this.observe(event).pipe(
					Effect.andThen(this.remove(key)),
					recover(error =>
						this.write(key, {
							...event,
							due: now + reconcileInterval,
							attempts: (event.attempts ?? 0) + 1,
							error: decodeError(error),
						})
					),
				);
			}
		});
	}
	private setupEdit(): Effect.Effect<SetupEdit | undefined, DomainError> {
		return this.read('setup-edit').pipe(
			Effect.flatMap(value => value === undefined ? Effect.undefined : fromSync(() => decodeSetupEditV1(value))),
		);
	}
	setupEdited(edit: Omit<SetupEdit, 'due'>, changed: boolean): Promise<void> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const previous = yield* this.setupEdit();
			if (previous ? previous.number === edit.number && previous.body === edit.body : !changed) return;
			const due = Date.now() + 5000;
			yield* this.write('setup-edit', { ...edit, due });
			yield* this.arm(due);
		}));
	}
	private rebuildSetup(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const edit = yield* this.setupEdit();
			if (!edit || edit.due > Date.now()) return;
			const store = this.store();
			yield* Effect.gen({ self: this }, function*() {
				const repository = yield* store.repository(edit.repositoryId);
				if (repository && readiness(repository).kind !== 'suspended') {
					const gateway = this.gateway();
					const snapshot = yield* gateway.snapshot(repository.name, repository.id);
					yield* maintainSetup(store, gateway, snapshot, { number: edit.number, choices: edit.choices });
				}
			}).pipe(
				recover(error =>
					store.audit('beepboop', 'repository.setup.failed', `${edit.repositoryId} ${edit.head}: ${decodeError(error)}`)
				),
			);
			const current = yield* this.setupEdit();
			if (current?.due === edit.due) yield* this.remove('setup-edit');
		});
	}
	alarm(): Promise<void> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const now = Date.now();
			yield* this.drainInbox(now);
			yield* Effect.all([
				this.serialized(Effect.gen({ self: this }, function*() {
					yield* this.deliverReleaseEvents(now);
					yield* this.observations(now);
					const due = yield* this.read('reconcile-at');
					if (due === undefined || ((yield* this.reconcileAt()) ?? Number.POSITIVE_INFINITY) <= now) {
						yield* this.reconcile();
					}
				})),
				this.serialized(this.rebuildSetup()),
			], { concurrency: 'unbounded' });
			const next = yield* this.nextAlarm();
			yield* this.journal.schedule(next);
		}));
	}
	private runManaged(execution: Execution): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const operation = execution.managed;
			if (!operation || execution.workflow) return yield* precondition('Invalid managed operation');
			yield* Effect.gen({ self: this }, function*() {
				if (operation.result) {
					yield* this.put({ ...execution, state: 'succeeded' });
					return;
				}
				if (operation.plan.requiresPreparation || operation.plan.sourceSha !== execution.sourceSha) {
					return yield* precondition('Managed preparation plan is not executable');
				}
				const gateway = this.gateway();
				const snapshot = yield* gateway.snapshot(
					execution.repository,
					execution.repositoryId,
					execution.sourceSha,
					operation.plan.edits.map(edit => edit.path),
				);
				execution.state = 'running';
				execution.attempts++;
				yield* this.put(execution);
				operation.result = operation.head
					? yield* gateway.resumePreparation(
						snapshot,
						operation.branch,
						operation.title,
						operation.body,
						operation.head,
					)
					: yield* gateway.pullRequest(
						snapshot,
						operation.branch,
						operation.title,
						operation.body,
						operation.plan.edits,
						undefined,
						head => {
							operation.head = head;
							return this.put(execution);
						},
					);
				execution.state = 'succeeded';
				delete execution.reason;
				yield* this.put(execution);
			}).pipe(recover(error => this.put({ ...execution, state: 'uncertain', reason: decodeError(error) })));
		});
	}
	private dispatch(
		execution: Execution,
		executions: Execution[],
		active: Execution[],
		busy: Set<string>,
	): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const workflow = execution.workflow;
			if (!workflow) return yield* precondition('Execution has no runner');
			const gateway = this.gateway();
			const token = yield* gateway.token(execution.repository, execution.repositoryId, {
				contents: 'read',
				actions: 'write',
			});
			if (execution.runId) {
				const runId = execution.runId;
				const run = yield* gateway.read(
					workflowRunSchema,
					`/repos/${execution.repository}/actions/runs/${runId}`,
					token,
				);
				if (run.repository.id !== execution.repositoryId || run.path !== `.github/workflows/${workflow.file}`) {
					return yield* precondition('Run identity changed');
				}
				const runAttempt = run.run_attempt;
				if (
					run.status === 'completed' && execution.state === 'uncertain' && runAttempt <= (execution.runAttempt ?? 0)
				) {
					return;
				}
				if (run.status === 'completed') {
					for (let i = 0; i < execution.publications.length; i++) {
						const publication = execution.publications[i];
						if (publication && verifying(publication)) {
							const context = this.gateway().verification(execution.repository, execution.repositoryId);
							execution.publications[i] = yield* verifyPublication(publication, fetch, context);
						}
					}
					const limited = execution.publications.flatMap(publication =>
						publication.outcome === 'rate-limited' ? [Date.parse(publication.retryAfter)] : []
					);
					if (limited.length) {
						const until = Math.max(Date.now(), ...limited);
						if (execution.package?.manager === 'cargo') {
							yield* fromPromise(() => this.env.PUBLISH_BUDGET.getByName('crates-io').defer(until));
						}
						yield* this.put({
							...execution,
							state: 'ready',
							supersededRuns: [...(execution.supersededRuns ?? []), runId],
							runId: undefined,
							runAttempt: undefined,
							workflowSha: undefined,
							notBefore: until,
							reason: `Registry rate limit until ${new Date(until).toISOString()}`,
							publications: execution.publications.map(publication =>
								publication.outcome === 'rate-limited' ? { ...publication, outcome: 'pending' } : publication
							),
						});
						return;
					}
					yield* this.put({
						...execution,
						state: completion(execution, run.conclusion === 'success'),
						runAttempt,
					});
				} else if (execution.state === 'uncertain') {
					yield* this.put({ ...execution, state: 'running', runAttempt });
				}
				return;
			}
			if (['dispatching', 'uncertain'].includes(execution.state)) {
				const data = yield* gateway.read(
					workflowRunsSchema,
					`/repos/${execution.repository}/actions/workflows/${workflow.file}/runs?event=workflow_dispatch&per_page=100`,
					token,
				);
				const matches = data.workflow_runs.filter(
					(run) =>
						run.display_title === expectedRunTitle(execution)
						&& run.path === `.github/workflows/${workflow.file}`
						&& run.head_branch === workflow.ref?.replace(/^refs\/(heads|tags)\//, '')
						&& run.repository.id === execution.repositoryId
						&& !execution.supersededRuns?.includes(run.id),
				);
				const run = matches.length === 1 ? matches[0] : undefined;
				if (run) {
					yield* this.put({
						...execution,
						state: 'running',
						runId: run.id,
						runAttempt: run.run_attempt,
						workflowSha: undefined,
					});
				} else if (!matches.length && Date.now() - (execution.dispatchedAt ?? 0) > 120_000) {
					yield* this.put({
						...execution,
						state: 'ready',
						reason: 'GitHub started no run for the last dispatch; dispatching again',
					});
				} else {
					yield* this.put({
						...execution,
						state: 'uncertain',
						reason: matches.length
							? 'Multiple matching runs require review'
							: 'Dispatch outcome awaiting reconciliation',
					});
				}
				return;
			}
			if (!dependenciesReady(execution, executions) || (execution.notBefore ?? 0) > Date.now()) {
				return;
			}
			if (busy.has(execution.stream)) {
				const releaseId = execution.releaseSet?.workflowId;
				// Independent operations within one frozen release may run together.
				// Other releases and legacy executions still own the stream exclusively.
				if (
					!releaseId || active.some(other =>
						other.stream === execution.stream
						&& ['dispatching', 'running', 'uncertain'].includes(other.state)
						&& other.releaseSet?.workflowId !== releaseId
					)
				) return;
			}
			const head = yield* this.refHead(execution, token);
			if (head && head.sha !== execution.sourceSha) {
				yield* this.put({ ...execution, state: 'failed', reason: moved(execution, head) });
				return;
			}
			execution.resolvedInputs = yield* resolveInputs(execution, executions);
			const draftRelease = yield* this.draftRelease(execution);
			if (draftRelease) execution.draftRelease = draftRelease;
			busy.add(execution.stream);
			yield* this.put({
				...execution,
				state: 'dispatching',
				attempts: execution.attempts + 1,
				dispatchedAt: Date.now(),
			});
			const response = yield* gateway.read(
				dispatchSchema,
				`/repos/${execution.repository}/actions/workflows/${workflow.file}/dispatches`,
				token,
				'POST',
				{
					ref: workflow.ref,
					inputs: {
						...workflow.inputs,
						...(execution.package ? { package: execution.package.id } : {}),
						...(execution.titled ? { beepboop_title: runTitle(execution) } : {}),
						beepboop_execution_id: execution.id,
					},
				},
			);
			const runId = response?.workflow_run_id;
			if (runId) {
				yield* this.put({ ...execution, state: 'running', attempts: execution.attempts + 1, runId });
			}
		}).pipe(
			recover(error =>
				Effect.gen({ self: this }, function*() {
					const reason = `Beepboop could not continue: ${decodeError(error)}`;
					const current = yield* this.get(execution.id);
					if (current.reason !== reason) yield* this.put({ ...current, reason });
				})
			),
		);
	}
	private advance(
		execution: Execution,
		executions: Execution[],
		active: Execution[],
		busy: Set<string>,
		unresolved: (execution: Execution) => boolean,
	): Effect.Effect<'continue' | 'stop', DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (unresolved(execution)) {
				const context = this.gateway().verification(execution.repository, execution.repositoryId);
				const publications = yield* Effect.forEach(
					execution.publications,
					publication =>
						verifying(publication)
							? verifyPublication(publication, fetch, context)
							: Effect.succeed(publication),
					{ concurrency: 'unbounded' },
				);
				if (publications.some((publication, i) => publication.outcome !== execution.publications[i]?.outcome)) {
					yield* this.put({ ...execution, publications });
					return 'continue' as const;
				}
			}
			if (execution.state === 'succeeded') yield* this.captureReleaseEvent(execution);
			if (!active.includes(execution) || execution.state === 'pending') return 'continue' as const;
			if (execution.state === 'blocked' && execution.operation === 'promote') {
				if (
					execution.configuration.streams[execution.stream]?.promote.approval !== 'push'
					&& execution.approvedBy !== 'merge'
				) return 'continue' as const;
				return yield* this.approveFromPush(execution, executions).pipe(
					Effect.flatMap(approved =>
						approved
							? this.requestReconcile(Date.now()).pipe(Effect.as('stop' as const))
							: Effect.succeed('continue' as const)
					),
					recover(error =>
						Effect.gen({ self: this }, function*() {
							const reason = `Beepboop could not check this commit: ${decodeError(error)}`;
							if (execution.reason !== reason) yield* this.put({ ...execution, reason });
							return 'continue' as const;
						})
					),
				);
			}
			if (execution.managed) {
				yield* this.runManaged(execution);
				return 'continue' as const;
			}
			yield* this.dispatch(execution, executions, active, busy);
			return 'continue' as const;
		});
	}
	private reconcile(onlyExecution?: string): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const started = Date.now();
			if (!onlyExecution) yield* this.write('reconcile-at', null);
			const journal = yield* this.readJournal();
			const quarantined = new Set(
				[...(yield* this.list({ prefix: 'quarantine:' })).keys()].map(key => key.slice('quarantine:'.length)),
			);
			for (const entry of journal.unreadable) {
				if (!quarantined.has(entry.id)) yield* this.quarantine(entry.id, entry.error);
			}
			const executions = journal.executions.filter(execution => !quarantined.has(execution.id)).sort((a, b) =>
				a.createdAt - b.createdAt
			);
			if (executions[0] && (yield* this.suspended(executions[0].repositoryId))) {
				return;
			}
			const active = executions.filter(
				(e) => !['succeeded', 'cancelled', 'failed'].includes(e.state),
			);
			const busy = new Set(
				active
					.filter((e) => ['dispatching', 'running', 'uncertain'].includes(e.state))
					.map((e) => e.stream),
			);
			const unresolved = (execution: Execution) =>
				['succeeded', 'failed'].includes(execution.state) && execution.publications.some(verifying);
			if (active.some(e => !e.releaseSet?.workflowId) || executions.some(unresolved)) {
				yield* this.requestReconcile(started + reconcileInterval);
			}
			for (const execution of executions) {
				if (onlyExecution ? execution.id !== onlyExecution : Boolean(execution.releaseSet?.workflowId)) continue;
				const outcome = yield* this.advance(execution, executions, active, busy, unresolved).pipe(
					recover(error => this.isolate(execution.id, error).pipe(Effect.as('continue' as const))),
				);
				if (outcome === 'stop') return;
			}
		});
	}
}
