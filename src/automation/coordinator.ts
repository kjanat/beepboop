import { DurableObject } from 'cloudflare:workers';
import { Clock, Effect, Layer, ManagedRuntime } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import { ApprovalGate } from '@/automation/approval-gate.ts';
import { Dispatcher } from '@/automation/dispatcher.ts';
import type { RecoveryAction } from '@/automation/execution-control.ts';
import { ExecutionControl } from '@/automation/execution-control.ts';
import { GitHubReleases } from '@/automation/github-releases.ts';
import { ManagedPreparation } from '@/automation/managed-preparation.ts';
import { PreparationWriter } from '@/automation/preparation-writer.ts';
import { PublicationRecheck } from '@/automation/publication-recheck.ts';
import type { PublishBudget } from '@/automation/publish-budget';
import { Reconciler } from '@/automation/reconciler.ts';
import { RefPublication } from '@/automation/ref-publication.ts';
import { ReleaseCommits } from '@/automation/release-commits.ts';
import { ReleaseEventOutbox } from '@/automation/release-event-outbox.ts';
import { ReleaseSets } from '@/automation/release-sets.ts';
import type { ReleaseWorkflowParams } from '@/automation/release-workflow';
import { ReleaseWorkflowLauncher } from '@/automation/release-workflow-launcher.ts';
import { RunCallbacks } from '@/automation/run-callbacks.ts';
import { RunObservation } from '@/automation/run-observation.ts';
import type { AutomationBindings } from '@/automation/service';
import { Automation, applicationLayer, withAutomation } from '@/automation/service';
import { repositorySnapshot } from '@/automation/snapshot';
import { TagSigning } from '@/automation/tag-signing.ts';
import type { BinaryProgress, PackageTagPage, StreamGates } from '@/contract/views';
import type { Edit } from '@/domain/inventory.ts';
import type { RefPlan, RefState, TagSigner as SignerBinding } from '@/domain/refs.ts';
import type { CheckChoice } from '@/domain/release-gates.ts';
import { readiness } from '@/domain/repository';
import { TagSigner } from '@/github/signing.ts';
import type { InboxEvent } from '@/github/webhooks.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import { jsonLogging } from '@/kernel/logging/json-logging.ts';
import type { SqlDatabase } from '@/persistence/d1/database';
import { ProjectionStore } from '@/persistence/d1/projection';
import { ProjectionSink } from '@/persistence/durable/journal.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { ClaimStep, NextStep, PublishReport, ReportStep } from '@/publication/contract.ts';
import { PublicationLedger, RegistryVerification } from '@/publication/ledger/service.ts';
import type { Publication } from '@/publication/publication.ts';
import { PublishPacing } from '@/publication/publish-pace.ts';
import { verifyPublication } from '@/publication/registries/verify.ts';
import { projectionRules } from '@/release/adapters/d1/completions.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import type { DistributionArtifact } from '@/release/distribution/artifact.ts';
import type { DistributionFile } from '@/release/distribution/validation.ts';
import type { Artifact, AutomationEvent, Execution, PreparedRelease } from '@/release/domain/execution/types.ts';
import { refsRequest } from '@/release/domain/refs-request.ts';
import type { ReleaseOperation } from '@/release/domain/release-set.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { Background } from '@/release/services/coordinator/background.ts';
import { CoordinatorLock } from '@/release/services/coordinator/coordinator-lock.ts';
import { RepositoryRevisions } from '@/release/services/coordinator/executions.ts';
import type { CoordinatorServices } from '@/release/services/coordinator/layer.ts';
import { coordinatorLayer } from '@/release/services/coordinator/layer.ts';
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

export interface CoordinatorBindings extends AutomationBindings {
	DB: SqlDatabase;
	OWNER_ID: string;
	RELEASE_WORKFLOW: Workflow<ReleaseWorkflowParams>;
	PUBLISH_BUDGET: DurableObjectNamespace<PublishBudget>;
	SIGNER?: SignerBinding;
}
type CoordinatorContext =
	| Infrastructure
	| ApprovalGate
	| ExecutionControl
	| Dispatcher
	| ManagedPreparation
	| PublicationRecheck
	| Reconciler
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
						Layer.merge(Reconciler.layer, ExecutionControl.layer).pipe(
							Layer.provideMerge(Layer.merge(Dispatcher.layer, ManagedPreparation.layer)),
							Layer.provideMerge(Layer.mergeAll(ApprovalGate.layer, RunObservation.layer, PublicationRecheck.layer)),
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
		return this.run(ExecutionControl.use(control => control.execution(id)), 'coordinator.execution', {
			executionId: id,
		});
	}
	openSubscriptionIssue(
		repository: string,
		repositoryId: number,
		id: string,
		issue: { title: string; body: string },
	): Promise<void> {
		return this.serial(
			ExecutionControl.use(control => control.openSubscriptionIssue(repository, repositoryId, id, issue)),
			'coordinator.subscription.issue',
			{ repositoryId, deliveryId: id },
		);
	}
	preparationVersions(stream: string): Promise<string[]> {
		return this.run(
			ExecutionControl.use(control => control.preparationVersions(stream)),
			'coordinator.preparationVersions',
			{
				stream,
			},
		);
	}
	preparationResults(stream: string, version: string): Promise<PreparedRelease[]> {
		return this.run(
			ExecutionControl.use(control => control.preparationResults(stream, version)),
			'coordinator.preparationResults',
			{},
		);
	}
	promotions(stream: string, version: string): Promise<Execution[]> {
		return this.run(ExecutionControl.use(control => control.promotions(stream, version)), 'coordinator.promotions', {});
	}
	reindex(repositoryId: number): Promise<number> {
		return this.serial(ExecutionControl.use(control => control.reindex(repositoryId)), 'coordinator.reindex', {
			repositoryId,
		});
	}
	exportJournal(): Promise<{ key: string; value: unknown }[]> {
		return this.run(ExecutionControl.use(control => control.exportJournal), 'coordinator.exportJournal', {});
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
			Effect.flatMap(
				Reconciler,
				reconciler =>
					ReleaseSets.use(sets => sets.advance(preparationId, workflowId, id, member => reconciler.reconcile(member))),
			),
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
		return this.serial(ExecutionControl.use(control => control.enqueue(execution)), 'coordinator.enqueue', {
			executionId: execution.id,
			repositoryId: execution.repositoryId,
		});
	}
	prepared(id: string, identity: RunIdentity, edits: Edit[]): Promise<{ url: string; head: string }> {
		return this.serial(RunCallbacks.use(callbacks => callbacks.prepared(id, identity, edits)), 'coordinator.prepared', {
			executionId: id,
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
			PublicationRecheck.use(recheck => recheck.packagePublished(manager, name, version)),
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
			ExecutionControl.use(control => control.approve(id, commitSha, actor, force)),
			'coordinator.approve',
			{
				executionId: id,
			},
		);
	}
	binaryProgress(id: string): Promise<BinaryProgress> {
		return this.run(ExecutionControl.use(control => control.binaryProgress(id)), 'coordinator.binaryProgress', {
			executionId: id,
		});
	}
	approvalReadiness(id: string): Promise<{ problems: string[]; blocked: string[] }> {
		return this.run(ExecutionControl.use(control => control.approvalReadiness(id)), 'coordinator.approvalReadiness', {
			executionId: id,
		});
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

	recover(id: string, action: RecoveryAction, actor: string): Promise<Execution> {
		return this.serial(ExecutionControl.use(control => control.recover(id, action, actor)), 'coordinator.recover', {
			executionId: id,
		});
	}
	cancel(id: string, actor: string): Promise<Execution> {
		return this.serial(ExecutionControl.use(control => control.cancel(id, actor)), 'coordinator.cancel', {
			executionId: id,
		});
	}
	wake(): Promise<void> {
		return this.run(ExecutionControl.use(control => control.wake), 'coordinator.wake', {});
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
						if (yield* (yield* AlarmPlanner).reconcileDue(now)) yield* (yield* Reconciler).reconcile();
					})),
					lock.serialized(this.rebuildSetup()),
				], { concurrency: 'unbounded' });
				yield* (yield* AlarmPlanner).reschedule;
			}),
			'coordinator.alarm',
			{},
		);
	}
}
