import { DurableObject } from 'cloudflare:workers';
import { Clock, Effect, Layer, ManagedRuntime, Schema } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import { ApprovalGate } from '@/automation/approval-gate.ts';
import { GitHubReleases } from '@/automation/github-releases.ts';
import { restatePreparation } from '@/automation/preparation-pull-requests';
import { PreparationWriter } from '@/automation/preparation-writer.ts';
import type { PublishBudget } from '@/automation/publish-budget';
import { RefPublication } from '@/automation/ref-publication.ts';
import { ReleaseCommits } from '@/automation/release-commits.ts';
import { ReleaseEventOutbox } from '@/automation/release-event-outbox.ts';
import { ReleaseSets } from '@/automation/release-sets.ts';
import type { ReleaseWorkflowParams } from '@/automation/release-workflow';
import { ReleaseWorkflowLauncher } from '@/automation/release-workflow-launcher.ts';
import { RunCallbacks } from '@/automation/run-callbacks.ts';
import { runJobs } from '@/automation/run-jobs.ts';
import { RunObservation } from '@/automation/run-observation.ts';
import type { AutomationBindings } from '@/automation/service';
import { Automation, applicationLayer, withAutomation } from '@/automation/service';
import { repositorySnapshot } from '@/automation/snapshot';
import { TagSigning } from '@/automation/tag-signing.ts';
import { wakeUp } from '@/automation/wake-up.ts';
import type { BinaryProgress, PackageTagPage, StreamGates } from '@/contract/views';
import type { Edit } from '@/domain/inventory.ts';
import type { RefPlan, RefState, TagSigner as SignerBinding } from '@/domain/refs.ts';
import type { CheckChoice } from '@/domain/release-gates.ts';
import { readiness } from '@/domain/repository';
import type { WorkflowRun } from '@/github/resources.ts';
import { dispatchSchema, releaseSchema, workflowRunSchema, workflowRunsSchema } from '@/github/resources.ts';
import type { GitHubRunResult } from '@/github/run-state.ts';
import { classifyJob, classifyRun, jobProgressState } from '@/github/run-state.ts';
import { TagSigner } from '@/github/signing.ts';
import { GitHubRejection } from '@/github/transport.ts';
import type { InboxEvent } from '@/github/webhooks.ts';
import { fromSync, recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { logFailure, logRecovered } from '@/kernel/logging/failure-log.ts';
import { jsonLogging } from '@/kernel/logging/json-logging.ts';
import { approvalShaPattern } from '@/kernel/schema/ids.ts';
import { matches, sha } from '@/kernel/schema/result.ts';
import type { SqlDatabase } from '@/persistence/d1/database';
import { ProjectionStore } from '@/persistence/d1/projection';
import { Journal, ProjectionSink } from '@/persistence/durable/journal.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { ClaimStep, NextStep, PublishReport, ReportStep } from '@/publication/contract.ts';
import { LedgerStore, PublicationLedger, RegistryVerification } from '@/publication/ledger/service.ts';
import { released } from '@/publication/ledger.ts';
import type { Publication } from '@/publication/publication.ts';
import { PublishPacing } from '@/publication/publish-pace.ts';
import { verifiedPublication } from '@/publication/registries/verification.ts';
import { canVerifyPublication, verifyPublication } from '@/publication/registries/verify.ts';
import { projectionRules } from '@/release/adapters/d1/completions.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import type { DistributionArtifact } from '@/release/distribution/artifact.ts';
import type { DistributionFile } from '@/release/distribution/validation.ts';
import {
	dependenciesReady,
	expectedRunTitle,
	publishedAfterFailure,
	recheckable,
	rechecked,
	recheckedPublication,
	recoverable,
	reopened,
	runTitle,
	settleRun,
	unreported,
	verifiableCancellation,
} from '@/release/domain/execution/execution.ts';
import { resolveInputs } from '@/release/domain/execution/outputs.ts';
import { githubFailureReason } from '@/release/domain/execution/run-labels.ts';
import type {
	Artifact,
	AutomationEvent,
	Execution,
	PreparedRelease,
	ReleaseStarted,
} from '@/release/domain/execution/types.ts';
import { ReleaseHistory } from '@/release/domain/history.ts';
import { preparationBody } from '@/release/domain/managed.ts';
import { landsByCommit, preparationRequest } from '@/release/domain/preparation-request.ts';
import { referenceProbe } from '@/release/domain/reference-probe.ts';
import { refsRequest } from '@/release/domain/refs-request.ts';
import type { ReleaseOperation } from '@/release/domain/release-set.ts';
import { AlarmPlanner, reconcileInterval } from '@/release/services/coordinator/alarm-planner.ts';
import { Background } from '@/release/services/coordinator/background.ts';
import { CoordinatorLock } from '@/release/services/coordinator/coordinator-lock.ts';
import { Executions, RepositoryRevisions } from '@/release/services/coordinator/executions.ts';
import type { CoordinatorServices } from '@/release/services/coordinator/layer.ts';
import { coordinatorLayer } from '@/release/services/coordinator/layer.ts';
import { ReconcileHistory } from '@/release/services/coordinator/reconcile-history.ts';
import {
	AuditTrail,
	InboxQueue,
	ObserveQueue,
	TrackQueue,
	trackLater,
} from '@/release/services/coordinator/retry-queue.ts';
import { decodeSetupEditV1 } from '@/setup/edit.ts';
import { maintainSetup } from '@/setup/server/maintenance.ts';
import type { SetupEdit } from '@/setup/types.ts';
import { binaryLegs } from '@/setup/workflows/binaries.ts';

export interface CoordinatorBindings extends AutomationBindings {
	DB: SqlDatabase;
	OWNER_ID: string;
	RELEASE_WORKFLOW: Workflow<ReleaseWorkflowParams>;
	PUBLISH_BUDGET: DurableObjectNamespace<PublishBudget>;
	SIGNER?: SignerBinding;
}
const automaticRetries = 3;
function freshRun(execution: Execution, workflow: Execution['workflow']): Execution {
	return {
		...execution,
		state: 'ready',
		supersededRuns: [...(execution.supersededRuns ?? []), ...(execution.runId ? [execution.runId] : [])],
		runId: undefined,
		runAttempt: undefined,
		github: undefined,
		workflowSha: undefined,
		artifacts: execution.artifacts.filter(artifact => artifact.runId !== execution.runId),
		...(workflow ? { workflow } : {}),
		publications: reopened(execution.publications),
	};
}
function startedPreparation(prior: Execution, started: ReleaseStarted): Execution {
	const upgraded: Execution = { ...prior, started };
	if (upgraded.managed) {
		upgraded.managed = {
			...upgraded.managed,
			body: upgraded.managed.body.replace(preparationBody(prior), preparationBody(upgraded)),
		};
	}
	return upgraded;
}
type CoordinatorContext =
	| Infrastructure
	| ApprovalGate
	| ReleaseEventOutbox
	| RunObservation
	| CoordinatorServices
	| AuditTrail
	| Background
	| PreparationWriter
	| PublicationLedger
	| ReleaseCommits
	| GitHubReleases
	| RefPublication
	| ReleaseSets
	| ReleaseWorkflowLauncher
	| RunCallbacks
	| TagSigner
	| TagSigning;
type CoordinatorEffect<A, E = never> = Effect.Effect<A, E, CoordinatorContext>;

export type Infrastructure = Automation;

function readSetupEdit(storage: DurableStorage['Service']): Effect.Effect<SetupEdit | undefined, DomainError> {
	return storage.read(Keys.setupEdit).pipe(
		Effect.flatMap(value => value === undefined ? Effect.undefined : fromSync(() => decodeSetupEditV1(value))),
	);
}

const setupEditSource = Layer.effectDiscard(Effect.gen(function*() {
	const planner = yield* AlarmPlanner;
	const storage = yield* DurableStorage;
	yield* planner.register({ due: () => readSetupEdit(storage).pipe(Effect.map(edit => [edit?.due])) });
}));

const journaled = Executions.use(service => service.read);
const allExecutions = Executions.use(service => service.all);
function storedExecution(id: string) {
	return Executions.use(service => service.stored(id));
}
function getExecution(id: string) {
	return Executions.use(service => service.get(id));
}
function putExecution(execution: Execution) {
	return Executions.use(service => service.put(execution));
}
function isolateExecution(id: string, error: DomainError) {
	return Executions.use(service => service.isolate(id, error));
}
function quarantineExecution(id: string, error: string) {
	return Executions.use(service => service.quarantine(id, error));
}
function pendingContinuations(observed: Execution) {
	return Executions.use(service => service.pendingContinuations(observed));
}
function continuationsOf(observed: Execution) {
	return Executions.use(service => service.continuations(observed));
}

const repositoryRevisions = Layer.effect(
	RepositoryRevisions,
	Effect.gen(function*() {
		const automation = yield* Automation;
		return RepositoryRevisions.of({ get: repositoryId => automation.store.repositories.get(repositoryId) });
	}),
);

const auditTrail = Layer.effect(
	AuditTrail,
	Effect.gen(function*() {
		const automation = yield* Automation;
		return AuditTrail.of({
			record: (action, target, failure) =>
				automation.store.audit('beepboop', action, target).pipe(logRecovered(failure, { target })),
		});
	}),
);

const registryVerification = Layer.effect(
	RegistryVerification,
	Effect.gen(function*() {
		const automation = yield* Automation;
		return RegistryVerification.of({
			verify: (repository, repositoryId, publication) =>
				verifyPublication(
					publication,
					automation.dependencies.transport,
					automation.gateway.verification(repository, repositoryId),
				),
		});
	}),
);

const projectionSink = Layer.effect(
	ProjectionSink,
	Effect.gen(function*() {
		const automation = yield* Automation;
		return ProjectionSink.of({ apply: rows => new ProjectionStore(automation.store.db, projectionRules).apply(rows) });
	}),
);

export class AutomationCoordinator extends DurableObject<CoordinatorBindings> {
	readonly #runtime: ManagedRuntime.ManagedRuntime<CoordinatorContext, DomainError>;
	constructor(
		ctx: DurableObjectState,
		env: CoordinatorBindings,
		infrastructure?: Layer.Layer<Infrastructure, DomainError>,
	) {
		super(ctx, env);
		this.#runtime = ManagedRuntime.make(
			Layer.mergeAll(
				jsonLogging,
				RefPublication.packageTagSchedule.pipe(
					Layer.provideMerge(
						Layer.merge(ApprovalGate.layer, RunObservation.layer).pipe(
							Layer.provideMerge(GitHubReleases.layer),
							Layer.provideMerge(ReleaseSets.layer),
							Layer.provideMerge(RefPublication.layer),
							Layer.provideMerge(Layer.merge(RunCallbacks.layer, TagSigning.layer)),
							Layer.provideMerge(Layer.merge(PreparationWriter.layer, ReleaseCommits.layer)),
							Layer.provideMerge(PublicationLedger.layer),
							Layer.provideMerge(ReleaseEventOutbox.layer),
							Layer.provideMerge(Background.layer(work => ctx.waitUntil(work))),
							Layer.provideMerge(TagSigner.layer(() => env.SIGNER)),
							Layer.provideMerge(ReleaseWorkflowLauncher.layer(() => env.RELEASE_WORKFLOW)),
							Layer.provideMerge(PublishPacing.layer(name => env.PUBLISH_BUDGET.getByName(name))),
							Layer.provideMerge(registryVerification),
							Layer.provideMerge(setupEditSource),
							Layer.provideMerge(coordinatorLayer(ctx.storage)),
							Layer.provide(Layer.merge(projectionSink, repositoryRevisions)),
							Layer.provideMerge(auditTrail),
							Layer.provideMerge(infrastructure ?? applicationLayer(env, work => ctx.waitUntil(work))),
						),
					),
				),
			),
		);
	}
	static dispose(coordinator: AutomationCoordinator): Promise<void> {
		return coordinator.#runtime.dispose();
	}
	private run<A, E>(
		work: CoordinatorEffect<A, E>,
		operation: string,
		fields: Record<string, string | number>,
	): Promise<A> {
		return this.#runtime.runPromise(
			work.pipe(Effect.withSpan(operation, { attributes: fields }), Effect.annotateLogs(fields)),
		);
	}
	private serial<A>(
		work: CoordinatorEffect<A, DomainError>,
		operation: string,
		fields: Record<string, string | number>,
	): Promise<A> {
		return this.run(CoordinatorLock.use(lock => lock.serialized(work)), operation, fields);
	}
	private readonly store = Effect.map(Automation, service => service.store);
	private readonly gateway = Effect.map(Automation, service => service.gateway);
	packageTags(
		repositoryId: number,
		stream: string,
		apply: boolean,
		after: string | undefined,
		actor: string,
	): Promise<PackageTagPage> {
		return this.run(
			RefPublication.use(publication => publication.packageTags(repositoryId, stream, apply, after, actor)),
			'coordinator.packageTags',
			{ repositoryId, stream },
		);
	}
	execution(id: string): Promise<Execution | undefined> {
		return this.run(storedExecution(id), 'coordinator.execution', { executionId: id });
	}
	openSubscriptionIssue(
		repository: string,
		repositoryId: number,
		id: string,
		issue: { title: string; body: string },
	): Promise<void> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const storage = yield* DurableStorage;
				if ((yield* storage.find(Keys.subscriptionIssue, id))?.kind === 'readable') return;
				yield* (yield* this.gateway).ensureIssue(repository, repositoryId, issue);
				yield* storage.put(Keys.subscriptionIssue, id, true);
			}),
			'coordinator.subscription.issue',
			{ repositoryId, deliveryId: id },
		);
	}
	preparationVersions(stream: string): Promise<string[]> {
		return this.run(
			allExecutions.pipe(
				Effect.map(
					executions => [
						...new Set(
							executions.flatMap(execution =>
								execution.stream === stream && execution.state === 'succeeded' && execution.version
									&& (execution.prepared?.result || execution.managed?.result)
									? [execution.version]
									: []
							),
						),
					],
				),
			),
			'coordinator.preparationVersions',
			{ stream },
		);
	}
	preparationResults(stream: string, version: string): Promise<PreparedRelease[]> {
		return this.run(
			allExecutions.pipe(Effect.map(executions =>
				executions.flatMap(execution => {
					const result = execution.prepared?.result ?? execution.managed?.result;
					return result && execution.stream === stream && execution.version === version
							&& execution.state === 'succeeded'
						? [{ ...result, ...(execution.started ? { started: execution.started } : {}) }]
						: [];
				})
			)),
			'coordinator.preparationResults',
			{},
		);
	}
	promotions(stream: string, version: string): Promise<Execution[]> {
		return this.run(
			allExecutions.pipe(Effect.map(executions =>
				executions
					.filter(execution =>
						execution.operation === 'promote' && execution.stream === stream && execution.version === version
					)
					.sort((left, right) => right.createdAt - left.createdAt)
			)),
			'coordinator.promotions',
			{},
		);
	}
	reindex(repositoryId: number): Promise<number> {
		return this.serial(Journal.use(journal => journal.reindex(repositoryId)), 'coordinator.reindex', {
			repositoryId,
		});
	}
	private suspended(repositoryId: number): CoordinatorEffect<boolean, DomainError> {
		return Effect.flatMap(Automation, automation => automation.suspended(repositoryId));
	}
	exportJournal(): Promise<{ key: string; value: unknown }[]> {
		return this.run(
			DurableStorage.use(storage => storage.dump),
			'coordinator.exportJournal',
			{},
		);
	}
	releaseEvents(): Promise<AutomationEvent[]> {
		return this.run(ReleaseEventOutbox.use(outbox => outbox.events), 'coordinator.releaseEvents', {});
	}
	acknowledgeReleaseEvent(id: string): Promise<void> {
		return this.run(ReleaseEventOutbox.use(outbox => outbox.acknowledge(id)), 'coordinator.acknowledgeReleaseEvent', {
			executionId: id,
		});
	}
	releaseOperations(preparationId: string, workflowId: string): Promise<ReleaseOperation[]> {
		return this.run(
			ReleaseSets.use(sets => sets.operations(preparationId, workflowId)),
			'coordinator.releaseOperations',
			{
				preparationId,
				workflowId,
			},
		);
	}
	reservePublication(preparationId: string, workflowId: string, id: string): Promise<number> {
		return this.serial(
			ReleaseSets.use(sets => sets.reserve(preparationId, workflowId, id)),
			'coordinator.reservePublication',
			{ preparationId, workflowId, executionId: id },
		);
	}
	operationDelay(preparationId: string, workflowId: string, id: string): Promise<number> {
		return this.run(
			ReleaseSets.use(sets => sets.delay(preparationId, workflowId, id)),
			'coordinator.operationDelay',
			{ preparationId, workflowId, executionId: id },
		);
	}
	advanceReleaseOperation(preparationId: string, workflowId: string, id: string): Promise<Execution['state']> {
		return this.serial(
			ReleaseSets.use(sets => sets.advance(preparationId, workflowId, id, member => this.reconcile(member))),
			'coordinator.advanceReleaseOperation',
			{ preparationId, workflowId, executionId: id },
		);
	}
	releaseWorkflowInterrupted(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(
			ReleaseSets.use(sets => sets.interrupted(preparationId, workflowId)),
			'coordinator.releaseWorkflowInterrupted',
			{ preparationId, workflowId },
		);
	}
	completeReleaseWorkflow(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(
			ReleaseSets.use(sets => sets.complete(preparationId, workflowId)),
			'coordinator.completeReleaseWorkflow',
			{ preparationId, workflowId },
		);
	}
	startReleaseSet(preparationId: string, target: string): Promise<Execution[]> {
		return this.serial(ReleaseSets.use(sets => sets.start(preparationId, target)), 'coordinator.startReleaseSet', {
			preparationId,
		});
	}
	enqueue(execution: Execution): Promise<Execution> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				if (Boolean(execution.workflow) === Boolean(execution.managed)) {
					return yield* precondition('Execution needs exactly one runner');
				}
				const prior = yield* storedExecution(execution.id);
				if (prior?.operation === 'prepare' && prior.versionPrMerge !== execution.versionPrMerge) {
					return yield* precondition(
						`${execution.version} of ${execution.stream} is already being prepared with versionPrMerge ${
							prior.versionPrMerge ?? 'from the stream'
						}`,
					);
				}
				if (
					prior?.state === 'awaiting-approval' && prior.approvedBy === undefined && execution.approvedBy === 'start'
				) {
					const started: Execution = {
						...prior,
						approvedBy: execution.approvedBy,
						...(execution.started ? { started: execution.started } : {}),
						...(execution.initiatedBy ? { initiatedBy: execution.initiatedBy } : {}),
					};
					yield* putExecution(started);
					return started;
				}
				if (prior?.operation === 'promote' && execution.approvedBy === 'start') {
					return yield* this.restartRelease(prior, execution);
				}
				if (prior?.operation === 'prepare' && execution.started && ['failed', 'cancelled'].includes(prior.state)) {
					return yield* this.restartPreparation(prior, execution.started);
				}
				if (
					prior?.operation === 'prepare' && execution.started
					&& (!prior.started || (execution.started.force && !prior.started.force))
				) {
					const upgraded = startedPreparation(prior, execution.started);
					yield* putExecution(upgraded);
					yield* this.restatePreparation(prior, upgraded);
					return upgraded;
				}
				if (prior) return prior;
				yield* this.supersedePending(execution);
				yield* putExecution(execution);
				return execution;
			}),
			'coordinator.enqueue',
			{ executionId: execution.id, repositoryId: execution.repositoryId },
		);
	}
	prepared(id: string, identity: RunIdentity, edits: Edit[]): Promise<{ url: string; head: string }> {
		return this.serial(RunCallbacks.use(callbacks => callbacks.prepared(id, identity, edits)), 'coordinator.prepared', {
			executionId: id,
		});
	}
	private supersedePending(execution: Execution): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (execution.configuration.streams[execution.stream]?.concurrency !== 'supersede-pending') return;
			for (const old of yield* allExecutions) {
				if (
					old.id !== execution.id && old.stream === execution.stream && old.operation === execution.operation
					&& ['pending', 'ready'].includes(old.state)
				) {
					yield* putExecution({ ...old, state: 'cancelled', reason: 'Superseded before dispatch' });
				}
			}
		});
	}
	private restartPreparation(prior: Execution, started: ReleaseStarted): CoordinatorEffect<Execution, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const upgraded = startedPreparation(prior, prior.started?.force ? { ...started, force: true } : started);
			yield* this.redispatch(upgraded, reopened(upgraded.publications), 'Start requested');
			yield* this.supersedePending(upgraded);
			yield* this.restatePreparation(prior, upgraded);
			return yield* getExecution(upgraded.id);
		});
	}
	private restatePreparation(prior: Execution, upgraded: Execution): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const previous = preparationBody(prior);
			const next = preparationBody(upgraded);
			const result = upgraded.prepared?.result ?? upgraded.managed?.result;
			if (result && result.kind !== 'commit' && previous !== next) {
				const work = restatePreparation(
					yield* this.gateway,
					upgraded.repository,
					upgraded.repositoryId,
					result.url,
					previous,
					next,
				).pipe(logRecovered('preparation.restate-failed', { executionId: upgraded.id, url: result.url }));
				yield* (yield* Background).fork(work);
			}
		});
	}
	register(id: string, identity: RunIdentity): Promise<Execution> {
		return this.serial(RunCallbacks.use(callbacks => callbacks.register(id, identity)), 'coordinator.register', {
			executionId: id,
		});
	}
	refs(
		id: string,
		identity: RunIdentity,
		complete = false,
		suppliedFiles: DistributionFile[] = [],
		artifact?: DistributionArtifact,
	): Promise<RefPlan> {
		return this.serial(
			refsRequest(complete, suppliedFiles, artifact).pipe(
				Effect.flatMap(request => RefPublication.use(publication => publication.refs(id, identity, request))),
			),
			'coordinator.refs',
			{ executionId: id },
		);
	}
	publishRelease(id: string, identity: RunIdentity): Promise<Execution> {
		return this.serial(
			GitHubReleases.use(releases => releases.publish(id, identity)),
			'coordinator.publishRelease',
			{ executionId: id },
		);
	}
	releasePublished(tag: string): Promise<void> {
		return this.serial(
			GitHubReleases.use(releases => releases.releasePublished(tag)),
			'coordinator.releasePublished',
			{},
		);
	}
	packagePublished(manager: string, name: string, version: string): Promise<void> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const gateway = yield* this.gateway;
				const transport = (yield* Automation).dependencies.transport;
				for (const execution of yield* allExecutions) {
					const matches = (publication: Publication) =>
						verifiableCancellation(publication) && publication.manager === manager && publication.name === name
						&& publication.version === version;
					if (!recoverable(execution) || !execution.publications.some(matches)) continue;
					const publications = yield* Effect.forEach(
						execution.publications,
						publication =>
							matches(publication)
								? verifyPublication(
									publication,
									transport,
									gateway.verification(execution.repository, execution.repositoryId),
								).pipe(
									Effect.map(checked => recheckedPublication(publication, verifiedPublication(publication, checked))),
								)
								: Effect.succeed(publication),
					);
					const next = rechecked({ ...execution, publications });
					if (JSON.stringify(next) !== JSON.stringify(execution)) yield* putExecution(next);
				}
			}),
			'coordinator.packagePublished',
			{ manager, name, version },
		);
	}
	report(
		id: string,
		identity: RunIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	): Promise<Execution> {
		return this.serial(
			RunCallbacks.use(callbacks => callbacks.report(id, identity, publications, artifacts)),
			'coordinator.report',
			{ executionId: id },
		);
	}
	publishNext(id: string, identity: RunIdentity): Promise<NextStep> {
		return this.serial(
			Effect.gen(function*() {
				const step = yield* (yield* PublicationLedger).next(id, identity);
				return step.kind === 'publish'
					? { ...step, package: yield* (yield* ApprovalGate).forced(id, step.package) }
					: step;
			}),
			'coordinator.publishNext',
			{ executionId: id },
		);
	}
	publishClaim(id: string, identity: RunIdentity, purl: string, digest: string): Promise<ClaimStep> {
		return this.serial(
			Effect.gen(function*() {
				const step = yield* (yield* PublicationLedger).claim(id, identity, purl, digest);
				return step.kind === 'publish'
					? { ...step, package: yield* (yield* ApprovalGate).forced(id, step.package) }
					: step;
			}),
			'coordinator.publishClaim',
			{ executionId: id },
		);
	}
	publishReport(id: string, identity: RunIdentity, report: PublishReport): Promise<ReportStep> {
		return this.serial(
			PublicationLedger.use(ledger => ledger.report(id, identity, report)),
			'coordinator.publishReport',
			{ executionId: id },
		);
	}
	approve(id: string, commitSha: string, actor: string, force = false): Promise<Execution> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const gate = yield* ApprovalGate;
				const commits = yield* ReleaseCommits;
				const execution = yield* getExecution(id);
				const reference = yield* Effect.fromResult(matches(commitSha, approvalShaPattern));
				const commit = yield* Effect.fromResult(sha(execution.sourceSha));
				if (execution.state !== 'awaiting-approval' || !commit.startsWith(reference)) {
					return yield* precondition('This release is not waiting for you to publish that commit');
				}
				const token = yield* (yield* this.gateway).token(execution.repository, execution.repositoryId);
				const head = yield* commits.head(execution, token);
				if (
					head
					&& (head.tag
						? head.sha !== execution.sourceSha
						: !(yield* commits.contains(execution, head.sha, token)))
				) {
					return yield* precondition(
						`${head.ref} is at ${head.sha.slice(0, 12)}. Publish the release for that commit.`,
					);
				}
				const conflict = yield* RefPublication.use(publication => publication.tagProblem(execution, true));
				if (conflict) return yield* precondition(conflict);
				const incomplete = yield* gate.metadataBlocks(execution);
				if (incomplete.length) return yield* precondition(incomplete.join('; '));
				const checks = yield* gate.checks(execution);
				const problems = [...checks.failed, ...checks.pending];
				if (problems.length && !force) return yield* precondition(problems.join('; '));
				return yield* gate.admit(
					execution,
					actor,
					`${id}:${commit}${problems.length ? ` overriding: ${problems.join('; ')}` : ''}${
						checks.skipped.length ? ` skipping: ${checks.skipped.join('; ')}` : ''
					}`,
				);
			}),
			'coordinator.approve',
			{ executionId: id },
		);
	}
	binaryProgress(id: string): Promise<BinaryProgress> {
		return this.run(
			Effect.gen({ self: this }, function*() {
				const execution = yield* getExecution(id);
				const release = execution.workflow?.setup?.binaries;
				if (!release || !execution.version) return { legs: [], assets: [] };
				const legs = binaryLegs(release, execution.version);
				const gateway = yield* this.gateway;
				const token = yield* gateway.token(execution.repository, execution.repositoryId, { actions: 'read' });
				const jobs = execution.runId
					? (yield* runJobs(
						gateway,
						execution.repository,
						{ id: execution.runId, run_attempt: execution.runAttempt ?? 1 },
						token,
					))
					: [];
				const draft = execution.draftRelease;
				const uploaded = new Set(
					draft
						? (yield* gateway.read(
							Schema.NullOr(releaseSchema),
							`/repos/${execution.repository}/releases/${draft.id}`,
							token,
						))?.assets.map(asset => asset.name) ?? []
						: [],
				);
				return {
					legs: legs.map(leg => {
						const job = jobs.find(entry => entry.name === leg.job);
						const kind = job ? classifyJob(job).kind : 'waiting';
						return {
							build: leg.build,
							target: leg.target,
							job: leg.job,
							state: jobProgressState(kind, job?.status === 'completed'),
							kind,
							...(job ? { status: job.status, conclusion: job.conclusion } : {}),
							...(job?.started_at ? { startedAt: job.started_at } : {}),
							...(job?.completed_at ? { completedAt: job.completed_at } : {}),
						};
					}),
					assets: legs.map(leg => ({
						build: leg.build,
						target: leg.target,
						name: leg.asset,
						uploaded: uploaded.has(leg.asset),
					})),
				};
			}),
			'coordinator.binaryProgress',
			{ executionId: id },
		);
	}
	approvalReadiness(id: string): Promise<{ problems: string[]; blocked: string[] }> {
		return this.run(
			Effect.gen(function*() {
				const gate = yield* ApprovalGate;
				const execution = yield* getExecution(id);
				if (execution.state !== 'awaiting-approval') {
					return { problems: [], blocked: ['This release is not waiting for you to publish it'] };
				}
				const [conflict, incomplete, problems] = yield* Effect.all([
					RefPublication.use(publication => publication.tagProblem(execution)),
					gate.metadataBlocks(execution),
					Effect.result(gate.problems(execution)),
				], { concurrency: 'unbounded' });
				if (conflict) return { problems: [], blocked: [`${conflict}. Release a new version.`] };
				if (incomplete.length) return { problems: [], blocked: incomplete };
				return { problems: yield* Effect.fromResult(problems), blocked: [] };
			}),
			'coordinator.approvalReadiness',
			{ executionId: id },
		);
	}
	gates(repositoryId: number, stream: string): Promise<StreamGates> {
		return this.run(ApprovalGate.use(gate => gate.gates(repositoryId, stream)), 'coordinator.gates', {
			repositoryId,
			stream,
		});
	}
	resolveChecks(id: string, choice: CheckChoice, actor: string): Promise<Execution> {
		return this.serial(ApprovalGate.use(gate => gate.resolveChecks(id, choice, actor)), 'coordinator.resolveChecks', {
			executionId: id,
		});
	}
	reclaimable(
		repositoryId: number,
		stream: string,
		version: string,
		primary: string,
		conflicts: RefState[],
	): Promise<RefState[]> {
		return this.run(
			RefPublication.use(publication => publication.reclaimable(repositoryId, stream, version, primary, conflicts)),
			'coordinator.reclaimable',
			{ repositoryId, stream, version },
		);
	}
	private redispatch(
		execution: Execution,
		publications: Publication[],
		requested: string,
	): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const gateway = yield* this.gateway;
			const token = yield* gateway.token(execution.repository, execution.repositoryId, {
				contents: 'read',
				actions: 'write',
			});
			const run = execution.runId
				? yield* gateway.read(
					workflowRunSchema,
					`/repos/${execution.repository}/actions/runs/${execution.runId}`,
					token,
				)
				: null;
			const moved = yield* (yield* ReleaseCommits).moved(
				execution,
				token,
				typeof run?.head_branch === 'string' ? run.head_branch : undefined,
			);
			if (
				moved
				&& !(run !== null && run.head_sha === execution.sourceSha
					&& (yield* RefPublication.use(publication => publication.versionTagged(execution))))
			) return yield* precondition(moved);
			if (run !== null && execution.eventId.startsWith('observed:') && run.conclusion === 'success') {
				return yield* precondition(
					`Workflow run ${run.id} succeeded, so it has no failed jobs to re-run. Fix the reported problem and re-run the workflow on GitHub`,
				);
			}
			if (run !== null && (run.head_sha === execution.sourceSha || execution.currentWorkflow)) {
				yield* gateway.call(
					`/repos/${execution.repository}/actions/runs/${execution.runId}/rerun-failed-jobs`,
					token,
					'POST',
				);
				yield* putExecution({
					...execution,
					state: 'uncertain',
					github: undefined,
					cancelledBy: undefined,
					runAttempt: run.run_attempt,
					reason: `${requested}; re-running the failed jobs`,
					publications,
				});
			} else {
				yield* putExecution({
					...execution,
					state: 'ready',
					cancelledBy: undefined,
					supersededRuns: [...(execution.supersededRuns ?? []), ...(execution.runId ? [execution.runId] : [])],
					runId: undefined,
					runAttempt: undefined,
					github: undefined,
					workflowSha: undefined,
					reason: `${requested}; dispatching a new run`,
					publications,
				});
			}
			yield* (yield* AlarmPlanner).requestReconcile(clock.currentTimeMillisUnsafe());
		});
	}
	private retryable(
		execution: Execution,
		run: Pick<WorkflowRun, 'id' | 'run_attempt'>,
		result: GitHubRunResult,
	): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			// Classify GitHub first: ledger evidence must never override cancellation,
			// action required, a startup failure, or incomplete/unknown job evidence.
			if (!result.retry) return false;
			const ledger = yield* (yield* LedgerStore).get(execution.id);
			if (ledger === undefined) return result.retry === 'runner-unassigned';
			const open = ledger.records.filter(record =>
				record.required && !released(record) && record.status.state !== 'uploaded'
			);
			if (!open.length) return false;
			const holder = `${run.id}:${run.run_attempt}`;
			return open.every(record =>
				(record.status.state === 'failed-retryable' && record.status.holder === holder)
				|| (result.retry === 'runner-unassigned' && record.status.state === 'planned')
			);
		});
	}

	private restartRelease(prior: Execution, request: Execution): CoordinatorEffect<Execution, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const force = request.started?.force === true;
			if (!['failed', 'cancelled', 'awaiting-approval'].includes(prior.state)) return prior;
			if (prior.state === 'awaiting-approval' && !force) return prior;
			const started: Execution = {
				...prior,
				approvedBy: 'start',
				...(request.started ? { started: request.started } : {}),
				...(request.initiatedBy ? { initiatedBy: request.initiatedBy } : {}),
			};
			if (prior.state !== 'awaiting-approval' && (prior.attempts > 0 || prior.approvedAt !== undefined)) {
				if (!force) return prior;
				if (!prior.workflow) {
					yield* this.redispatch(started, reopened(prior.publications), 'Forced restart');
					return yield* getExecution(prior.id);
				}
				const rerun: Execution = {
					...freshRun(started, prior.workflow),
					reason: `Dispatching ${prior.workflow.file} again for ${prior.sourceSha.slice(0, 12)}`,
				};
				yield* putExecution(rerun);
				yield* this.wakeUp();
				return rerun;
			}
			const waiting: Execution = { ...started, state: 'awaiting-approval', publications: reopened(prior.publications) };
			delete waiting.reason;
			yield* putExecution(waiting);
			yield* this.wakeUp();
			return waiting;
		});
	}
	private dispatchCurrentWorkflow(execution: Execution): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;
			if (execution.operation !== 'promote' || !['failed', 'cancelled'].includes(execution.state)) {
				return yield* precondition('Only a failed or cancelled promotion can run the current workflow');
			}
			if (execution.attempts === 0 && execution.approvedAt === undefined) {
				return yield* precondition('Publish this promotion first; it never ran');
			}
			const record = yield* (yield* this.store).repositories.get(execution.repositoryId);
			const current = record
				&& (record.configuration?.streams[execution.stream]?.promote.workflow?.ref ?? record.defaultBranch);
			const workflow = execution.workflow && current && current !== execution.workflow.ref
				? { ...execution.workflow, ref: current }
				: execution.workflow;
			if (!(yield* RefPublication.use(publication => publication.versionTagged(execution)))) {
				return yield* precondition(
					`The version tags of ${execution.version ?? 'this release'} do not all target ${
						execution.sourceSha.slice(0, 12)
					}; retry the operation instead`,
				);
			}
			yield* putExecution({
				...freshRun(execution, workflow),
				currentWorkflow: true,
				reason: `Dispatching the current ${execution.workflow?.file ?? 'workflow'} for ${
					execution.sourceSha.slice(0, 12)
				}`,
			});
			yield* (yield* AlarmPlanner).requestReconcile(clock.currentTimeMillisUnsafe());
		});
	}
	recover(id: string, action: 'reconcile' | 'retry' | 'redispatch', actor: string): Promise<Execution> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				if (action === 'reconcile') yield* (yield* DurableStorage).remove(Keys.quarantine, id);
				const execution = yield* getExecution(id);
				const takeover = action === 'reconcile' || execution.operation !== 'promote'
					? undefined
					: (yield* allExecutions).find(other =>
						other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
						&& other.version === execution.version && (other.reclaims?.length ?? 0) > 0
						&& !['failed', 'cancelled'].includes(other.state)
					);
				if (takeover) {
					return yield* precondition(
						`Release ${takeover.id} takes over the version tag of ${execution.version}; retry that release instead`,
					);
				}
				if (action === 'redispatch') yield* this.dispatchCurrentWorkflow(execution);
				else if (action === 'retry') {
					if (!['failed', 'cancelled'].includes(execution.state)) {
						return yield* precondition('Only failed or cancelled operations can be retried');
					}
					if (execution.operation === 'prepare' && !execution.plan && !execution.managed) {
						return yield* precondition('This preparation has no plan; prepare the release from Prepare a release');
					}
					if (execution.artifacts.some((a) => Date.parse(a.expiresAt) <= clock.currentTimeMillisUnsafe())) {
						return yield* precondition('Artifacts expired; use the configured preparation/recovery producer');
					}
					const publications = reopened(execution.publications);
					if (execution.operation === 'promote' && execution.attempts === 0 && execution.approvedAt === undefined) {
						const next: Execution = { ...execution, state: 'awaiting-approval', publications };
						delete next.reason;
						yield* putExecution(next);
						yield* this.wakeUp();
					} else yield* this.redispatch(execution, publications, 'Retry requested');
				} else {
					const published = yield* GitHubReleases.use(releases => releases.published(execution));
					if (published !== execution) yield* putExecution(published);
					yield* this.wakeUp();
				}
				yield* (yield* ReleaseSets).resume(execution);
				yield* (yield* this.store).audit(actor, `execution.${action}`, id);
				return yield* getExecution(id);
			}),
			'coordinator.recover',
			{ executionId: id },
		);
	}
	cancel(id: string, actor: string): Promise<Execution> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const execution = yield* getExecution(id);
				if (execution.state === 'succeeded' || (execution.state === 'cancelled' && !recoverable(execution))) {
					return yield* precondition('Execution has already finished');
				}
				if (execution.runId) {
					const gateway = yield* this.gateway;
					const token = yield* gateway.token(execution.repository, execution.repositoryId, {
						contents: 'read',
						actions: 'write',
					});
					const path = `/repos/${execution.repository}/actions/runs/${execution.runId}`;
					const run = yield* gateway.read(workflowRunSchema, path, token);
					if (run.status === 'completed' && run.conclusion === 'success') {
						return yield* precondition('Workflow run has already completed successfully; reconcile this operation');
					}
					if (run.status !== 'completed') {
						const cancelled = yield* Effect.result(gateway.call(`${path}/cancel`, token, 'POST'));
						const checked = yield* Effect.result(gateway.read(workflowRunSchema, path, token));
						if (
							checked._tag === 'Success' && checked.success.status === 'completed'
							&& checked.success.conclusion === 'success'
						) {
							return yield* precondition('Workflow run has already completed successfully; reconcile this operation');
						}
						if (cancelled._tag === 'Failure') return yield* cancelled.failure;
					}
				}
				const next: Execution = {
					...execution,
					state: 'cancelled',
					cancelledBy: actor,
					reason: `Cancelled by ${actor}`,
				};
				yield* putExecution(next);
				yield* (yield* this.store).audit(actor, 'execution.cancel', id);
				return next;
			}),
			'coordinator.cancel',
			{ executionId: id },
		);
	}
	private wakeUp(): CoordinatorEffect<void, DomainError> {
		return Effect.gen(function*() {
			yield* wakeUp(yield* ReleaseSets, yield* AlarmPlanner);
		});
	}
	wake(): Promise<void> {
		return this.run(this.wakeUp(), 'coordinator.wake', {});
	}
	receive(delivery: string, repositoryId: number, event: InboxEvent): Promise<void> {
		return this.run(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const storage = yield* DurableStorage;
				if (yield* storage.has(Keys.inbox, delivery)) return;
				const now = clock.currentTimeMillisUnsafe();
				yield* storage.put(Keys.inbox, delivery, { delivery, repositoryId, event, attempts: 0, due: now });
				yield* (yield* AlarmPlanner).arm(now);
			}),
			'coordinator.receive',
			{ repositoryId, deliveryId: delivery },
		);
	}
	observeRun(repositoryId: number, runId: number): Promise<void> {
		return this.serial(
			RunObservation.use(observation => observation.observeRun(repositoryId, runId)),
			'coordinator.observeRun',
			{
				repositoryId,
			},
		);
	}
	trackRun(repositoryId: number, runId: number): Promise<void> {
		return this.serial(
			RunObservation.use(observation => observation.trackRun(repositoryId, runId)),
			'coordinator.trackRun',
			{
				repositoryId,
			},
		);
	}
	private setupEdit(): CoordinatorEffect<SetupEdit | undefined, DomainError> {
		return DurableStorage.use(readSetupEdit);
	}
	setupEdited(edit: Omit<SetupEdit, 'due'>, changed: boolean): Promise<boolean> {
		return this.run(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const previous = yield* this.setupEdit();
				if (previous ? previous.number === edit.number && previous.body === edit.body : !changed) return false;
				const due = clock.currentTimeMillisUnsafe() + 5000;
				yield* (yield* DurableStorage).write(Keys.setupEdit, { ...edit, due });
				yield* (yield* AlarmPlanner).arm(due);
				return true;
			}),
			'coordinator.setupEdited',
			{},
		);
	}
	private rebuildSetup(): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const edit = yield* this.setupEdit();
			if (!edit || edit.due > clock.currentTimeMillisUnsafe()) return;
			const store = yield* this.store;
			yield* Effect.gen({ self: this }, function*() {
				const repository = yield* store.repositories.get(edit.repositoryId);
				if (repository && readiness(repository).kind !== 'suspended') {
					const gateway = yield* this.gateway;
					const snapshot = yield* repositorySnapshot(gateway, repository.name, repository.id);
					yield* maintainSetup(store, gateway, snapshot, (yield* Automation).publishingAccess(snapshot.repository), {
						number: edit.number,
						choices: edit.choices,
					});
				}
			}).pipe(
				store.auditFailure('beepboop', 'repository.setup.failed', `${edit.repositoryId} ${edit.head}`),
			);
			const current = yield* this.setupEdit();
			if (current?.due === edit.due) yield* (yield* DurableStorage).clear(Keys.setupEdit);
		});
	}
	alarm(): Promise<void> {
		return this.run(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const now = clock.currentTimeMillisUnsafe();
				const lock = yield* CoordinatorLock;
				yield* (yield* InboxQueue).drain(
					now,
					entry =>
						withAutomation(service => service.receive(entry.delivery, entry.repositoryId, entry.event)).pipe(
							Effect.as(undefined),
						),
				);
				yield* Effect.all([
					lock.serialized(Effect.gen({ self: this }, function*() {
						yield* (yield* ReleaseSets).deliver(now);
						const observation = yield* RunObservation;
						yield* (yield* ObserveQueue).drain(now, event => Effect.as(observation.observe(event), undefined));
						yield* (yield* TrackQueue).drain(
							now,
							event => observation.track(event).pipe(Effect.map(done => done ? undefined : trackLater(event, now))),
						);
						if (yield* (yield* AlarmPlanner).reconcileDue(now)) yield* this.reconcile();
					})),
					lock.serialized(this.rebuildSetup()),
				], { concurrency: 'unbounded' });
				yield* (yield* AlarmPlanner).reschedule;
			}),
			'coordinator.alarm',
			{},
		);
	}
	private runManaged(execution: Execution): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const operation = execution.managed;
			if (!operation || execution.workflow) return yield* precondition('Invalid managed operation');
			yield* Effect.gen({ self: this }, function*() {
				if (operation.result) {
					yield* putExecution({ ...execution, state: 'succeeded' });
					return;
				}
				if (operation.plan.requiresPreparation || operation.plan.sourceSha !== execution.sourceSha) {
					return yield* precondition('Managed preparation plan is not executable');
				}
				const snapshot = yield* repositorySnapshot(
					yield* this.gateway,
					execution.repository,
					execution.repositoryId,
					execution.sourceSha,
					operation.plan.edits.map(edit => edit.path),
				);
				execution.state = 'running';
				execution.attempts++;
				yield* putExecution(execution);
				operation.result = yield* (yield* PreparationWriter).submit(
					preparationRequest(execution, operation, snapshot, {
						branch: operation.branch,
						title: operation.title,
						body: operation.body,
						edits: operation.plan.edits,
					}),
				);
				execution.state = 'succeeded';
				delete execution.reason;
				yield* putExecution(execution);
			}).pipe(
				recover(error =>
					putExecution({
						...execution,
						state: landsByCommit(execution) && error.problem.code === 'precondition' ? 'failed' : 'uncertain',
						reason: decodeError(error),
					})
				),
			);
		});
	}
	private dispatch(
		execution: Execution,
		executions: Execution[],
		active: Execution[],
		busy: Set<string>,
	): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const workflow = execution.workflow;
			if (!workflow) return yield* precondition('Execution has no runner');
			const gateway = yield* this.gateway;
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
					run.status === 'completed' && execution.state === 'uncertain' && !execution.github
					&& runAttempt <= (execution.runAttempt ?? 0)
					&& !execution.publications.some(recheckable)
				) {
					return;
				}
				const result = classifyRun(
					run,
					run.status === 'completed' ? yield* runJobs(gateway, execution.repository, run, token) : [],
				);
				if (result.observation.completed) {
					for (let i = 0; i < execution.publications.length; i++) {
						const publication = execution.publications[i];
						if (
							publication
							&& (recheckable(publication)
								|| verifiableCancellation(publication))
						) {
							const context = (yield* this.gateway).verification(execution.repository, execution.repositoryId);
							const transport = (yield* Automation).dependencies.transport;
							execution.publications[i] = recheckedPublication(
								publication,
								verifiedPublication(publication, yield* verifyPublication(publication, transport, context)),
							);
						}
					}
					for (const reference of unreported(execution)) {
						const probe = execution.version ? referenceProbe(reference, execution.version) : undefined;
						if (!probe || !canVerifyPublication(probe.manager)) continue;
						const context = (yield* this.gateway).verification(execution.repository, execution.repositoryId);
						const transport = (yield* Automation).dependencies.transport;
						const checked = yield* verifyPublication(probe, transport, context);
						if (checked._tag === 'Published') execution.publications.push(verifiedPublication(probe, checked));
					}
					const limited = execution.publications.flatMap(publication =>
						publication.outcome === 'rate-limited' ? [Date.parse(publication.retryAfter)] : []
					);
					if (
						limited.length && (result.retry || result.observation.kind === 'succeeded'
							|| (!result.jobs.length && ['failed', 'timed-out'].includes(result.observation.kind)))
					) {
						yield* (yield* ReleaseSets).rateLimited(execution, runId, limited);
						return;
					}
					const settled = settleRun(execution, result);
					if (
						settled.state === 'failed' && runAttempt <= automaticRetries
						&& (yield* this.retryable(execution, run, result))
					) {
						const retried = yield* Effect.result(this.redispatch(
							{ ...execution, runAttempt },
							reopened(execution.publications),
							`Attempt ${runAttempt}: ${githubFailureReason(result)}; retrying open publications`,
						));
						if (retried._tag === 'Success') return;
					}
					const ended = {
						...settled,
						runAttempt: execution.workflow?.refs?.distribution && !execution.refPlan
							? execution.runAttempt
							: runAttempt,
					};
					yield* putExecution(
						yield* GitHubReleases.use(releases => releases.published(ended)).pipe(
							recover(error =>
								logFailure('release.recheck-failed', error, { executionId: ended.id }).pipe(Effect.as(ended))
							),
						),
					);
				} else {
					const next = { ...settleRun(execution, result), runAttempt };
					if (
						next.state !== execution.state || next.reason !== execution.reason || runAttempt !== execution.runAttempt
						|| JSON.stringify(next.github) !== JSON.stringify(execution.github)
					) yield* putExecution(next);
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
					yield* putExecution({
						...execution,
						state: 'running',
						runId: run.id,
						runAttempt: run.run_attempt,
						workflowSha: undefined,
					});
				} else {
					yield* putExecution({
						...execution,
						state: 'uncertain',
						reason: matches.length
							? 'Multiple matching runs require review'
							: 'Dispatch outcome awaiting reconciliation',
					});
				}
				return;
			}
			if (!dependenciesReady(execution, executions) || (execution.notBefore ?? 0) > clock.currentTimeMillisUnsafe()) {
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
			const reason = yield* (yield* ReleaseCommits).moved(execution, token);
			if (reason) {
				yield* putExecution({ ...execution, state: 'failed', reason });
				return;
			}
			execution.resolvedInputs = yield* resolveInputs(execution, executions);
			const draftRelease = yield* GitHubReleases.use(releases => releases.draft(execution));
			if (draftRelease) execution.draftRelease = draftRelease;
			busy.add(execution.stream);
			yield* putExecution({
				...execution,
				state: 'dispatching',
				attempts: execution.attempts + 1,
				dispatchedAt: clock.currentTimeMillisUnsafe(),
			});
			const dispatched = yield* Effect.result(gateway.read(
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
			));
			if (dispatched._tag === 'Failure') {
				const error = dispatched.failure;
				if (!(error instanceof GitHubRejection)) return yield* error;
				yield* putExecution({
					...execution,
					state: error.retryAt === undefined ? 'failed' : 'ready',
					attempts: execution.attempts + 1,
					notBefore: error.retryAt,
					reason: `Dispatch rejected: ${decodeError(error)}`,
				});
				return;
			}
			const runId = dispatched.success?.workflow_run_id;
			if (runId) {
				yield* putExecution({ ...execution, state: 'running', attempts: execution.attempts + 1, runId });
			}
		}).pipe(
			recover(error =>
				Effect.gen({ self: this }, function*() {
					const reason = `Beepboop could not continue: ${decodeError(error)}`;
					const current = yield* getExecution(execution.id);
					if (current.reason !== reason) yield* putExecution({ ...current, reason });
				})
			),
		);
	}
	private hasAdvanceWork(
		execution: Execution,
		unresolved: (execution: Execution) => boolean,
	): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (
				!['succeeded', 'failed', 'cancelled', 'pending'].includes(execution.state) || unresolved(execution)
				|| publishedAfterFailure(execution)
			) return true;
			if (yield* (yield* PublicationLedger).owesReceipts(execution)) return true;
			return execution.state === 'succeeded'
				&& ((yield* pendingContinuations(execution)).length > 0
					|| (yield* (yield* ReleaseEventOutbox).owed(execution)));
		});
	}
	private advance(
		execution: Execution,
		executions: Execution[],
		active: Execution[],
		busy: Set<string>,
		unresolved: (execution: Execution) => boolean,
	): CoordinatorEffect<'continue' | 'stop', DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (yield* (yield* PublicationLedger).settleReceipts(execution)) return 'continue' as const;

			if (unresolved(execution)) {
				const context = (yield* this.gateway).verification(execution.repository, execution.repositoryId);
				const transport = (yield* Automation).dependencies.transport;
				const publications = yield* Effect.forEach(
					execution.publications,
					publication =>
						recheckable(publication)
							? verifyPublication(publication, transport, context).pipe(
								Effect.map(outcome => verifiedPublication(publication, outcome)),
							)
							: Effect.succeed(publication),
					{ concurrency: 'unbounded' },
				);
				if (publications.some((publication, i) => publication.outcome !== execution.publications[i]?.outcome)) {
					const checked = { ...execution, publications };
					yield* putExecution(publishedAfterFailure(checked) ?? checked);
					return 'continue' as const;
				}
			}
			const published = publishedAfterFailure(execution);
			if (published) {
				yield* putExecution(published);
				return 'continue' as const;
			}
			if (execution.state === 'succeeded') {
				if ((yield* continuationsOf(execution)).length) yield* putExecution(execution);
				else yield* (yield* ReleaseEventOutbox).capture(execution);
			}
			if (!active.includes(execution) || execution.state === 'pending') return 'continue' as const;
			if (execution.state === 'awaiting-approval') return yield* (yield* ApprovalGate).review(execution, executions);
			if (execution.managed) {
				yield* this.runManaged(execution);
				return 'continue' as const;
			}
			yield* this.dispatch(execution, executions, active, busy);
			return 'continue' as const;
		});
	}
	private reconcile(onlyExecution?: string): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const storage = yield* DurableStorage;
			const planner = yield* AlarmPlanner;
			const started = clock.currentTimeMillisUnsafe();
			if (!onlyExecution) yield* planner.holdReconcile(started + reconcileInterval);
			const journal = yield* journaled;
			const quarantined = new Set(yield* storage.ids(Keys.quarantine));
			for (const entry of journal.unreadable) {
				if (!quarantined.has(entry.id)) yield* quarantineExecution(entry.id, entry.error);
			}
			const executions = journal.executions.filter(execution => !quarantined.has(execution.id)).sort((a, b) =>
				a.createdAt - b.createdAt
			);
			if (executions[0] && (yield* this.suspended(executions[0].repositoryId))) {
				return;
			}
			if (!onlyExecution) yield* planner.releaseReconcile;
			const active = executions.filter(
				(e) => !['succeeded', 'cancelled', 'failed'].includes(e.state),
			);
			const busy = new Set(
				active
					.filter((e) => ['dispatching', 'running', 'uncertain'].includes(e.state))
					.map((e) => e.stream),
			);
			const unresolved = (execution: Execution) =>
				(execution.state === 'succeeded' || recoverable(execution)) && execution.publications.some(recheckable);
			if (active.some(e => !e.releaseSet?.workflowId) || executions.some(unresolved)) {
				yield* planner.requestReconcile(started + reconcileInterval);
			}
			const releaseHistory = new ReleaseHistory(journal.executions);
			yield* (yield* ReconcileHistory).set(releaseHistory);
			for (const execution of executions) {
				if (onlyExecution ? execution.id !== onlyExecution : Boolean(execution.releaseSet?.workflowId)) continue;
				const work = yield* Effect.result(this.hasAdvanceWork(execution, unresolved));
				if (work._tag === 'Success' && !work.success) continue;
				if (yield* this.suspended(execution.repositoryId)) return;
				if (work._tag === 'Failure') {
					yield* isolateExecution(execution.id, work.failure);
					continue;
				}
				const outcome = yield* this.advance(execution, executions, active, busy, unresolved).pipe(
					recover(error => isolateExecution(execution.id, error).pipe(Effect.as('continue' as const))),
				);
				if (outcome === 'stop') return;
			}
		}).pipe(Effect.ensuring(ReconcileHistory.use(history => history.set(undefined))));
	}
}
