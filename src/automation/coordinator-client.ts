import { Context, Effect, Layer, Schema } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import type { BinaryProgress, ExecutionStateView, PackageTagPage, StreamGates } from '@/contract/views';
import { approvalReadiness, binaryProgress, executionStates, packageTagPage, streamGates } from '@/contract/views';
import type { Edit } from '@/domain/inventory.ts';
import type { RefPlan, RefState } from '@/domain/refs.ts';
import type { CheckChoice } from '@/domain/release-gates.ts';
import type { InboxEvent } from '@/github/webhooks.ts';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { decodeSync, mutableArray } from '@/kernel/schema/structs.ts';
import type { ClaimStep, NextStep, PublishReport, ReportStep } from '@/publication/contract.ts';
import { claimStep, nextStep, reportStep } from '@/publication/contract.ts';
import type { Publication } from '@/publication/publication.ts';
import type { DistributionArtifact } from '@/release/distribution/artifact.ts';
import type { DistributionFile } from '@/release/distribution/validation.ts';
import {
	automationEventSchema,
	executionSchema,
	preparationResultSchema,
	preparedReleaseSchema,
	refPlanSchema,
	refStatesSchema,
} from '@/release/domain/execution/codec-v1.ts';
import type {
	Artifact,
	AutomationEvent,
	Execution,
	PreparationResult,
	PreparedRelease,
} from '@/release/domain/execution/types.ts';
import type { ReleaseOperation } from '@/release/domain/release-set.ts';
import { releaseOperationsSchema } from '@/release/domain/release-set.ts';
import type { SetupEdit } from '@/setup/types.ts';

export interface CoordinatorRpc {
	execution(id: string): Promise<unknown>;
	enqueue(execution: Execution): Promise<unknown>;
	register(id: string, identity: RunIdentity): Promise<unknown>;
	prepared(id: string, identity: RunIdentity, edits: Edit[]): Promise<unknown>;
	report(id: string, identity: RunIdentity, publications: Publication[], artifacts: Artifact[]): Promise<unknown>;
	refs(
		id: string,
		identity: RunIdentity,
		complete?: boolean,
		suppliedFiles?: DistributionFile[],
		artifact?: DistributionArtifact,
		versionTag?: RefState,
	): Promise<unknown>;
	publishRelease(id: string, identity: RunIdentity): Promise<unknown>;
	releasePublished(tag: string): Promise<unknown>;
	packagePublished(manager: string, name: string, version: string): Promise<unknown>;
	publishNext(id: string, identity: RunIdentity): Promise<unknown>;
	publishClaim(id: string, identity: RunIdentity, purl: string, digest: string): Promise<unknown>;
	publishReport(id: string, identity: RunIdentity, report: PublishReport): Promise<unknown>;
	approve(id: string, commitSha: string, actor: string, force?: boolean): Promise<unknown>;
	binaryProgress(id: string): Promise<unknown>;
	approvalReadiness(id: string): Promise<unknown>;
	gates(repositoryId: number, stream: string): Promise<unknown>;
	resolveChecks(id: string, choice: CheckChoice, actor: string): Promise<unknown>;
	recover(id: string, action: 'reconcile' | 'retry' | 'redispatch', actor: string): Promise<unknown>;
	cancel(id: string, actor: string): Promise<unknown>;
	wake(): Promise<unknown>;
	receive(delivery: string, repositoryId: number, event: InboxEvent): Promise<unknown>;
	observeRun(repositoryId: number, runId: number): Promise<unknown>;
	trackRun(repositoryId: number, runId: number): Promise<unknown>;
	setupEdited(edit: Omit<SetupEdit, 'due'>, changed: boolean): Promise<unknown>;
	openSubscriptionIssue(
		repository: string,
		repositoryId: number,
		id: string,
		issue: { title: string; body: string },
	): Promise<unknown>;
	preparationVersions(stream: string): Promise<unknown>;
	preparationResults(stream: string, version: string): Promise<unknown>;
	promotions(stream: string, version: string): Promise<unknown>;
	reclaimable(
		repositoryId: number,
		stream: string,
		version: string,
		primary: string,
		conflicts: RefState[],
		restartId?: string,
	): Promise<unknown>;
	packageTags(
		repositoryId: number,
		stream: string,
		apply: boolean,
		after: string | undefined,
		actor: string,
	): Promise<unknown>;
	reindex(repositoryId: number): Promise<unknown>;
	releaseEvents(): Promise<unknown>;
	acknowledgeReleaseEvent(id: string): Promise<unknown>;
	startReleaseSet(preparationId: string, target: string): Promise<unknown>;
	releaseOperations(preparationId: string, workflowId: string): Promise<unknown>;
	reservePublication(preparationId: string, workflowId: string, id: string): Promise<unknown>;
	operationDelay(preparationId: string, workflowId: string, id: string): Promise<unknown>;
	advanceReleaseOperation(preparationId: string, workflowId: string, id: string): Promise<unknown>;
	releaseWorkflowInterrupted(preparationId: string, workflowId: string): Promise<unknown>;
	completeReleaseWorkflow(preparationId: string, workflowId: string): Promise<unknown>;
}

const strings = mutableArray(Schema.String);
const executionState = Schema.Literals(executionStates);
const executions = mutableArray(executionSchema);

export class CoordinatorClient extends Context.Service<CoordinatorClient, {
	readonly execution: (repositoryId: number, id: string) => Effect.Effect<Execution | undefined, DomainError>;
	readonly enqueue: (repositoryId: number, execution: Execution) => Effect.Effect<Execution, DomainError>;
	readonly register: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
	) => Effect.Effect<Execution, DomainError>;
	readonly prepared: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
		edits: Edit[],
	) => Effect.Effect<PreparationResult, DomainError>;
	readonly report: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	) => Effect.Effect<Execution, DomainError>;
	readonly refs: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
		complete: boolean,
		suppliedFiles?: DistributionFile[],
		artifact?: DistributionArtifact,
		versionTag?: RefState,
	) => Effect.Effect<RefPlan, DomainError>;
	readonly publishRelease: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
	) => Effect.Effect<Execution, DomainError>;
	readonly releasePublished: (repositoryId: number, tag: string) => Effect.Effect<void, DomainError>;
	readonly packagePublished: (
		repositoryId: number,
		manager: string,
		name: string,
		version: string,
	) => Effect.Effect<void, DomainError>;
	readonly publishNext: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
	) => Effect.Effect<NextStep, DomainError>;
	readonly publishClaim: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
		purl: string,
		digest: string,
	) => Effect.Effect<ClaimStep, DomainError>;
	readonly publishReport: (
		repositoryId: number,
		id: string,
		identity: RunIdentity,
		report: PublishReport,
	) => Effect.Effect<ReportStep, DomainError>;
	readonly approve: (
		repositoryId: number,
		id: string,
		commitSha: string,
		actor: string,
		force: boolean,
	) => Effect.Effect<Execution, DomainError>;
	readonly binaryProgress: (repositoryId: number, id: string) => Effect.Effect<BinaryProgress, DomainError>;
	readonly approvalReadiness: (
		repositoryId: number,
		id: string,
	) => Effect.Effect<Decoded<typeof approvalReadiness>, DomainError>;
	readonly gates: (repositoryId: number, stream: string) => Effect.Effect<StreamGates, DomainError>;
	readonly resolveChecks: (
		repositoryId: number,
		id: string,
		choice: CheckChoice,
		actor: string,
	) => Effect.Effect<Execution, DomainError>;
	readonly recover: (
		repositoryId: number,
		id: string,
		action: 'reconcile' | 'retry' | 'redispatch',
		actor: string,
	) => Effect.Effect<Execution, DomainError>;
	readonly cancel: (repositoryId: number, id: string, actor: string) => Effect.Effect<Execution, DomainError>;
	readonly wake: (repositoryId: number) => Effect.Effect<void, DomainError>;
	readonly receive: (repositoryId: number, delivery: string, event: InboxEvent) => Effect.Effect<void, DomainError>;
	readonly observeRun: (repositoryId: number, runId: number) => Effect.Effect<void, DomainError>;
	readonly trackRun: (repositoryId: number, runId: number) => Effect.Effect<void, DomainError>;
	readonly setupEdited: (
		repositoryId: number,
		edit: Omit<SetupEdit, 'due'>,
		changed: boolean,
	) => Effect.Effect<boolean, DomainError>;
	readonly openSubscriptionIssue: (
		repositoryId: number,
		repository: string,
		id: string,
		issue: { title: string; body: string },
	) => Effect.Effect<void, DomainError>;
	readonly preparationVersions: (repositoryId: number, stream: string) => Effect.Effect<string[], DomainError>;
	readonly preparationResults: (
		repositoryId: number,
		stream: string,
		version: string,
	) => Effect.Effect<PreparedRelease[], DomainError>;
	readonly promotions: (
		repositoryId: number,
		stream: string,
		version: string,
	) => Effect.Effect<Execution[], DomainError>;
	readonly reclaimable: (
		repositoryId: number,
		stream: string,
		version: string,
		primary: string,
		conflicts: RefState[],
		restartId?: string,
	) => Effect.Effect<RefState[], DomainError>;
	readonly packageTags: (
		repositoryId: number,
		stream: string,
		apply: boolean,
		after: string | undefined,
		actor: string,
	) => Effect.Effect<PackageTagPage, DomainError>;
	readonly reindex: (repositoryId: number) => Effect.Effect<number, DomainError>;
	readonly releaseEvents: (repositoryId: number) => Effect.Effect<AutomationEvent[], DomainError>;
	readonly acknowledgeReleaseEvent: (repositoryId: number, id: string) => Effect.Effect<void, DomainError>;
	readonly startReleaseSet: (
		repositoryId: number,
		preparationId: string,
		target: string,
	) => Effect.Effect<Execution[], DomainError>;
	readonly releaseOperations: (
		repositoryId: number,
		preparationId: string,
		workflowId: string,
	) => Effect.Effect<ReleaseOperation[], DomainError>;
	readonly reservePublication: (
		repositoryId: number,
		preparationId: string,
		workflowId: string,
		id: string,
	) => Effect.Effect<number, DomainError>;
	readonly operationDelay: (
		repositoryId: number,
		preparationId: string,
		workflowId: string,
		id: string,
	) => Effect.Effect<number, DomainError>;
	readonly advanceReleaseOperation: (
		repositoryId: number,
		preparationId: string,
		workflowId: string,
		id: string,
	) => Effect.Effect<ExecutionStateView, DomainError>;
	readonly releaseWorkflowInterrupted: (
		repositoryId: number,
		preparationId: string,
		workflowId: string,
	) => Effect.Effect<void, DomainError>;
	readonly completeReleaseWorkflow: (
		repositoryId: number,
		preparationId: string,
		workflowId: string,
	) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/CoordinatorClient') {
	static layer(coordinator: (repositoryId: number) => CoordinatorRpc): Layer.Layer<CoordinatorClient> {
		const call = <S extends Schema.ConstraintDecoder<unknown>>(
			schema: S,
			repositoryId: number,
			rpc: (stub: CoordinatorRpc) => Promise<unknown>,
		): Effect.Effect<S['Type'], DomainError> =>
			fromPromise(() => rpc(coordinator(repositoryId))).pipe(
				Effect.flatMap(value =>
					Schema.is(schema)(value) ? Effect.succeed(value) : fromSync(() => decodeSync(schema, value))
				),
			);
		const send = (
			repositoryId: number,
			rpc: (stub: CoordinatorRpc) => Promise<unknown>,
		): Effect.Effect<void, DomainError> => fromPromise(() => rpc(coordinator(repositoryId))).pipe(Effect.asVoid);
		return Layer.succeed(CoordinatorClient, {
			execution: (repositoryId, id) =>
				call(Schema.UndefinedOr(executionSchema), repositoryId, rpc => rpc.execution(id)),
			enqueue: (repositoryId, execution) => call(executionSchema, repositoryId, rpc => rpc.enqueue(execution)),
			register: (repositoryId, id, identity) => call(executionSchema, repositoryId, rpc => rpc.register(id, identity)),
			prepared: (repositoryId, id, identity, edits) =>
				call(preparationResultSchema, repositoryId, rpc => rpc.prepared(id, identity, edits)),
			report: (repositoryId, id, identity, publications, artifacts) =>
				call(executionSchema, repositoryId, rpc => rpc.report(id, identity, publications, artifacts)),
			refs: (repositoryId, id, identity, complete, suppliedFiles, artifact, versionTag) =>
				call(refPlanSchema, repositoryId, rpc => rpc.refs(id, identity, complete, suppliedFiles, artifact, versionTag)),
			publishRelease: (repositoryId, id, identity) =>
				call(executionSchema, repositoryId, rpc => rpc.publishRelease(id, identity)),
			releasePublished: (repositoryId, tag) => send(repositoryId, rpc => rpc.releasePublished(tag)),
			packagePublished: (repositoryId, manager, name, version) =>
				send(repositoryId, rpc => rpc.packagePublished(manager, name, version)),
			publishNext: (repositoryId, id, identity) => call(nextStep, repositoryId, rpc => rpc.publishNext(id, identity)),
			publishClaim: (repositoryId, id, identity, purl, digest) =>
				call(claimStep, repositoryId, rpc => rpc.publishClaim(id, identity, purl, digest)),
			publishReport: (repositoryId, id, identity, report) =>
				call(reportStep, repositoryId, rpc => rpc.publishReport(id, identity, report)),
			approve: (repositoryId, id, commitSha, actor, force) =>
				call(executionSchema, repositoryId, rpc => rpc.approve(id, commitSha, actor, force)),
			binaryProgress: (repositoryId, id) => call(binaryProgress, repositoryId, rpc => rpc.binaryProgress(id)),
			approvalReadiness: (repositoryId, id) => call(approvalReadiness, repositoryId, rpc => rpc.approvalReadiness(id)),
			gates: (repositoryId, stream) => call(streamGates, repositoryId, rpc => rpc.gates(repositoryId, stream)),
			resolveChecks: (repositoryId, id, choice, actor) =>
				call(executionSchema, repositoryId, rpc => rpc.resolveChecks(id, choice, actor)),
			recover: (repositoryId, id, action, actor) =>
				call(executionSchema, repositoryId, rpc => rpc.recover(id, action, actor)),
			cancel: (repositoryId, id, actor) => call(executionSchema, repositoryId, rpc => rpc.cancel(id, actor)),
			wake: repositoryId => send(repositoryId, rpc => rpc.wake()),
			receive: (repositoryId, delivery, event) => send(repositoryId, rpc => rpc.receive(delivery, repositoryId, event)),
			observeRun: (repositoryId, runId) => send(repositoryId, rpc => rpc.observeRun(repositoryId, runId)),
			trackRun: (repositoryId, runId) => send(repositoryId, rpc => rpc.trackRun(repositoryId, runId)),
			setupEdited: (repositoryId, edit, changed) =>
				call(Schema.Boolean, repositoryId, rpc => rpc.setupEdited(edit, changed)),
			openSubscriptionIssue: (repositoryId, repository, id, issue) =>
				send(repositoryId, rpc => rpc.openSubscriptionIssue(repository, repositoryId, id, issue)),
			preparationVersions: (repositoryId, stream) =>
				call(strings, repositoryId, rpc => rpc.preparationVersions(stream)),
			preparationResults: (repositoryId, stream, version) =>
				call(mutableArray(preparedReleaseSchema), repositoryId, rpc => rpc.preparationResults(stream, version)),
			promotions: (repositoryId, stream, version) =>
				call(executions, repositoryId, rpc => rpc.promotions(stream, version)),
			reclaimable: (repositoryId, stream, version, primary, conflicts, restartId) =>
				call(
					refStatesSchema,
					repositoryId,
					rpc => rpc.reclaimable(repositoryId, stream, version, primary, conflicts, restartId),
				),
			packageTags: (repositoryId, stream, apply, after, actor) =>
				call(packageTagPage, repositoryId, rpc => rpc.packageTags(repositoryId, stream, apply, after, actor)),
			reindex: repositoryId => call(Schema.Finite, repositoryId, rpc => rpc.reindex(repositoryId)),
			releaseEvents: repositoryId =>
				call(mutableArray(automationEventSchema), repositoryId, rpc => rpc.releaseEvents()),
			acknowledgeReleaseEvent: (repositoryId, id) => send(repositoryId, rpc => rpc.acknowledgeReleaseEvent(id)),
			startReleaseSet: (repositoryId, preparationId, target) =>
				call(executions, repositoryId, rpc => rpc.startReleaseSet(preparationId, target)),
			releaseOperations: (repositoryId, preparationId, workflowId) =>
				call(releaseOperationsSchema, repositoryId, rpc => rpc.releaseOperations(preparationId, workflowId)),
			reservePublication: (repositoryId, preparationId, workflowId, id) =>
				call(Schema.Finite, repositoryId, rpc => rpc.reservePublication(preparationId, workflowId, id)),
			operationDelay: (repositoryId, preparationId, workflowId, id) =>
				call(Schema.Finite, repositoryId, rpc => rpc.operationDelay(preparationId, workflowId, id)),
			advanceReleaseOperation: (repositoryId, preparationId, workflowId, id) =>
				call(executionState, repositoryId, rpc => rpc.advanceReleaseOperation(preparationId, workflowId, id)),
			releaseWorkflowInterrupted: (repositoryId, preparationId, workflowId) =>
				send(repositoryId, rpc => rpc.releaseWorkflowInterrupted(preparationId, workflowId)),
			completeReleaseWorkflow: (repositoryId, preparationId, workflowId) =>
				send(repositoryId, rpc => rpc.completeReleaseWorkflow(preparationId, workflowId)),
		});
	}
}
