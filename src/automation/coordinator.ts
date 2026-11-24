import { DurableObject } from 'cloudflare:workers';
import { Clock, Context, Effect, Layer, ManagedRuntime, Predicate, Result, Schema } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import { WorkflowRunGuard } from '@/auth/actions-oidc.ts';
import { requireImmutableReleases, verifyImmutableRelease } from '@/automation/immutable-release';
import {
	commitVersion,
	enableAutoMerge,
	preparedSnapshot,
	pullRequest,
	restatePreparation,
	resumePreparation,
} from '@/automation/preparation-pull-requests';
import type { PublishBudget } from '@/automation/publish-budget';
import type { ReleaseWorkflowParams } from '@/automation/release-workflow';
import type { AutomationBindings } from '@/automation/service';
import { Automation, applicationLayer, withAutomation } from '@/automation/service';
import { repositorySnapshot } from '@/automation/snapshot';
import { unchangedSince } from '@/automation/unchanged-paths';
import type { BinaryProgress, GateView, PackageTagPage, StreamGates } from '@/contract/views';
import { coversBinding } from '@/credentials/grant.ts';
import { metadataProblems } from '@/discovery/analysis/package-metadata.ts';
import { discover } from '@/discovery/discover.ts';
import type { CheckJob } from '@/discovery/workflow-analysis/deployment-jobs.ts';
import { checkJobs, deploys } from '@/discovery/workflow-analysis/deployment-jobs.ts';
import type { WorkflowJobs } from '@/discovery/workflow-analysis/job-gate.ts';
import { gateState, resolvable, workflowJobs } from '@/discovery/workflow-analysis/job-gate.ts';
import { identifiedManagers, isManagerName, managerSpec } from '@/domain/catalog.ts';
import type { Edit, Package } from '@/domain/inventory.ts';
import {
	identityPackageName,
	matchesPackage,
	packageId,
	parseIdentity,
	parseReleaseIdentity,
	publicationIdentity,
	publishablePackages,
	selectorKey,
} from '@/domain/package-identity.ts';
import { matchesRef } from '@/domain/ref-policy.ts';
import type { RefChange, RefPlan, RefState, TagSigner } from '@/domain/refs.ts';
import { tagObject, tagObjectId, tagPayload } from '@/domain/refs.ts';
import type { CheckChoice, GateSkip, ReleaseGate } from '@/domain/release-gates.ts';
import { gatedRelease, gateLabel, gateReasons, sameGate } from '@/domain/release-gates.ts';
import type { ReadyRepository } from '@/domain/repository';
import { readiness } from '@/domain/repository';
import { defaultTagPolicy, isPrerelease, semVer, tagFor } from '@/domain/version.ts';
import { tagPrefix } from '@/domain/version-tags.ts';
import { releaseNotes } from '@/github/release-notes.ts';
import type { GitHubRelease, WorkflowRun } from '@/github/resources.ts';
import {
	checkRunsSchema,
	commitSchema,
	commitStatusSchema,
	comparisonSchema,
	dispatchSchema,
	gitRefSchema,
	releaseNotesSchema,
	releaseSchema,
	workflowJobsSchema,
	workflowRunSchema,
	workflowRunsSchema,
} from '@/github/resources.ts';
import type { GitHubRunResult, RunJob } from '@/github/run-state.ts';
import { classifyJob, classifyRun, jobProgressState } from '@/github/run-state.ts';
import { GitHubRejection } from '@/github/transport.ts';
import type { InboxEvent } from '@/github/webhooks.ts';
import { fromPromise, fromSync, recover, toDomainError } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { notFound, precondition } from '@/kernel/errors/domain-error.ts';
import { parseRetryAfter } from '@/kernel/http/http-date.ts';
import { retryTransient } from '@/kernel/http/retry.ts';
import { logFailure, logRecovered } from '@/kernel/logging/failure-log.ts';
import { jsonLogging } from '@/kernel/logging/json-logging.ts';
import { approvalShaPattern, sha256DigestPattern } from '@/kernel/schema/ids.ts';
import { matches, sha } from '@/kernel/schema/result.ts';
import { decodeSync, mutableArray, safeDecode } from '@/kernel/schema/structs.ts';
import type { SqlDatabase } from '@/persistence/d1/database';
import { ProjectionStore } from '@/persistence/d1/projection';
import type { Committed } from '@/persistence/durable/journal.ts';
import { Journal, ProjectionSink } from '@/persistence/durable/journal.ts';
import type { Write } from '@/persistence/durable/keyspace.ts';
import { Keyspace } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { ClaimStep, LedgerPackage, NextStep, PublishReport, ReportStep } from '@/publication/contract.ts';
import type { Ledger, LedgerRecord } from '@/publication/ledger.ts';
import {
	availability,
	claim,
	entry,
	fail,
	label,
	pacedPublication,
	publicationOf,
	publish,
	rateLimit,
	registries,
	released,
	reservation,
	reuse,
	view,
} from '@/publication/ledger.ts';
import { dependencyBlocker, planLedger, publicationDeadlock } from '@/publication/ledger-plan.ts';
import type { Publication } from '@/publication/publication.ts';
import type { PublishKind } from '@/publication/publish-pace.ts';
import { verifiedPublication } from '@/publication/registries/verification.ts';
import {
	canVerifyPublication,
	verifyPublication,
	verifySecondaryPublications,
} from '@/publication/registries/verify.ts';
import { projectionRules } from '@/release/adapters/d1/completions.ts';
import type { Observation, ReleaseSetRecord, ReleaseWake } from '@/release/adapters/do/keys.ts';
import { Keys, wakeDue } from '@/release/adapters/do/keys.ts';
import type { DistributionArtifact } from '@/release/distribution/artifact.ts';
import { readDistributionArtifact } from '@/release/distribution/artifact.ts';
import { observedDistribution } from '@/release/distribution/observation.ts';
import type { DistributionFile } from '@/release/distribution/validation.ts';
import { createDistribution, readDistributionFile, readDistributionMode } from '@/release/distribution/validation.ts';
import {
	createExecution,
	dependenciesReady,
	deriveExecution,
	expectedRunTitle,
	mergePublications,
	publishedAfterFailure,
	recheckable,
	rechecked,
	recheckedPublication,
	recoverable,
	runTitle,
	settle,
	settleRun,
	unreported,
	validatePublicationIdentity,
	verifiableCancellation,
} from '@/release/domain/execution/execution.ts';
import { mergeArtifacts, resolveInputs } from '@/release/domain/execution/outputs.ts';
import { githubFailureReason } from '@/release/domain/execution/run-labels.ts';
import type {
	Artifact,
	AutomationEvent,
	Execution,
	PreparationResult,
	PreparedRelease,
	ReleaseReference,
	ReleaseStarted,
} from '@/release/domain/execution/types.ts';
import { ReleaseHistory } from '@/release/domain/history.ts';
import { executionId, releaseEventId } from '@/release/domain/identity-keys.ts';
import { preparationBody } from '@/release/domain/managed.ts';
import type { PackageTagResult, PackageTagRow, Release } from '@/release/domain/package-tags.ts';
import {
	frozenPackageTagRows,
	packageTagGroups,
	packageTagPage,
	packageTagPages,
	packageTagRows,
	taggedReleases,
} from '@/release/domain/package-tags.ts';
import { observedVersion, placeholderVersion } from '@/release/domain/planning/managers.ts';
import {
	conflictMessage,
	planRefs,
	refsLanded,
	streamModuleTagPrefixes,
	tagConflict,
	tagPrefixes,
	versionTagged,
} from '@/release/domain/refs.ts';
import { compileReleaseSet } from '@/release/domain/release-set.ts';
import { manifestProblems, releasePaths } from '@/release/domain/version.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { CoordinatorLock } from '@/release/services/coordinator/coordinator-lock.ts';
import type { ExecutionCommitted } from '@/release/services/coordinator/executions.ts';
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
	SIGNER?: TagSigner;
}
interface ReleaseOperation {
	id: string;
	operation: string;
	paced: boolean;
	dependencies: string[];
}
const reconcileInterval = 60_000;
const automaticRetries = 3;
const defaultRetryAfter = 60_000;
const metadataReason = gateReasons.metadata;
const passingConclusions = ['success', 'neutral', 'skipped'];
function missingReceipt(execution: Execution, record: LedgerRecord): boolean {
	return released(record)
		&& !execution.publications.some(publication =>
			publication.id === record.id && publication.version === record.version && publication.outcome === 'succeeded'
			&& (!record.digest || publication.digest === record.digest)
		);
}
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
function reopened(publications: Publication[]): Publication[] {
	return publications.map(publication =>
		publication.outcome === 'succeeded' ? publication : { ...publication, outcome: 'pending' as const }
	);
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
function githubRelease(execution: Execution): { tag: string; prerelease: boolean } | undefined {
	if (!execution.version) return undefined;
	const version = decodeSync(semVer, execution.version);
	return { tag: tagFor(execution.workflow?.refs ?? defaultTagPolicy, version), prerelease: isPrerelease(version) };
}
function releaseCommit(execution: Execution): string {
	return execution.refPlan?.distribution?.commit ?? execution.refPlan?.changes[0]?.commit ?? execution.sourceSha;
}
function publishesGithubRelease(execution: Execution): boolean {
	const key = selectorKey(`github-release:${execution.repository}`);
	return execution.workflow?.publications?.some(id => selectorKey(id) === key) ?? false;
}
function committed(execution: Execution): boolean {
	return execution.configuration.streams[execution.stream]?.prepare.bump === 'commit';
}
function versionMessage(execution: Execution): string {
	return `chore(release): ${execution.version ?? 'release set'}`;
}
function moved(execution: Execution, head: { ref: string; sha: string }): string {
	const release = execution.operation === 'prepare' || execution.operation === 'promote' || execution.releaseSet;
	return `${head.ref} is at ${head.sha.slice(0, 12)} but this execution builds ${execution.sourceSha.slice(0, 12)}; ${
		release ? 'prepare the release again' : 'trigger the operation again'
	}`;
}
function referenceProbe(reference: string, version: string): Publication | undefined {
	if (!reference.startsWith('pkg:')) {
		const colon = reference.indexOf(':');
		const manager = reference.slice(0, colon), name = reference.slice(colon + 1);
		return colon > 0 && name && isManagerName(manager)
			? { id: reference, manager, name, version, outcome: 'pending', required: true }
			: undefined;
	}
	const parsed = parseReleaseIdentity(reference);
	if (Result.isFailure(parsed)) return undefined;
	const identity = parsed.success;
	const manager = identifiedManagers.find(name => managerSpec(name).purlType === identity.type);
	if (!manager) return undefined;
	return {
		id: reference,
		identity: { ...identity, version },
		manager,
		name: identityPackageName(identity),
		version,
		outcome: 'pending',
		required: true,
	};
}
type CoordinatorEffect<A, E = never> = Effect.Effect<A, E, Infrastructure | CoordinatorServices | AuditTrail>;
type GateSubject =
	& Pick<Execution, 'repository' | 'repositoryId' | 'sourceSha' | 'configuration' | 'stream'>
	& Partial<Pick<Execution, 'reruns'>>;
interface GateOutcome {
	gate: ReleaseGate;
	state: 'passed' | 'waiting' | 'failed';
	fact: string;
	detail?: string;
	runId?: number;
	runDone?: boolean;
	runAttempt?: number;
}
interface CommitGates {
	manifest: string[];
	truncated: boolean;
	runs: number;
	outcomes: GateOutcome[];
}
const gateRank = { passed: 0, waiting: 1, failed: 2 } as const;
function mergedOutcomes(outcomes: readonly GateOutcome[]): GateOutcome[] {
	const merged: GateOutcome[] = [];
	for (const outcome of outcomes) {
		const index = merged.findIndex(entry => sameGate(entry.gate, outcome.gate));
		const prior = merged[index];
		if (!prior) merged.push(outcome);
		else if (gateRank[outcome.state] > gateRank[prior.state]) merged[index] = outcome;
	}
	return merged;
}
function skippedNote(gate: ReleaseGate, fact: string, skip: GateSkip): string {
	return `${gateLabel(gate)} ${fact}, skipped by ${skip.actor}`;
}

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
function commitEntries(entries: readonly [Committed, ...Committed[]], extra?: readonly Write[]) {
	return Executions.use(service => service.commit(entries, extra));
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

const projectionSink = Layer.effect(
	ProjectionSink,
	Effect.gen(function*() {
		const automation = yield* Automation;
		return ProjectionSink.of({ apply: rows => new ProjectionStore(automation.store.db, projectionRules).apply(rows) });
	}),
);

export class AutomationCoordinator extends DurableObject<CoordinatorBindings> {
	readonly #runtime: ManagedRuntime.ManagedRuntime<Infrastructure | CoordinatorServices | AuditTrail, DomainError>;
	constructor(
		ctx: DurableObjectState,
		env: CoordinatorBindings,
		infrastructure?: Layer.Layer<Infrastructure, DomainError>,
	) {
		super(ctx, env);
		const committed = Layer.effectDiscard(Effect.gen({ self: this }, function*() {
			const context = yield* Effect.context<Infrastructure | CoordinatorServices | AuditTrail>();
			yield* (yield* Executions).onCommitted(change =>
				this.committed(change).pipe(
					Effect.updateContext((current: Context.Context<never>) => Context.merge(context, current)),
				)
			);
		}));
		this.#runtime = ManagedRuntime.make(
			Layer.mergeAll(
				jsonLogging,
				committed.pipe(
					Layer.provideMerge(setupEditSource),
					Layer.provideMerge(coordinatorLayer(ctx.storage)),
					Layer.provide(Layer.merge(projectionSink, repositoryRevisions)),
					Layer.provideMerge(auditTrail),
					Layer.provideMerge(infrastructure ?? applicationLayer(env, work => ctx.waitUntil(work))),
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
	private releaseSet(preparationId: string): CoordinatorEffect<ReleaseSetRecord | undefined, DomainError> {
		return DurableStorage.use(storage => storage.get(Keys.releaseSet, preparationId));
	}
	private committed({ execution, previous }: ExecutionCommitted): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (execution.state === 'succeeded') yield* this.captureReleaseEvent(execution);
			if (execution.state === 'succeeded' && previous?.state !== 'succeeded') yield* this.tagPackagesLater(execution);
		});
	}
	private tagPackagesLater(execution: Execution): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const promotion = execution.operation === 'promote'
				? execution
				: execution.version === undefined
				? undefined
				: (yield* allExecutions).find(other =>
					other.operation === 'promote' && other.state === 'succeeded' && other.stream === execution.stream
					&& other.version === execution.version
				);
			const references = promotion?.configuration.streams[promotion.stream]?.packageTags;
			const policy = promotion?.workflow?.refs;
			const version = promotion?.version;
			if (!promotion || !references?.length || policy?.phase !== 'version' || !version) return;
			const release: Release = { version, commit: promotion.sourceSha };
			const frozen = promotion.packageTags;
			const work = Effect.gen({ self: this }, function*() {
				const packages = frozen
					? []
					: (yield* (yield* this.store).repositories.get(execution.repositoryId))?.inventory.packages ?? [];
				const work = yield* this.packageTagWork(
					execution.repository,
					execution.repositoryId,
					refs =>
						frozen
							? frozenPackageTagRows(frozen, release, refs)
							: packageTagRows(packageTagGroups(references, policy.prefix, packages), [release], refs),
					true,
				);
				const results = yield* packageTagPages(work.rows, work.check);
				for (const result of results.filter(result => result.outcome === 'failed' || result.outcome === 'conflict')) {
					yield* logFailure(
						'package-tags.failed',
						precondition(result.reason ?? `${result.tag} was not created`),
						{ executionId: execution.id, tag: result.tag },
					);
				}
			}).pipe(logRecovered('package-tags.failed', { executionId: execution.id }));
			this.ctx.waitUntil(
				Effect.runPromiseWith(yield* Effect.context<Infrastructure | CoordinatorServices | AuditTrail>())(work),
			);
		});
	}
	packageTags(
		repositoryId: number,
		stream: string,
		apply: boolean,
		after: string | undefined,
		actor: string,
	): Promise<PackageTagPage> {
		return this.run(
			Effect.gen({ self: this }, function*() {
				const record = yield* (yield* this.store).repositories.get(repositoryId);
				if (!record?.configuration) return yield* precondition('Repository not configured');
				const configured = record.configuration.streams[stream];
				if (!configured) return yield* precondition(`Unknown stream ${stream}`);
				const references = configured.packageTags ?? [];
				if (!references.length) return yield* precondition(`Stream ${stream} names no packageTags`);
				const policy = configured.promote.workflow?.refs;
				if (policy?.phase !== 'version') {
					return yield* precondition(`Stream ${stream} pushes no version tag, so its packages get no tags`);
				}
				const groups = packageTagGroups(references, policy.prefix, record.inventory.packages);
				const work = yield* this.packageTagWork(
					record.name,
					record.id,
					refs => packageTagRows(groups, taggedReleases(policy.prefix, refs), refs),
					apply,
				);
				const page = yield* packageTagPage(work.rows, after, work.check);
				if (apply) {
					const created = page.results.filter(result => result.outcome === 'created').map(result => result.tag);
					yield* (yield* this.store).audit(
						actor,
						'repository.package-tags',
						`${record.name}: ${created.length ? created.join(', ') : 'none created'}`,
					);
				}
				return page;
			}),
			'coordinator.packageTags',
			{ repositoryId, stream },
		);
	}
	private packageTagWork(
		repository: string,
		repositoryId: number,
		rows: (refs: RefState[]) => PackageTagRow[],
		apply: boolean,
	): CoordinatorEffect<
		{ rows: PackageTagRow[]; check: (row: PackageTagRow) => CoordinatorEffect<PackageTagResult> },
		DomainError
	> {
		return Effect.gen({ self: this }, function*() {
			const gateway = yield* this.gateway;
			const refs = yield* gateway.tagRefs(repository, repositoryId);
			const transport = (yield* Automation).dependencies.transport;
			const context = gateway.verification(repository, repositoryId);
			const create = (row: PackageTagRow) => this.createPackageTag(repository, repositoryId, row);
			const check = (row: PackageTagRow): CoordinatorEffect<PackageTagResult> =>
				Effect.gen(function*() {
					const base = { tag: row.tag, version: row.version, commit: row.commit };
					if (row.state === 'exists') return { ...base, outcome: 'exists' };
					if (row.state === 'conflict') {
						return {
							...base,
							outcome: 'conflict',
							reason: `${row.tag} already targets ${(row.target ?? '').slice(0, 12)}`,
						};
					}
					let published = false;
					const unanswered: string[] = [];
					for (const { reference, publication } of row.probes) {
						const verified = verifiedPublication(
							publication,
							yield* verifyPublication(publication, transport, context),
						);
						if (verified.outcome === 'succeeded') {
							published = true;
							break;
						}
						if (verified.outcome !== 'pending') unanswered.push(`${reference} is ${verified.outcome}`);
					}
					if (!published && unanswered.length) {
						return {
							...base,
							outcome: 'failed',
							reason: `The registry did not confirm ${row.version}: ${unanswered.join(', ')}`,
						};
					}
					if (!published) return { ...base, outcome: 'unpublished' };
					if (!apply) return { ...base, outcome: 'publishable' };
					const created = yield* Effect.result(create(row));
					return created._tag === 'Success'
						? { ...base, outcome: 'created' }
						: { ...base, outcome: 'failed', reason: decodeError(created.failure) };
				});
			return { rows: rows(refs), check };
		});
	}
	private createPackageTag(
		repository: string,
		repositoryId: number,
		row: PackageTagRow,
	): CoordinatorEffect<void, DomainError> {
		const signer = this.env.SIGNER;
		return Effect.gen({ self: this }, function*() {
			if (!signer) return yield* precondition('Package tags need the tag signer');
			const clock = yield* Clock.Clock;
			const identity = yield* fromPromise(() => signer.identity());
			const user = /^([^<>\n]+) <([^<>\s]+)>$/.exec(identity.userId);
			if (!user?.[1] || !user[2]) return yield* precondition('The signing key needs a user ID with a name and email');
			const seconds = Math.floor(clock.currentTimeMillisUnsafe() / 1000);
			const change: RefChange = { name: row.tag, expected: null, commit: row.commit, annotated: true, signed: true };
			const payload = tagPayload(change, row.tag, `${identity.userId} ${seconds} +0000`);
			const signature = yield* fromPromise(() => signer.sign(payload, `beepboop:${repository}`));
			yield* (yield* this.gateway).createTag(repository, repositoryId, {
				name: row.tag,
				commit: row.commit,
				message: `${row.tag}\n${signature.endsWith('\n') ? signature : `${signature}\n`}`,
				tagger: {
					name: user[1],
					email: user[2],
					date: new Date(seconds * 1000).toISOString().replace('.000Z', 'Z'),
				},
				signed: true,
			});
		});
	}
	private putReleaseSet(preparationId: string, record: ReleaseSetRecord): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const preparation = yield* getExecution(preparationId);
			yield* commitEntries([
				{ entity: 'release-set', id: preparationId, repositoryId: preparation.repositoryId, value: record },
			]);
		});
	}
	private releaseGroup(
		execution: Execution,
		history: CoordinatorEffect<ReleaseHistory, DomainError> = ReconcileHistory.use(active => active.current).pipe(
			Effect.filterOrElse(
				Predicate.isNotUndefined,
				() => allExecutions.pipe(Effect.map(entries => new ReleaseHistory(entries))),
			),
		),
	): CoordinatorEffect<Execution[] | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (!execution.version) return;
			const required = execution.releaseSet?.required ?? execution.configuration.streams[execution.stream]?.required
				?? [];
			if (!required.length) return;
			const id = releaseEventId({ ...execution, version: execution.version });
			if (yield* (yield* DurableStorage).has(Keys.releaseEmitted, id)) return;
			return (yield* history).completed(execution, required);
		});
	}
	private captureReleaseEvent(execution: Execution): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (!execution.version) return;
			const group = yield* this.releaseGroup(execution);
			if (!group) return;
			const id = releaseEventId({ ...execution, version: execution.version });
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
				occurredAt: (yield* Clock.Clock).currentTimeMillisUnsafe(),
				id,
				source: execution.repository,
				event: 'release',
				version: execution.version,
				release,
			};
			yield* commitEntries(
				[{ entity: 'release', id, repositoryId: execution.repositoryId, value: event }],
				[Keyspace.write(Keys.releaseEvent, id, event), Keyspace.write(Keys.releaseEmitted, id, true)],
			);
		});
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
		return Effect.gen({ self: this }, function*() {
			const enrollment = yield* (yield* this.store).repositories.enrollment(repositoryId);
			return enrollment?.access.kind !== 'active';
		});
	}
	exportJournal(): Promise<{ key: string; value: unknown }[]> {
		return this.run(
			DurableStorage.use(storage => storage.dump),
			'coordinator.exportJournal',
			{},
		);
	}
	releaseEvents(): Promise<AutomationEvent[]> {
		return this.run(
			DurableStorage.use(storage => storage.list(Keys.releaseEvent, 100)).pipe(
				Effect.map(entries => entries.map(entry => entry.value)),
			),
			'coordinator.releaseEvents',
			{},
		);
	}
	acknowledgeReleaseEvent(id: string): Promise<void> {
		return this.run(
			DurableStorage.use(storage => storage.remove(Keys.releaseEvent, id)),
			'coordinator.acknowledgeReleaseEvent',
			{ executionId: id },
		);
	}
	/** Persist wake-ups separately so failed delivery survives Worker restarts. */
	private wakeReleaseWorkflows(): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const storage = yield* DurableStorage;
			const wakes: Write[] = [];
			for (const { id, value: release } of yield* storage.list(Keys.releaseSet)) {
				if (!release.workflowId || release.completed) continue;
				wakes.push(Keyspace.write(Keys.releaseWake, id, { due: clock.currentTimeMillisUnsafe() }));
			}
			if (wakes.length) yield* storage.writeAll(wakes);
		});
	}
	private deliverReleaseWake(
		preparationId: string,
		release: ReleaseSetRecord & { workflowId: string },
		wake: ReleaseWake,
	): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const binding = this.env.RELEASE_WORKFLOW;
			const workflowId = release.workflowId;
			if (!release.started) {
				const preparation = yield* getExecution(preparationId);
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
	private deliverReleaseEvents(now: number): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const storage = yield* DurableStorage;
			for (const entry of yield* storage.entries(Keys.releaseWake)) {
				const preparationId = entry.id;
				if (entry.kind === 'unreadable') {
					yield* storage.remove(Keys.releaseWake, preparationId);
					continue;
				}
				const wake = entry.value;
				if (wakeDue(wake) > now) continue;
				const release = yield* this.releaseSet(preparationId);
				const workflowId = release?.workflowId;
				if (!release || !workflowId || release.completed) {
					yield* storage.remove(Keys.releaseWake, preparationId);
					continue;
				}
				yield* this.deliverReleaseWake(preparationId, { ...release, workflowId }, wake).pipe(
					Effect.andThen(storage.remove(Keys.releaseWake, preparationId)),
					recover(error =>
						Effect.gen(function*() {
							yield* storage.put(Keys.releaseWake, preparationId, {
								...(wake === true ? {} : wake),
								due: now + reconcileInterval,
							});
							yield* logFailure('release-wake.failed', error, { preparationId });
						})
					),
				);
			}
		});
	}
	private operations(preparationId: string, workflowId: string): CoordinatorEffect<ReleaseOperation[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const release = yield* this.releaseSet(preparationId);
			if (!release || release.workflowId !== workflowId) {
				return yield* precondition('Release Workflow identity mismatch');
			}
			return yield* Effect.forEach(release.ids, id =>
				getExecution(id).pipe(Effect.map(execution => ({
					id,
					operation: execution.package ? `${execution.operation} ${execution.package.id}` : execution.operation,
					paced: execution.package?.manager === 'cargo',
					dependencies: execution.dependencies,
				}))), { concurrency: 'unbounded' });
		});
	}
	releaseOperations(preparationId: string, workflowId: string): Promise<ReleaseOperation[]> {
		return this.run(this.operations(preparationId, workflowId), 'coordinator.releaseOperations', {
			preparationId,
			workflowId,
		});
	}
	reservePublication(preparationId: string, workflowId: string, id: string): Promise<number> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const operations = yield* this.operations(preparationId, workflowId);
				if (!operations.some(operation => operation.id === id && operation.paced)) {
					return yield* precondition('Operation is not a paced publication in this release');
				}
				const execution = yield* getExecution(id);
				const target = execution.package;
				if (!target) return yield* precondition('Paced operation has no package');
				if (!execution.reservation) {
					const { kind, allowedAt } = yield* this.reserveCrate(
						execution.repositoryId,
						pkg => matchesPackage(target.id, pkg),
					);
					yield* putExecution({
						...execution,
						reservation: kind,
						notBefore: Math.max(execution.notBefore ?? 0, allowedAt),
					});
				}
				return Math.max(0, ((yield* getExecution(id)).notBefore ?? 0) - clock.currentTimeMillisUnsafe());
			}),
			'coordinator.reservePublication',
			{ preparationId, workflowId, executionId: id },
		);
	}
	operationDelay(preparationId: string, workflowId: string, id: string): Promise<number> {
		return this.run(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const operations = yield* this.operations(preparationId, workflowId);
				if (!operations.some(operation => operation.id === id)) {
					return yield* precondition('Operation is not in this release');
				}
				return Math.max(0, ((yield* getExecution(id)).notBefore ?? 0) - clock.currentTimeMillisUnsafe());
			}),
			'coordinator.operationDelay',
			{ preparationId, workflowId, executionId: id },
		);
	}
	advanceReleaseOperation(preparationId: string, workflowId: string, id: string): Promise<Execution['state']> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const operations = yield* this.operations(preparationId, workflowId);
				if (!operations.some(operation => operation.id === id)) {
					return yield* precondition('Operation is not in this release');
				}
				yield* this.reconcile(id);
				return (yield* getExecution(id)).state;
			}),
			'coordinator.advanceReleaseOperation',
			{ preparationId, workflowId, executionId: id },
		);
	}
	releaseWorkflowInterrupted(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(
			this.recordReleaseWorkflowInterruption(preparationId, workflowId),
			'coordinator.releaseWorkflowInterrupted',
			{ preparationId, workflowId },
		);
	}
	private recordReleaseWorkflowInterruption(
		preparationId: string,
		workflowId: string,
		interrupted = true,
	): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const operation of yield* this.operations(preparationId, workflowId)) {
				const execution = yield* getExecution(operation.id);
				if (!execution.releaseSet) continue;
				execution.releaseSet.workflowError = interrupted
					? 'Release coordination interrupted. Check coordination to resume.'
					: undefined;
				yield* commitEntries([
					{ entity: 'execution', id: execution.id, repositoryId: execution.repositoryId, value: execution },
				]);
			}
		});
	}
	completeReleaseWorkflow(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const operations = yield* this.operations(preparationId, workflowId);
				for (const operation of operations) {
					if ((yield* getExecution(operation.id)).state !== 'succeeded') {
						return yield* precondition('Release is incomplete');
					}
				}
				const release = yield* this.releaseSet(preparationId);
				if (!release) return yield* precondition('Release set is missing');
				yield* this.putReleaseSet(preparationId, { ...release, completed: true });
			}),
			'coordinator.completeReleaseWorkflow',
			{ preparationId, workflowId },
		);
	}
	startReleaseSet(preparationId: string, target: string): Promise<Execution[]> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const preparation = yield* getExecution(preparationId);
				if (yield* this.suspended(preparation.repositoryId)) {
					return yield* precondition('Repository is suspended');
				}
				const prior = yield* this.releaseSet(preparationId);
				if (prior) {
					if (prior.target !== target) return yield* precondition('Release set already targets another revision');
					return yield* Effect.forEach(prior.ids, id => getExecution(id), { concurrency: 'unbounded' });
				}
				const result = preparation.managed?.result ?? preparation.prepared?.result;
				const plan = preparation.managed?.plan ?? preparation.plan;
				if (!result || !plan) return yield* precondition('Preparation result unavailable');
				const revision = yield* Effect.fromResult(sha(target));
				const snapshot = yield* preparedSnapshot(
					yield* this.gateway,
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
				yield* commitEntries(
					[
						{ entity: 'release-set', id: preparationId, repositoryId: preparation.repositoryId, value: record },
						...members,
					],
					[Keyspace.write(Keys.releaseWake, preparationId, { due: clock.currentTimeMillisUnsafe() })],
				);
				return executions;
			}),
			'coordinator.startReleaseSet',
			{ preparationId },
		);
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
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const execution = yield* getExecution(id);
				if (!execution.workflow || execution.managed || execution.operation !== 'prepare' || !execution.plan) {
					return yield* precondition('Preparation run identity mismatch');
				}
				yield* WorkflowRunGuard.require(execution, identity, {
					_tag: 'SameRun',
					mismatch: 'Preparation run identity mismatch',
				});
				const ordered = [...edits].sort((a, b) => a.path.localeCompare(b.path));
				if (execution.prepared && JSON.stringify(execution.prepared.edits) !== JSON.stringify(ordered)) {
					return yield* precondition('Submitted preparation changed; create a new preparation');
				}
				if (execution.prepared?.result) return execution.prepared.result;
				const prepared = execution.prepared ?? { edits: ordered };
				execution.prepared = prepared;
				yield* putExecution(execution);
				const gateway = yield* this.gateway;
				const source = yield* repositorySnapshot(
					gateway,
					execution.repository,
					execution.repositoryId,
					execution.sourceSha,
					ordered.map(edit => edit.path),
				);
				const branch = `release/${execution.stream}/${execution.id}`;
				const title = `chore(release): prepare ${execution.version ?? 'release set'}`;
				const body = `Source: ${execution.sourceSha}\nPreparation execution: ${execution.id}\n\n${
					preparationBody(execution)
				}`;
				const result = committed(execution)
					? yield* commitVersion(gateway, source, versionMessage(execution), ordered, prepared.head, head => {
						prepared.head = head;
						return putExecution(execution);
					})
					: prepared.head
					? yield* resumePreparation(gateway, source, branch, title, body, prepared.head)
					: yield* pullRequest(gateway, {
						snapshot: source,
						branch,
						title,
						body,
						edits: ordered,
						checkpoint: head => {
							prepared.head = head;
							return putExecution(execution);
						},
						coAuthored: execution.initiatedBy !== undefined,
					});
				const merged = yield* this.autoMerged(execution, result);
				prepared.result = merged;
				yield* putExecution(execution);
				return merged;
			}),
			'coordinator.prepared',
			{ executionId: id },
		);
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
				this.ctx.waitUntil(
					Effect.runPromiseWith(yield* Effect.context<Infrastructure | CoordinatorServices | AuditTrail>())(work),
				);
			}
		});
	}
	private autoMerged(execution: Execution, result: PreparationResult): CoordinatorEffect<PreparationResult> {
		const method = execution.versionPrMerge
			?? execution.configuration.streams[execution.stream]?.prepare.versionPrMerge;
		if (result.kind === 'commit' || result.autoMerge || !method || method === 'manual') return Effect.succeed(result);
		return Effect.gen({ self: this }, function*() {
			const lock = yield* CoordinatorLock;
			const work = enableAutoMerge(
				yield* this.gateway,
				execution.repository,
				execution.repositoryId,
				result.url,
				method,
				'version PR',
			)
				.pipe(
					retryTransient<DomainError>({
						attempts: 3,
						delay: 1000,
						while: error => error.problem.code === 'upstream',
					}),
					Effect.flatMap(autoMerge => lock.serialized(Effect.gen({ self: this }, function*() {
						const current = yield* getExecution(execution.id);
						const preparation = current.prepared ?? current.managed;
						if (preparation?.result?.head !== result.head) return;
						preparation.result = { ...result, autoMerge };
						yield* putExecution(current);
					}))),
					logRecovered('preparation.auto-merge-failed', { executionId: execution.id, url: result.url }),
				);
			this.ctx.waitUntil(
				Effect.runPromiseWith(yield* Effect.context<Infrastructure | CoordinatorServices | AuditTrail>())(work),
			);
			return result;
		});
	}
	register(id: string, identity: RunIdentity): Promise<Execution> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const execution = yield* getExecution(id);
				const workflow = execution.workflow;
				if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
				const dependencies = yield* Effect.forEach(execution.dependencies, id => getExecution(id), {
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
				if (execution.supersededRuns?.includes(identity.runId)) {
					return yield* precondition('A newer run of this execution replaced this run');
				}
				if (execution.runAttempt && identity.attempt < execution.runAttempt) {
					return yield* precondition('Stale run attempt');
				}
				const gateway = yield* this.gateway;
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
				if (!(yield* this.contains(execution, run.head_sha, token))) {
					return yield* precondition(
						`The run is at ${run.head_sha.slice(0, 12)} but this execution releases ${
							execution.sourceSha.slice(0, 12)
						}`,
					);
				}
				if (!matchesRef(workflow.ref, identity.ref)) return yield* precondition('Workflow ref mismatch');
				if (execution.attempts > 0 && !execution.runId && run.display_title !== expectedRunTitle(execution)) {
					return yield* precondition('Dispatch correlation mismatch');
				}
				const resolvedInputs = yield* resolveInputs(execution, dependencies);
				const next: Execution = {
					...settleRun(execution, classifyRun(run)),
					resolvedInputs,
					state: 'running',
					runId: identity.runId,
					runAttempt: identity.attempt,
					workflowSha: identity.workflowSha,
					helperShas: [
						...new Set([...(execution.helperShas ?? []), identity.helperSha ?? identity.workflowSha]),
					],
				};
				yield* putExecution(next);
				return next;
			}),
			'coordinator.register',
			{ executionId: id },
		);
	}
	refs(
		id: string,
		identity: RunIdentity,
		complete = false,
		suppliedFiles: DistributionFile[] = [],
		artifact?: DistributionArtifact,
	): Promise<RefPlan> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const execution = yield* getExecution(id);
				const workflow = execution.workflow;
				if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
				yield* WorkflowRunGuard.require(execution, identity, {
					_tag: 'SameRunAndName',
					mismatch: 'Ref operation identity mismatch',
				});
				const policy = workflow.refs;
				const version = execution.version;
				if (!policy || !version) return yield* precondition('No configured ref operation');
				if (!(yield* this.promoted(execution))) {
					return yield* precondition('Ref operation requires completed promotion');
				}
				const gateway = yield* this.gateway;
				const files = yield* Effect.gen(function*() {
					if (!artifact) return suppliedFiles;
					if (complete || suppliedFiles.length || !policy.distribution) {
						return yield* precondition('Unexpected distribution artifact');
					}
					return yield* readDistributionArtifact(gateway, {
						artifact,
						identity,
						sourceSha: execution.sourceSha,
						paths: policy.distribution.files,
					});
				});
				const refs = complete && !execution.refPlan?.distribution
					? []
					: yield* gateway.tagRefs(execution.repository, execution.repositoryId);
				const pending = (execution.reclaims ?? []).filter(tag =>
					refs.some(ref => ref.name === tag.name && ref.oid === tag.oid)
				);
				if (pending.length) {
					const kept = yield* this.reclaimableTags(execution, pending, true, `${policy.prefix}${version}`);
					if (kept.length !== pending.length) {
						return yield* precondition(
							`${
								pending.map(tag => tag.name).join(', ')
							} can no longer move: a release of ${version} published or runs`,
						);
					}
				}
				if (!execution.refPlan) {
					if (complete) return yield* precondition('Ref plan has not been authorized');
					const read = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
					yield* requireImmutableReleases({
						gateway,
						repository: execution.repository,
						token: read,
						required: policy.immutable,
					});
					let target = execution.sourceSha;
					let distribution: RefPlan['distribution'];
					if (policy.distribution) {
						if (policy.phase !== 'version' || !policy.signed) {
							return yield* precondition('Distribution publication requires signed version refs');
						}
						if (!this.env.SIGNER) return yield* precondition('Distribution publication requires the signing service');
						distribution = yield* createDistribution(gateway, {
							repository: execution.repository,
							repositoryId: execution.repositoryId,
							sourceSha: execution.sourceSha,
							version,
							paths: policy.distribution.files,
							files,
							signer: this.env.SIGNER,
						});
						target = distribution.commit;
					} else {
						if (files.length) return yield* precondition('No distribution files are configured');
						if (policy.phase === 'aliases') {
							const targets = new Set<string>();
							const visited = new Set<string>();
							const collect = (id: string): CoordinatorEffect<void, DomainError> =>
								Effect.gen({ self: this }, function*() {
									if (visited.has(id)) return;
									visited.add(id);
									const dependency = yield* getExecution(id);
									if (
										dependency.state !== 'succeeded' || dependency.sourceSha !== execution.sourceSha
										|| dependency.configurationSha !== execution.configurationSha
									) return yield* precondition('Alias dependency identity changed');
									if (dependency.refPlan?.distribution) targets.add(dependency.refPlan.distribution.commit);
									for (const parent of dependency.dependencies) yield* collect(parent);
								});
							for (const id of execution.dependencies) yield* collect(id);
							if (targets.size > 1) {
								return yield* precondition('Alias dependencies contain different distribution targets');
							}
							target = targets.values().next().value ?? target;
						}
					}
					const changes = yield* planRefs(
						policy,
						version,
						target,
						refs,
						yield* this.modulePrefixes(execution),
						execution.reclaims ?? [],
					);
					execution.refPlan = yield* this.signRefs({
						repository: execution.repository,
						executionId: id,
						version,
						changes,
						...(distribution ? { distribution } : {}),
					});
					yield* putExecution(execution);
				}
				const plan = execution.refPlan;
				if (!complete && plan.distribution && policy.distribution) {
					if (
						files.length !== policy.distribution.files.length
						|| new Set(files.map(file => file.path)).size !== files.length
						|| files.some(file => !policy.distribution?.files.includes(file.path))
					) return yield* precondition('Distribution files differ from the frozen plan');
					const token = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
					for (const file of files) {
						if (
							(yield* readDistributionFile(
								gateway,
								execution.repository,
								file.path,
								plan.distribution.commit,
								file.encoding,
								token,
							)) !== file.after
							|| (yield* readDistributionFile(
								gateway,
								execution.repository,
								file.path,
								execution.sourceSha,
								file.encoding,
								token,
							))
								!== file.before
							|| (yield* readDistributionMode(
								gateway,
								execution.repository,
								file.path,
								plan.distribution.commit,
								token,
							))
								!== (file.mode ?? '100644')
						) return yield* precondition('Distribution files differ from the frozen plan');
					}
				}
				if (complete) {
					const problem = yield* this.distributionProblem(execution, plan, refs);
					if (problem) return yield* precondition(problem);
					execution.publications = yield* mergePublications(execution.publications, [{
						id: `refs:${execution.operation}`,
						manager: 'workflow',
						name: execution.repository,
						version,
						outcome: 'succeeded',
						required: true,
					}]);
					yield* putExecution(execution);
				}
				return plan;
			}),
			'coordinator.refs',
			{ executionId: id },
		);
	}
	private distributionProblem(
		execution: Execution,
		plan: RefPlan,
		refs: RefState[],
	): CoordinatorEffect<string | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const evidence = plan.distribution;
			if (!evidence) return undefined;
			if (
				evidence.sourceSha !== execution.sourceSha || plan.changes.some(change => change.commit !== evidence.commit)
			) return 'Distribution refs differ from the authorized source and target';
			for (const change of plan.changes) {
				if (change.object) {
					const expected = yield* tagObjectId(change.object);
					if (!refs.some(ref => ref.name === change.name && ref.oid === expected)) {
						return 'Distribution tag object differs from the signed plan';
					}
				}
			}
			if (
				!plan.changes.every(change =>
					refs.some(ref =>
						ref.name === change.name && ref.commit === change.commit && (!change.annotated || ref.oid !== ref.commit)
					)
				)
			) return 'Distribution refs did not land';
			const gateway = yield* this.gateway;
			const token = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
			const branch = yield* gateway.read(
				gitRefSchema,
				`/repos/${execution.repository}/git/ref/heads/${encodeURIComponent(evidence.branch)}`,
				token,
			);
			if (branch.object.type !== 'commit') return 'Distribution ancestry did not land';
			if (branch.object.sha !== evidence.ancestryCommit) {
				const compared = yield* gateway.read(
					comparisonSchema,
					`/repos/${execution.repository}/compare/${evidence.ancestryCommit}...${branch.object.sha}`,
					token,
				);
				if (compared.status !== 'ahead' || compared.merge_base_commit.sha !== evidence.ancestryCommit) {
					return 'Distribution ancestry did not land';
				}
			}
			return undefined;
		});
	}
	private signRefs(plan: RefPlan): CoordinatorEffect<RefPlan, DomainError> {
		const signer = this.env.SIGNER;
		if (!signer || !plan.changes.some(change => change.annotated)) return Effect.succeed(plan);
		return Effect.gen(function*() {
			const clock = yield* Clock.Clock;

			const identity = yield* fromPromise(() => signer.identity());
			if (!/^[^<>\n]+ <[^<>\s]+>$/.test(identity.userId)) {
				return yield* precondition('The signing key needs a user ID with a name and email');
			}
			const tagger = `${identity.userId} ${Math.floor(clock.currentTimeMillisUnsafe() / 1000)} +0000`;
			const changes = yield* Effect.forEach(
				plan.changes,
				change =>
					change.annotated && (change.expected === null || change.replaces)
						? fromPromise(() =>
							signer.sign(tagPayload(change, `Release ${plan.version}`, tagger), `beepboop:${plan.repository}`)
						)
							.pipe(Effect.map(signature => ({
								...change,
								signed: true,
								object: tagObject(change, plan.version, tagger, signature),
							})))
						: Effect.succeed(change),
			);
			return { ...plan, changes, publicKey: identity.publicKey };
		});
	}
	private promoted(execution: Execution): CoordinatorEffect<boolean, DomainError> {
		if (execution.operation === 'promote') return Effect.succeed(true);
		const visited = new Set<string>();
		const approved = (current: Execution): CoordinatorEffect<boolean, DomainError> =>
			Effect.gen({ self: this }, function*() {
				if (visited.has(current.id)) return false;
				visited.add(current.id);
				if (current.state !== 'succeeded' || current.sourceSha !== execution.sourceSha) return false;
				if (current.operation === 'promote') return true;
				for (const dependency of current.dependencies) {
					if (yield* approved(yield* getExecution(dependency))) return true;
				}
				return false;
			});
		return Effect.gen({ self: this }, function*() {
			for (const dependency of execution.dependencies) {
				if (yield* approved(yield* getExecution(dependency))) return true;
			}
			return false;
		});
	}
	publishRelease(id: string, identity: RunIdentity): Promise<Execution> {
		return this.serial(this.releasePublication(id, identity), 'coordinator.publishRelease', { executionId: id });
	}
	private releasePublication(id: string, identity: RunIdentity): CoordinatorEffect<Execution, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const execution = yield* getExecution(id);
			if (!execution.workflow || execution.managed) return yield* precondition('Operation is not a workflow');
			yield* WorkflowRunGuard.require(execution, identity, {
				_tag: 'SameRunAndName',
				mismatch: 'Release operation identity mismatch',
			});
			if (!publishesGithubRelease(execution)) {
				return yield* precondition(`Add github-release:${execution.repository} to this operation's publications`);
			}
			if (!(yield* this.promoted(execution))) {
				return yield* precondition('Release operation requires completed promotion');
			}
			if (
				execution.workflow.refs?.distribution
				&& (!execution.refPlan?.distribution
					|| !execution.publications.some(publication =>
						publication.id === `refs:${execution.operation}` && publication.outcome === 'succeeded'
					))
			) {
				return yield* precondition('Confirm distribution refs and ancestry before publishing the release');
			}
			const target = yield* fromSync(() => githubRelease(execution));
			if (!target) return yield* precondition('Release operation has no version');
			const { tag, prerelease } = target;
			const gateway = yield* this.gateway;
			if (execution.refPlan?.distribution) {
				const refs = yield* gateway.tagRefs(execution.repository, execution.repositoryId);
				const problem = yield* this.distributionProblem(execution, execution.refPlan, refs);
				if (problem) return yield* precondition(problem);
			}
			const repository = `/repos/${execution.repository}`;
			const read = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
			yield* requireImmutableReleases({
				gateway,
				repository: execution.repository,
				token: read,
				required: execution.workflow?.refs?.immutable,
			});
			const ref = yield* gateway.read(
				Schema.NullOr(gitRefSchema),
				`${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
				read,
			);
			if (ref === null) return yield* precondition('Publish the release tag before the release');
			const object = ref.object;
			if (object.type !== 'tag') return yield* precondition('Release tag must be annotated');
			const tagged = yield* gateway.peelTag(execution.repository, object, read);
			if (tagged.type !== 'commit' || tagged.sha !== releaseCommit(execution)) {
				return yield* precondition('Release tag points to another commit');
			}
			const write = yield* gateway.token(execution.repository, execution.repositoryId, {
				contents: 'write',
				workflows: 'write',
			});
			const release = execution.draftRelease
				? yield* this.publishDraft(execution, execution.draftRelease, target, write)
				: (yield* gateway.read(
					Schema.NullOr(releaseSchema),
					`${repository}/releases/tags/${encodeURIComponent(tag)}`,
					read,
				))
					?? (yield* gateway.read(releaseSchema, `${repository}/releases`, write, 'POST', {
						tag_name: tag,
						target_commitish: releaseCommit(execution),
						name: tag,
						body: yield* this.releaseBody(execution, tag, write),
						prerelease,
					}));
			if (release.tag_name !== tag || release.draft !== false || release.prerelease !== prerelease) {
				return yield* precondition('Existing GitHub release does not match the release operation');
			}
			yield* verifyImmutableRelease(release, execution.workflow?.refs?.immutable);
			const released = yield* this.released(execution, release, tag);
			yield* putExecution(released);
			return released;
		});
	}
	private released(execution: Execution, release: GitHubRelease, tag: string): Effect.Effect<Execution, DomainError> {
		return mergePublications(execution.publications, [{
			id: `github-release:${execution.repository}`,
			manager: 'github-release',
			name: execution.repository,
			version: tag,
			outcome: 'succeeded',
			required: true,
			...(typeof release.html_url === 'string' ? { url: release.html_url } : {}),
		}]).pipe(Effect.map(publications => ({
			...execution,
			publications,
			release: {
				id: `github:${execution.repositoryId}:${release.id}`,
				repository: { id: execution.repositoryId, name: execution.repository },
				stream: execution.stream,
				commit: releaseCommit(execution),
				version: execution.version ?? tag.replace(/^v/, ''),
				tag,
				releaseId: release.id,
				artifacts: [],
				publications: [],
			},
		})));
	}
	releasePublished(tag: string): Promise<void> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				for (const execution of yield* allExecutions) {
					if (!recoverable(execution) || !execution.version) continue;
					if ((yield* fromSync(() => githubRelease(execution)))?.tag !== tag) continue;
					const next = yield* this.publishedRelease(execution);
					if (next !== execution) yield* putExecution(next);
				}
			}),
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
	private publishedRelease(input: Execution): CoordinatorEffect<Execution, DomainError> {
		return Effect.gen({ self: this }, function*() {
			let execution = input;
			const policy = execution.workflow?.refs;
			const version = execution.version;
			const target = yield* fromSync(() => githubRelease(execution));
			const tagged = !policy
				|| execution.publications.some(p => p.id === `refs:${execution.operation}` && p.outcome === 'succeeded');
			if (
				!['failed', 'blocked', 'cancelled'].includes(execution.state) || execution.runId === undefined || !version
				|| !target
				|| !publishesGithubRelease(execution)
			) return execution;
			const { tag, prerelease } = target;
			const gateway = yield* this.gateway;
			const refs = yield* gateway.tagRefs(execution.repository, execution.repositoryId);
			const modulePrefixes = yield* this.modulePrefixes(execution);
			let native = false;
			if (policy?.distribution && !execution.refPlan?.distribution) {
				const plan = yield* observedDistribution(gateway, execution, refs, modulePrefixes);
				if (!plan) return input;
				execution = { ...execution, refPlan: plan };
				native = true;
			}
			if (execution.refPlan && (yield* this.distributionProblem(execution, execution.refPlan, refs))) return input;
			if (
				!refs.some(ref =>
					ref.name === tag && ref.commit === releaseCommit(execution) && (native || ref.oid !== ref.commit)
				)
			) {
				return input;
			}
			const read = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
			const release = yield* gateway.read(
				Schema.NullOr(releaseSchema),
				`/repos/${execution.repository}/releases/tags/${encodeURIComponent(tag)}`,
				read,
			);
			if (!release || release.tag_name !== tag || release.draft !== false || release.prerelease !== prerelease) {
				return input;
			}
			yield* verifyImmutableRelease(release, execution.workflow?.refs?.immutable);
			const fresh = yield* gateway.read(
				Schema.NullOr(gitRefSchema),
				`/repos/${execution.repository}/git/ref/tags/${encodeURIComponent(tag)}`,
				read,
			);
			if (!fresh || !refs.some(ref => ref.name === tag && ref.oid === fresh.object.sha)) return input;
			const pinned = yield* gateway.peelTag(execution.repository, fresh.object, read);
			if (pinned.type !== 'commit' || pinned.sha !== releaseCommit(execution)) return input;
			if (native) {
				for (const change of execution.refPlan?.changes ?? []) {
					if (change.name === tag) continue;
					const companion = yield* gateway.read(
						Schema.NullOr(gitRefSchema),
						`/repos/${execution.repository}/git/ref/tags/${encodeURIComponent(change.name)}`,
						read,
					);
					if (!companion || companion.object.sha !== change.expected) return input;
					const pinnedCompanion = yield* gateway.peelTag(execution.repository, companion.object, read);
					if (pinnedCompanion.type !== 'commit' || pinnedCompanion.sha !== releaseCommit(execution)) return input;
				}
			}
			let next = yield* this.released(execution, release, tag);
			const landed = !policy || (native
				? versionTagged(
					policy,
					yield* fromSync(() => decodeSync(semVer, version)),
					releaseCommit(execution),
					refs,
					modulePrefixes,
				)
				: (yield* refsLanded(
					policy,
					version,
					releaseCommit(execution),
					refs,
					modulePrefixes,
				)));
			if (!landed) return native ? input : next;
			if (policy && !tagged) {
				next = {
					...next,
					publications: yield* mergePublications(next.publications, [{
						id: `refs:${next.operation}`,
						manager: 'workflow',
						name: next.repository,
						version,
						outcome: 'succeeded',
						required: true,
					}]),
				};
			}
			if (native || next.state === 'cancelled' || next.state === 'blocked') {
				const settled = settle(next, true);
				if (settled.state !== 'succeeded') return input;
				delete settled.reason;
				return settled;
			}
			return publishedAfterFailure(next) ?? next;
		});
	}
	private draftRelease(execution: Execution): CoordinatorEffect<Execution['draftRelease'], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const target = yield* fromSync(() => githubRelease(execution));
			if (!target || !publishesGithubRelease(execution)) return execution.draftRelease;
			if (execution.workflow?.refs?.distribution && !execution.refPlan?.distribution) return undefined;
			const gateway = yield* this.gateway;
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
				mutableArray(releaseSchema),
				`/repos/${execution.repository}/releases?per_page=100`,
				write,
			)).filter(release => release.draft === true && release.tag_name === target.tag);
			const matches = (release: GitHubRelease) =>
				release.target_commitish === releaseCommit(execution) && release.prerelease === target.prerelease;
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
					target_commitish: releaseCommit(execution),
					name: target.tag,
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
	): CoordinatorEffect<GitHubRelease, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const gateway = yield* this.gateway;
			const path = `/repos/${execution.repository}/releases/${draft.id}`;
			const release = yield* gateway.read(Schema.NullOr(releaseSchema), path, token);
			if (release === null) return yield* precondition('Draft GitHub release no longer exists');
			if (draft.tag !== target.tag || release.tag_name !== target.tag || release.prerelease !== target.prerelease) {
				return yield* precondition('Draft GitHub release does not match the release operation');
			}
			if (release.draft !== true) return release;
			const bot = yield* gateway.botIdentity;
			const listed = yield* gateway.read(
				mutableArray(releaseSchema),
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
			return yield* gateway.read(releaseSchema, path, token, 'PATCH', {
				draft: false,
				body: yield* this.releaseBody(execution, target.tag, token),
			});
		});
	}
	private releaseBody(execution: Execution, tag: string, token: string): CoordinatorEffect<string, DomainError> {
		return Effect.gen({ self: this }, function*() {
			return yield* (yield* this.gateway).read(
				releaseNotesSchema,
				`/repos/${execution.repository}/releases/generate-notes`,
				token,
				'POST',
				{ tag_name: tag, target_commitish: releaseCommit(execution) },
			).pipe(Effect.map(generated => releaseNotes(generated.body)));
		});
	}
	report(
		id: string,
		identity: RunIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	): Promise<Execution> {
		return this.serial(this.recordReport(id, identity, publications, artifacts), 'coordinator.report', {
			executionId: id,
		});
	}
	publishNext(id: string, identity: RunIdentity): Promise<NextStep> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const { execution, holder } = yield* this.publishing(id, identity);
				let ledger = yield* this.ledgerOf(execution);
				const now = clock.currentTimeMillisUnsafe();
				const ledgers = yield* this.ledgers(), executions = yield* allExecutions;
				const waits: { until: number; reason: string }[] = [];
				for (const purl of ledger.records.map(record => record.purl)) {
					const record = ledger.records.find(entry => entry.purl === purl);
					if (!record) continue;
					const open = availability(record, holder, now);
					if (open.kind === 'settled' || open.kind === 'uploaded') continue;
					if (open.kind === 'held') {
						return { kind: 'publish' as const, package: yield* this.ledgerView(execution, record) };
					}
					if (open.kind === 'wait') {
						waits.push(open);
						continue;
					}
					const blocked = dependencyBlocker(execution, record, holder, ledgers, executions, now);
					if (blocked?.kind === 'failed') {
						ledger = yield* this.settleRecord(ledger, fail(record, holder, blocked.reason, false, now));
					} else if (blocked) waits.push({ until: blocked.until, reason: blocked.reason });
					else return { kind: 'publish' as const, package: yield* this.ledgerView(execution, record) };
				}
				const [wait] = waits.sort((a, b) => a.until - b.until);
				if (wait) {
					const cycle = publicationDeadlock(
						ledger,
						[ledger, ...ledgers.filter(other => other.executionId !== id)],
						executions,
						now,
					);
					if (cycle) return yield* precondition(`Publication dependency cycle at ${cycle.id}`);
				}
				return wait
					? { kind: 'wait' as const, ...wait }
					: { kind: 'done' as const, entries: ledger.records.map(entry) };
			}),
			'coordinator.publishNext',
			{ executionId: id },
		);
	}
	publishClaim(id: string, identity: RunIdentity, purl: string, digest: string): Promise<ClaimStep> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const { execution, holder } = yield* this.publishing(id, identity);
				const ledger = yield* this.ledgerOf(execution);
				let record = yield* this.recordOf(ledger, purl);
				const now = clock.currentTimeMillisUnsafe();
				const open = availability(record, holder, now);
				if (open.kind === 'settled' || open.kind === 'uploaded') {
					return { kind: 'settled' as const, entry: entry(record) };
				}
				if (open.kind === 'wait') return { kind: 'wait' as const, until: open.until, reason: open.reason };
				if (open.kind === 'open') {
					const blocked = dependencyBlocker(
						execution,
						record,
						holder,
						yield* this.ledgers(),
						yield* allExecutions,
						now,
					);
					if (blocked?.kind === 'failed') {
						return yield* this.settled(ledger, fail(record, holder, blocked.reason, false, now));
					}
					if (blocked) return { kind: 'wait' as const, until: blocked.until, reason: blocked.reason };
					const found = yield* this.registry(execution, { ...record, digest });
					const verified = yield* this.verified(
						ledger,
						record,
						holder,
						found,
						url => reuse({ ...record, digest }, holder, url, now),
						now,
					);
					if (verified) return verified;
					if (found.outcome !== 'pending') {
						return {
							kind: 'wait' as const,
							until: now + 15_000,
							reason: `${registries[record.manager]} could not confirm whether it has ${label(record)}`,
						};
					}
					if (record.manager === 'cargo' && !record.reservation) {
						const { kind, allowedAt } = yield* this.reserveCrate(
							execution.repositoryId,
							pkg => packageId(pkg) === record.id,
						);
						record = { ...record, reservation: kind, notBefore: allowedAt };
						yield* this.settleRecord(ledger, record);
						const paced = availability(record, holder, now);
						if (paced.kind === 'wait') {
							yield* this.recordPublication(execution.id, record, pacedPublication(record, paced.until));
							return { kind: 'wait' as const, until: paced.until, reason: paced.reason };
						}
					}
				}
				const claimed = yield* Effect.fromResult(claim(record, holder, digest, now));
				yield* this.settleRecord(ledger, claimed);
				return { kind: 'publish' as const, package: yield* this.ledgerView(execution, claimed) };
			}),
			'coordinator.publishClaim',
			{ executionId: id },
		);
	}
	publishReport(id: string, identity: RunIdentity, report: PublishReport): Promise<ReportStep> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const { execution, holder } = yield* this.publishing(id, identity);
				const ledger = yield* this.ledgerOf(execution);
				const record = yield* this.recordOf(ledger, report.purl);
				const now = clock.currentTimeMillisUnsafe();
				const open = availability(record, holder, now);
				if (open.kind === 'settled' || open.kind === 'uploaded') {
					return { kind: 'settled' as const, entry: entry(record) };
				}
				if (report.outcome === 'failed' && open.kind === 'open') {
					return yield* this.settled(ledger, fail(record, holder, report.message, false, now));
				}
				if (open.kind !== 'held') return yield* precondition(`This run does not hold ${label(record)}`);
				if (report.outcome === 'rate-limited') {
					const until = parseRetryAfter(report.retryAfter ?? '', now) ?? now + defaultRetryAfter;
					if (record.manager === 'cargo') {
						yield* fromPromise(() => this.env.PUBLISH_BUDGET.getByName('crates-io').defer(until));
					}
					return yield* this.settled(ledger, rateLimit(record, holder, until, now));
				}
				if (report.outcome === 'published') {
					return yield* this.settled(ledger, publish(record, holder, '', now));
				}
				const found = yield* this.registry(execution, record);
				const verified = yield* this.verified(
					ledger,
					record,
					holder,
					found,
					url => publish(record, holder, url, now),
					now,
				);
				return verified ?? (yield* this.settled(ledger, fail(record, holder, report.message, false, now)));
			}),
			'coordinator.publishReport',
			{ executionId: id },
		);
	}
	private publishing(
		id: string,
		identity: RunIdentity,
	): CoordinatorEffect<{ execution: Execution; holder: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const execution = yield* getExecution(id);
			yield* WorkflowRunGuard.require(execution, identity, {
				_tag: 'SameRun',
				mismatch: 'Publication identity mismatch',
			});
			return { execution, holder: `${identity.runId}:${identity.attempt}` };
		});
	}
	private ledgers(): CoordinatorEffect<Ledger[], DomainError> {
		return DurableStorage.use(storage => storage.list(Keys.ledger)).pipe(
			Effect.map(entries => entries.map(entry => entry.value)),
		);
	}
	private acceptedUploads(ledger: Ledger): CoordinatorEffect<Ledger, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			let next = ledger;
			const execution = yield* getExecution(ledger.executionId);
			for (const record of ledger.records) {
				if (record.status.state === 'uploaded') {
					next = yield* this.settleRecord(
						next,
						publish(record, record.status.holder, '', clock.currentTimeMillisUnsafe()),
					);
				} else if (missingReceipt(execution, record)) {
					const publication = publicationOf(record);
					if (publication) yield* this.recordPublication(ledger.executionId, record, publication);
				}
			}
			return next;
		});
	}
	private ledgerOf(execution: Execution): CoordinatorEffect<Ledger, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const storage = yield* DurableStorage;
			const stored = yield* storage.get(Keys.ledger, execution.id);
			if (stored !== undefined) return yield* this.acceptedUploads(stored);
			const repository = yield* (yield* this.store).repositories.get(execution.repositoryId);
			if (!repository) return yield* precondition('Repository is not enrolled');
			const version = execution.version;
			if (!version) return yield* precondition('The execution has no version to publish');
			const ledger = planLedger(execution, repository.inventory, version);
			yield* storage.put(Keys.ledger, execution.id, ledger);
			return ledger;
		});
	}
	private recordOf(ledger: Ledger, purl: string): CoordinatorEffect<LedgerRecord, DomainError> {
		const record = ledger.records.find(entry => entry.purl === purl);
		return record ? Effect.succeed(record) : Effect.fail(precondition(`${purl} is not in this execution's plan`));
	}
	private registry(execution: Execution, record: LedgerRecord): CoordinatorEffect<Publication, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const service = yield* Automation;
			return yield* Effect.fromResult(parseReleaseIdentity(record.purl)).pipe(
				Effect.mapError(toDomainError),
				Effect.flatMap(identity => {
					const publication: Publication = {
						identity,
						id: record.id,
						manager: record.manager,
						name: record.name,
						version: record.version,
						required: record.required,
						...(record.digest ? { digest: record.digest } : {}),
						outcome: 'succeeded',
					};
					return verifyPublication(
						publication,
						service.dependencies.transport,
						service.gateway.verification(execution.repository, execution.repositoryId),
					).pipe(Effect.map(outcome => verifiedPublication(publication, outcome)));
				}),
			);
		});
	}
	private verified(
		ledger: Ledger,
		record: LedgerRecord,
		holder: string,
		found: Publication,
		accept: (url: string) => LedgerRecord,
		now: number,
	): CoordinatorEffect<Extract<ReportStep, { kind: 'settled' }> | undefined, DomainError> {
		if (found.outcome === 'succeeded') return this.settled(ledger, accept(found.url ?? ''));
		if (found.outcome === 'failed') {
			return this.settled(
				ledger,
				fail(record, holder, `${registries[record.manager]} has a different ${label(record)}`, true, now),
			);
		}
		return Effect.undefined;
	}
	private reserveCrate(
		repositoryId: number,
		matches: (pkg: Package) => boolean,
	): CoordinatorEffect<{ kind: PublishKind; allowedAt: number }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const inventory = (yield* (yield* this.store).repositories.get(repositoryId))?.inventory;
			const kind = reservation(inventory?.packages.find(matches)?.publicationStatus);
			const allowedAt = yield* fromPromise(() => this.env.PUBLISH_BUDGET.getByName('crates-io').reserve(kind));
			return { kind, allowedAt };
		});
	}
	private settleRecord(ledger: Ledger, record: LedgerRecord): CoordinatorEffect<Ledger, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const next = {
				...ledger,
				records: ledger.records.map(entry => entry.purl === record.purl ? record : entry),
			};
			yield* (yield* DurableStorage).put(Keys.ledger, ledger.executionId, next);
			const publication = publicationOf(record);
			if (publication) yield* this.recordPublication(ledger.executionId, record, publication);
			return next;
		});
	}
	private recordPublication(
		executionId: string,
		record: LedgerRecord,
		publication: Publication,
	): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const execution = yield* getExecution(executionId);
			const identity = yield* Effect.fromResult(parseReleaseIdentity(record.purl)).pipe(Effect.mapError(toDomainError));
			yield* putExecution({
				...execution,
				publications: yield* mergePublications(execution.publications, [{ ...publication, identity }]),
			});
		});
	}
	private settled(
		ledger: Ledger,
		record: LedgerRecord,
	): CoordinatorEffect<Extract<ReportStep, { kind: 'settled' }>, DomainError> {
		return this.settleRecord(ledger, record).pipe(Effect.as({
			kind: 'settled' as const,
			entry: entry(record),
			...(record.status.state === 'rate-limited' ? { until: record.status.retryAfter } : {}),
		}));
	}
	private recordReport(
		id: string,
		identity: RunIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	): CoordinatorEffect<Execution, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const execution = yield* getExecution(id);
			const workflow = execution.workflow;
			if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
			yield* WorkflowRunGuard.require(execution, identity, { _tag: 'SameRun', mismatch: 'Report identity mismatch' });
			for (const artifact of artifacts) {
				if (artifact.runId !== identity.runId) return yield* precondition('Artifact producer mismatch');
				if (
					!sha256DigestPattern.test(artifact.digest)
					|| !(Date.parse(artifact.expiresAt) > clock.currentTimeMillisUnsafe())
				) {
					return yield* precondition('Artifact has no usable digest or has expired');
				}
			}
			const accepted: Publication[] = [];
			let release = execution.release;
			for (const reported of publications) {
				const identity = yield* Effect.fromResult(parseIdentity(reported, execution.repository)).pipe(
					Effect.mapError(toDomainError),
				);
				const publication = { ...reported, identity };
				if (publication.id.startsWith('refs:')) {
					return yield* precondition('Ref results are recorded by the ref completion endpoint');
				}
				yield* validatePublicationIdentity(execution, publication);
				if (publication.manager === 'github-release' && publication.name !== execution.repository) {
					return yield* precondition('Release repository mismatch');
				}
				if (publication.manager === 'github-release' && publication.outcome === 'succeeded') {
					if (release?.tag && release.tag !== publication.version) {
						return yield* precondition('Release identity changed');
					}
					release = {
						id: `github:${execution.repositoryId}:tag:${publication.version}`,
						repository: { id: execution.repositoryId, name: execution.repository },
						stream: execution.stream,
						commit: execution.sourceSha,
						version: execution.version ?? publication.version.replace(/^v/, ''),
						artifacts: [],
						publications: [],
						...release,
						tag: publication.version,
					};
				}
				accepted.push(publication);
			}
			const merged = yield* mergeArtifacts(execution.artifacts, artifacts, workflow.outputs);
			const next = {
				...execution,
				release,
				publications: yield* mergePublications(execution.publications, accepted),
				artifacts: merged,
			};
			yield* putExecution(next);
			return next;
		});
	}
	private supersedeVersion(execution: Execution): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (execution.operation !== 'promote' || !execution.version) return;
			for (const other of yield* allExecutions) {
				if (
					other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
					&& other.version === execution.version
					&& ['awaiting-approval', 'blocked', 'pending', 'ready', 'failed'].includes(other.state)
				) {
					yield* putExecution({ ...other, state: 'cancelled', reason: `Superseded by ${execution.id}` });
				}
			}
		});
	}
	private approveFromPush(execution: Execution, executions: Execution[]): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const newer = executions.find(other =>
				other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
				&& other.version === execution.version && other.createdAt > execution.createdAt
				&& !['succeeded', 'cancelled', 'failed'].includes(other.state)
			);
			if (newer) {
				yield* putExecution({ ...execution, state: 'cancelled', reason: `Superseded by ${newer.id}` });
				return true;
			}
			const conflict = yield* this.tagProblem(execution, true);
			if (conflict) {
				yield* putExecution({ ...execution, state: 'cancelled', reason: conflict });
				return true;
			}
			const waiting = (yield* this.ungranted(execution)) ?? (yield* this.upstream(execution, executions));
			if (waiting) {
				if (execution.reason !== waiting) yield* putExecution({ ...execution, reason: waiting });
				return false;
			}
			const forced = execution.started?.force === true;
			const { pending, failed, skipped } = forced
				? { pending: [], failed: [], skipped: [] }
				: yield* this.commitChecks(execution);
			if (execution.approvedBy === 'start' && failed.length) {
				yield* putExecution({ ...execution, state: 'failed', reason: failed.join('; ') });
				return true;
			}
			const problems = [...failed, ...pending];
			if (problems.length) {
				const reason = problems.join('; ');
				if (execution.reason !== reason) yield* putExecution({ ...execution, reason });
				return false;
			}
			yield* (yield* this.store).audit(
				'beepboop',
				'promotion.approve',
				`${execution.id}:${execution.sourceSha}:${execution.approvedBy ?? 'push'}${forced ? ':forced' : ''}${
					skipped.length ? ` skipping: ${skipped.join('; ')}` : ''
				}`,
			);
			const next: Execution = { ...execution, state: 'ready', approvedAt: clock.currentTimeMillisUnsafe() };
			delete next.reason;
			yield* this.supersedeVersion(next);
			yield* putExecution(next);
			return true;
		});
	}
	private ungranted(execution: Execution): CoordinatorEffect<string | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const stream = execution.configuration.streams[execution.stream];
			if (!stream?.credentials.length) return undefined;
			const record = yield* (yield* this.store).repositories.get(execution.repositoryId);
			const defaultBranch = record?.defaultBranch ?? execution.workflow?.ref ?? '';
			const bindings = [
				['promote', stream.promote.workflow] as const,
				['prepare', stream.prepare.workflow] as const,
				...Object.entries(stream.workflows).filter(([, binding]) => binding.mode !== 'observe'),
			].flatMap(([operation, binding]) => {
				if (!binding) return [];
				const ref = binding.ref ?? defaultBranch;
				return [{ operation, file: binding.file, ref: ref.startsWith('refs/') ? ref : `refs/heads/${ref}` }];
			});
			const missing: string[] = [];
			for (const alias of stream.credentials) {
				const grants = yield* (yield* Automation).grants.list({ alias, repositoryId: execution.repositoryId });
				if (!coversBinding(grants, bindings, execution.repository)) missing.push(alias);
			}
			const workflow = stream.promote.workflow?.file ?? execution.workflow?.file;
			return missing.length
				? `no runtime grant for ${workflow}: ${missing.join(', ')}`
				: undefined;
		});
	}
	private upstream(execution: Execution, executions: Execution[]): CoordinatorEffect<string | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const record = yield* (yield* this.store).repositories.get(execution.repositoryId);
			if (!record) return undefined;
			const file = execution.workflow?.file;
			if (record.inventory.workflows.some(workflow => workflow.file === file && workflow.ledger)) return undefined;
			const packagesOf = (candidate: Execution) => {
				const references = candidate.configuration.streams[candidate.stream]?.packages;
				return publishablePackages(record.inventory.packages, references);
			};
			const needed = new Set(
				packagesOf(execution).flatMap(pkg => pkg.dependencies.map(name => `${pkg.manager}:${name}`)),
			);
			for (const other of executions) {
				if (
					other.id === execution.id || other.operation !== 'promote' || other.stream === execution.stream
					|| other.repositoryId !== execution.repositoryId
					|| ['succeeded', 'cancelled', 'failed'].includes(other.state)
				) continue;
				const provided = packagesOf(other).filter(pkg =>
					needed.has(`${pkg.manager}:${pkg.name}`)
					&& (other.sourceSha === execution.sourceSha || pkg.version === other.version)
				);
				if (provided.length) {
					return `waiting for ${other.stream}: ${provided.map(packageId).join(', ')}`;
				}
			}
			return undefined;
		});
	}
	approve(id: string, commitSha: string, actor: string, force = false): Promise<Execution> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;

				const execution = yield* getExecution(id);
				const reference = yield* Effect.fromResult(matches(commitSha, approvalShaPattern));
				const commit = yield* Effect.fromResult(sha(execution.sourceSha));
				if (execution.state !== 'awaiting-approval' || !commit.startsWith(reference)) {
					return yield* precondition('This release is not waiting for you to publish that commit');
				}
				const token = yield* (yield* this.gateway).token(execution.repository, execution.repositoryId);
				const head = yield* this.refHead(execution, token);
				if (
					head
					&& (head.tag ? head.sha !== execution.sourceSha : !(yield* this.contains(execution, head.sha, token)))
				) {
					return yield* precondition(
						`${head.ref} is at ${head.sha.slice(0, 12)}. Publish the release for that commit.`,
					);
				}
				const conflict = yield* this.tagProblem(execution, true);
				if (conflict) return yield* precondition(conflict);
				const incomplete = yield* this.metadataBlocks(execution);
				if (incomplete.length) return yield* precondition(incomplete.join('; '));
				const checks = yield* this.commitChecks(execution);
				const problems = [...checks.failed, ...checks.pending];
				if (problems.length && !force) return yield* precondition(problems.join('; '));
				yield* (yield* this.store).audit(
					actor,
					'promotion.approve',
					`${id}:${commit}${problems.length ? ` overriding: ${problems.join('; ')}` : ''}${
						checks.skipped.length ? ` skipping: ${checks.skipped.join('; ')}` : ''
					}`,
				);
				const next: Execution = { ...execution, state: 'ready', approvedAt: clock.currentTimeMillisUnsafe() };
				delete next.reason;
				yield* this.supersedeVersion(next);
				yield* putExecution(next);
				return next;
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
					? (yield* this.runJobs(
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
			Effect.gen({ self: this }, function*() {
				const execution = yield* getExecution(id);
				if (execution.state !== 'awaiting-approval') {
					return { problems: [], blocked: ['This release is not waiting for you to publish it'] };
				}
				const [conflict, incomplete, problems] = yield* Effect.all([
					this.tagProblem(execution),
					this.metadataBlocks(execution),
					Effect.result(this.approvalProblems(execution)),
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
		return this.run(
			Effect.gen({ self: this }, function*() {
				const record = yield* (yield* this.store).repositories.get(repositoryId);
				const configuration = record?.configuration;
				if (!record || !configuration || !Object.hasOwn(configuration.streams, stream)) {
					return yield* notFound('stream', `Unknown stream ${stream}`, stream);
				}
				const release = gatedRelease(yield* allExecutions, stream);
				const subject: GateSubject = release
					?? { repository: record.name, repositoryId, sourceSha: record.sha, configuration, stream };
				const [{ outcomes }, skips, metadata] = yield* Effect.all([
					this.commitGates(subject),
					Effect.flatMap(this.store, store => store.gateSkips.list(repositoryId, stream)),
					this.metadataProblemsOf(subject),
				], { concurrency: 'unbounded' });
				const merged = mergedOutcomes([...outcomes, {
					gate: { kind: 'metadata' },
					state: metadata.length ? 'failed' : 'passed',
					fact: metadata.length ? 'incomplete' : 'complete',
					...(metadata.length ? { detail: metadata.join('; ') } : {}),
				}]);
				const skipOf = (gate: ReleaseGate) => skips.find(skip => sameGate(skip.gate, gate));
				const gates: GateView[] = merged.map(outcome => {
					const skip = skipOf(outcome.gate);
					const { runId: _runId, runDone: _runDone, ...shown } = outcome;
					return { ...shown, ...(skip ? { skipped: { actor: skip.actor, at: skip.at } } : {}) };
				});
				for (const skip of skips) {
					if (merged.some(outcome => sameGate(outcome.gate, skip.gate))) continue;
					gates.push({
						gate: skip.gate,
						state: 'absent',
						fact: 'not on this commit',
						skipped: { actor: skip.actor, at: skip.at },
					});
				}
				return {
					stream,
					commit: subject.sourceSha,
					...(release?.version ? { version: release.version } : {}),
					gates,
				};
			}),
			'coordinator.gates',
			{ repositoryId, stream },
		);
	}
	resolveChecks(id: string, choice: CheckChoice, actor: string): Promise<Execution> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const clock = yield* Clock.Clock;
				const execution = yield* getExecution(id);
				if (execution.operation !== 'promote' || !['failed', 'awaiting-approval'].includes(execution.state)) {
					return yield* precondition('Only a release that waits on its checks or stopped on them takes this choice');
				}
				if (execution.state === 'failed' && (execution.attempts > 0 || execution.approvedAt !== undefined)) {
					return yield* precondition('This release already ran its workflow; retry it instead');
				}
				const [{ outcomes }, skips, metadata] = yield* Effect.all([
					this.commitGates(execution),
					this.gateSkips(execution),
					this.metadataProblemsOf(execution),
				], { concurrency: 'unbounded' });
				const stopping = mergedOutcomes([
					...outcomes,
					...(metadata.length
						? [{ gate: { kind: 'metadata' as const }, state: 'failed' as const, fact: 'incomplete' }]
						: []),
				]).filter(outcome => outcome.state !== 'passed' && !skips.some(skip => sameGate(skip.gate, outcome.gate)));
				const next: Execution = execution.state === 'failed'
					? { ...execution, state: 'awaiting-approval', publications: reopened(execution.publications) }
					: { ...execution };
				delete next.reason;
				if (!stopping.length) {
					if (execution.state !== 'failed') return yield* precondition('No check stops this release');
					yield* putExecution(next);
					yield* this.wakeUp();
					return next;
				}
				const store = yield* this.store;
				const at = clock.currentTimeMillisUnsafe();
				if (choice === 'rerun') {
					const runs = new Map(
						outcomes.flatMap(outcome =>
							outcome.state === 'failed' && outcome.runId !== undefined && outcome.runDone === true
								&& stopping.some(entry => sameGate(entry.gate, outcome.gate))
								? [[outcome.runId, (outcome.runAttempt ?? 1) + 1] as const]
								: []
						),
					);
					if (!runs.size) return yield* precondition('No finished check run failed, so none can rerun');
					const gateway = yield* this.gateway;
					const token = yield* gateway.token(execution.repository, execution.repositoryId, {
						contents: 'read',
						actions: 'write',
					});
					for (const [run, attempt] of runs) {
						yield* gateway.call(`/repos/${execution.repository}/actions/runs/${run}/rerun-failed-jobs`, token, 'POST');
						next.reruns = [...(next.reruns ?? []).filter(rerun => rerun.id !== run), { id: run, attempt }];
						yield* putExecution(next);
						yield* store.audit(actor, 'promotion.checks.rerun', `${id}: ${run}`);
					}
				} else if (choice === 'skip') {
					next.skippedGates = [
						...(execution.skippedGates ?? []),
						...stopping.map(outcome => ({ gate: outcome.gate, actor, at })),
					];
					yield* store.audit(
						actor,
						'promotion.checks.skip',
						`${id}: ${stopping.map(outcome => gateLabel(outcome.gate)).join(', ')}`,
					);
				} else {
					const failing = stopping.filter(outcome => outcome.state === 'failed');
					if (!failing.length) return yield* precondition('No failed check to switch off');
					for (const outcome of failing) {
						yield* store.gateSkips.skip(execution.repositoryId, execution.stream, outcome.gate, actor);
						yield* store.audit(
							actor,
							'stream.gate.skip',
							`${execution.repository}:${execution.stream}:${gateLabel(outcome.gate)}`,
						);
					}
				}
				yield* putExecution(next);
				yield* this.wakeUp();
				return next;
			}),
			'coordinator.resolveChecks',
			{ executionId: id },
		);
	}
	private metadataBlocks(execution: Execution): CoordinatorEffect<string[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (execution.operation !== 'promote') return [];
			const skips = yield* this.gateSkips(execution);
			if (skips.some(skip => skip.gate.kind === 'metadata')) return [];
			return yield* this.metadataProblemsOf(execution);
		});
	}
	private metadataProblemsOf(subject: GateSubject): CoordinatorEffect<string[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const record = yield* (yield* this.store).repositories.get(subject.repositoryId);
			if (!record) return [];
			const references = subject.configuration.streams[subject.stream]?.packages;
			return metadataProblems(record.inventory, publishablePackages(record.inventory.packages, references));
		});
	}
	private tagProblem(execution: Execution, registries = false): CoordinatorEffect<string | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const policy = execution.workflow?.refs;
			const version = safeDecode(semVer, execution.version);
			if (execution.operation !== 'promote' || !policy || !version.success) return undefined;
			const refs = yield* (yield* this.gateway).tagRefs(execution.repository, execution.repositoryId);
			const conflict = tagConflict(
				policy,
				version.data,
				execution.sourceSha,
				refs,
				yield* this.modulePrefixes(execution),
				execution.reclaims ?? [],
			);
			if (conflict) return conflictMessage(conflict);
			const pending = (execution.reclaims ?? []).filter(tag =>
				refs.some(ref => ref.name === tag.name && ref.oid === tag.oid)
			);
			if (!pending.length) return undefined;
			const kept = yield* this.reclaimableTags(execution, pending, registries, tagFor(policy, version.data));
			const lost = pending.find(tag => !kept.some(entry => entry.name === tag.name));
			return lost && `${conflictMessage(lost)}, and that release published packages`;
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
			Effect.gen({ self: this }, function*() {
				const record = yield* (yield* this.store).repositories.get(repositoryId);
				if (!record) return [];
				const probe = { repository: record.name, repositoryId: record.id, stream, version };
				return yield* this.reclaimableTags(probe, conflicts, true, primary);
			}),
			'coordinator.reclaimable',
			{ repositoryId, stream, version },
		);
	}
	private reclaimableTags(
		release: Pick<Execution, 'repository' | 'repositoryId' | 'stream' | 'version' | 'moduleTags'> & { id?: string },
		conflicts: readonly RefState[],
		registries: boolean,
		primary: string,
	): CoordinatorEffect<RefState[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const version = release.version;
			if (!version || !conflicts.length || conflicts.some(tag => tag.name !== primary)) return [];
			const releases = (yield* allExecutions).filter(execution =>
				execution.operation === 'promote' && execution.stream === release.stream
				&& execution.version === version && execution.id !== release.id
			);
			const shipped = releases.some(execution =>
				['succeeded', 'dispatching', 'running', 'uncertain', 'verifying'].includes(execution.state)
				|| execution.publications.some(publication =>
					publication.outcome === 'succeeded' && !publication.id.startsWith('refs:')
				)
			);
			if (shipped) return [];
			const pushed: string[] = [];
			for (const execution of releases) {
				if (
					!['failed', 'cancelled'].includes(execution.state)
					|| !execution.publications.some(publication =>
						publication.id === 'refs:promote' && publication.outcome === 'succeeded'
					)
				) continue;
				for (const change of execution.refPlan?.changes ?? []) {
					if (change.object === undefined || (change.expected !== null && !change.replaces)) continue;
					pushed.push(`${change.name} ${change.commit} ${yield* tagObjectId(change.object)}`);
				}
			}
			const owned = conflicts.filter(tag => pushed.includes(`${tag.name} ${tag.commit} ${tag.oid}`));
			if (owned.length !== conflicts.length) return [];
			const record = yield* (yield* this.store).repositories.get(release.repositoryId);
			const stream = record?.configuration?.streams[release.stream];
			const modulePrefixes = [
				...streamModuleTagPrefixes(record?.inventory.packages ?? [], stream),
				...tagPrefixes(release.moduleTags ?? []),
			];
			for (const execution of releases) modulePrefixes.push(...yield* this.modulePrefixes(execution));
			if (modulePrefixes.some(prefix => `${prefix}${version}` === primary)) return [];
			const gateway = yield* this.gateway;
			const token = yield* gateway.token(release.repository, release.repositoryId, {
				contents: 'read',
				actions: 'read',
			});
			for (const execution of releases) {
				if (execution.runId === undefined) continue;
				const run = yield* gateway.read(
					workflowRunSchema,
					`/repos/${release.repository}/actions/runs/${execution.runId}`,
					token,
				);
				if (run.status !== 'completed') return [];
			}
			for (const commit of new Set(owned.map(tag => tag.commit))) {
				for (let page = 1;; page++) {
					const { workflow_runs: runs } = yield* gateway.read(
						workflowRunsSchema,
						`/repos/${release.repository}/actions/runs?head_sha=${commit}&per_page=100&page=${page}`,
						token,
					);
					if (runs.some(run => run.status !== 'completed')) return [];
					if (runs.length < 100) break;
				}
			}
			for (const tag of owned) {
				const published = yield* gateway.read(
					Schema.NullOr(releaseSchema),
					`/repos/${release.repository}/releases/tags/${encodeURIComponent(tag.name)}`,
					token,
				);
				if (published !== null) return [];
			}
			if (!registries) return owned;
			if (!record || !stream) return [];
			const transport = (yield* Automation).dependencies.transport;
			const context = gateway.verification(release.repository, release.repositoryId);
			const probes = new Map<string, Publication>();
			for (const pkg of publishablePackages(record.inventory.packages, stream.packages)) {
				probes.set(`${pkg.manager}:${pkg.name}`, {
					id: packageId(pkg),
					identity: publicationIdentity(pkg, version),
					manager: pkg.manager,
					name: pkg.name,
					version,
					outcome: 'pending',
					required: true,
				});
			}
			for (const execution of releases) {
				const frozen = execution.configuration.streams[execution.stream];
				const references = [
					...(frozen?.packages ?? []),
					...(frozen?.required ?? []),
					...(execution.workflow?.publications ?? []),
				];
				for (const reference of references) {
					const probe = referenceProbe(reference, version);
					if (probe) probes.set(`${probe.manager}:${probe.name}`, probe);
				}
				for (const publication of execution.publications) {
					if (publication.manager === 'workflow' || publication.id.startsWith('refs:')) continue;
					probes.set(`${publication.manager}:${publication.name}`, {
						id: publication.id,
						...(publication.identity ? { identity: publication.identity } : {}),
						manager: publication.manager,
						name: publication.name,
						version,
						outcome: 'pending',
						required: true,
					});
				}
			}
			const outcomes = yield* Effect.forEach(
				[...probes.values()].filter(publication => canVerifyPublication(publication.manager)),
				publication =>
					Effect.all([
						verifyPublication(publication, transport, context),
						verifySecondaryPublications(publication, transport),
					]).pipe(Effect.map(([primary, secondary]) => [primary, ...secondary])),
				{ concurrency: 8 },
			);
			return outcomes.flat().every(outcome => outcome._tag === 'Pending') ? owned : [];
		});
	}
	private versionTagged(execution: Execution): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const policy = execution.workflow?.refs;
			const version = safeDecode(semVer, execution.version);
			if (!policy || !version.success) return false;
			const refs = yield* (yield* this.gateway).tagRefs(execution.repository, execution.repositoryId);
			return versionTagged(policy, version.data, releaseCommit(execution), refs, yield* this.modulePrefixes(execution));
		});
	}
	private modulePrefixes(execution: Execution): CoordinatorEffect<string[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (execution.moduleTags) return tagPrefixes(execution.moduleTags);
			return yield* (yield* this.store).repositories.get(execution.repositoryId).pipe(
				Effect.map(repository =>
					streamModuleTagPrefixes(
						repository?.inventory.packages ?? [],
						execution.configuration.streams[execution.stream],
					)
				),
			);
		});
	}
	private approvalProblems(execution: Execution): CoordinatorEffect<string[], DomainError> {
		return this.commitChecks(execution).pipe(Effect.map(({ pending, failed }) => [...failed, ...pending]));
	}
	private commitGates(subject: GateSubject): CoordinatorEffect<CommitGates, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const gateway = yield* this.gateway;
			const token = yield* gateway.token(subject.repository, subject.repositoryId);
			const base = `/repos/${subject.repository}`;
			const manifest: string[] = [];
			const repository = yield* (yield* this.store).repositories.get(subject.repositoryId);
			const references = subject.configuration.streams[subject.stream]?.packages;
			if (repository) {
				manifest.push(...manifestProblems(
					repository.inventory,
					repository.inventory.packages.filter(pkg =>
						!references || references.some(reference => matchesPackage(reference, pkg))
					),
				));
			}
			const [commit, checks, { workflow_runs: workflowRuns }, status] = yield* Effect.all([
				gateway.read(commitSchema, `${base}/commits/${subject.sourceSha}`, token),
				gateway.read(
					checkRunsSchema,
					`${base}/commits/${subject.sourceSha}/check-runs?per_page=100&filter=latest`,
					token,
				),
				gateway.read(
					workflowRunsSchema,
					`${base}/actions/runs?head_sha=${subject.sourceSha}&per_page=100`,
					token,
				),
				gateway.read(commitStatusSchema, `${base}/commits/${subject.sourceSha}/status`, token),
			], { concurrency: 'unbounded' });
			const verified = commit.commit.verification.verified === true;
			const outcomes: GateOutcome[] = [{
				gate: { kind: 'signature' },
				state: verified ? 'passed' : 'failed',
				fact: verified ? 'verified' : 'unverified',
			}];
			const runs = checks.check_runs;
			const releaseFiles = new Set(
				Object.values(subject.configuration.streams).flatMap(stream =>
					[stream.prepare.workflow, stream.promote.workflow, ...Object.values(stream.workflows)]
						.flatMap(binding => binding ? [`.github/workflows/${binding.file}`] : [])
				),
			);
			const paths = new Map(workflowRuns.map(run => [String(run.id), run.path]));
			const statuses = new Map(workflowRuns.map(run => [String(run.id), run]));
			const runOf = (run: (typeof runs)[number]) => /\/actions\/runs\/(\d+)\//.exec(String(run.details_url))?.[1];
			const pathOf = (run: (typeof runs)[number]) => paths.get(runOf(run) ?? '');
			const unfinished = runs.filter(run => run.status !== 'completed');
			const deploying = new Map<string, CheckJob[]>();
			for (const path of new Set(unfinished.flatMap(run => pathOf(run) ?? []))) {
				if (releaseFiles.has(path)) continue;
				const source = yield* gateway.file(subject.repository, path, subject.sourceSha, token);
				deploying.set(path, source === null ? [] : checkJobs(source));
			}
			const gating = runs.filter(run => {
				const path = pathOf(run);
				if (!path) return true;
				if (releaseFiles.has(path)) return false;
				return run.status === 'completed' || !deploys(String(run.name), deploying.get(path) ?? []);
			});
			for (const run of gating) {
				const conclusion = String(run.conclusion);
				const runId = runOf(run);
				const workflowRun = statuses.get(runId ?? '');
				const runDone = workflowRun === undefined || workflowRun.status === 'completed';
				const failed = run.status === 'completed' && !passingConclusions.includes(conclusion);
				const requested = subject.reruns?.find(rerun => rerun.id === Number(runId));
				const rerunning = failed && requested !== undefined
					&& (!runDone || (workflowRun?.run_attempt ?? requested.attempt) < requested.attempt);
				outcomes.push({
					...(runId ? { runId: Number(runId), runDone } : {}),
					...(workflowRun ? { runAttempt: workflowRun.run_attempt } : {}),
					gate: { kind: 'check', name: String(run.name) },
					state: run.status !== 'completed' || rerunning ? 'waiting' : failed ? 'failed' : 'passed',
					fact: rerunning ? 'rerunning' : run.status === 'completed' ? conclusion : 'running',
				});
			}
			if (Number(status.total_count) > 0) {
				outcomes.push({
					gate: { kind: 'status' },
					state: status.state === 'success' ? 'passed' : status.state === 'pending' ? 'waiting' : 'failed',
					fact: String(status.state),
				});
			}
			return { manifest, truncated: checks.total_count !== runs.length, runs: runs.length, outcomes };
		});
	}
	private ledgerView(execution: Execution, record: LedgerRecord): CoordinatorEffect<LedgerPackage, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const metadata = execution.started?.force === true
				|| (yield* this.gateSkips(execution)).some(skip => skip.gate.kind === 'metadata');
			return metadata ? { ...view(record), force: true } : view(record);
		});
	}
	private gateSkips(
		subject: Pick<Execution, 'repositoryId' | 'stream' | 'skippedGates'>,
	): CoordinatorEffect<GateSkip[], DomainError> {
		return Effect.flatMap(this.store, store => store.gateSkips.list(subject.repositoryId, subject.stream)).pipe(
			Effect.map(skips => [...skips, ...(subject.skippedGates ?? [])]),
		);
	}
	private commitChecks(
		execution: Execution,
	): CoordinatorEffect<{ pending: string[]; failed: string[]; skipped: string[] }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const [{ manifest, truncated, runs, outcomes }, skips] = yield* Effect.all([
				this.commitGates(execution),
				this.gateSkips(execution),
			], { concurrency: 'unbounded' });
			const skipOf = (gate: ReleaseGate) => skips.find(skip => sameGate(skip.gate, gate));
			const kept = outcomes.filter(outcome => !skipOf(outcome.gate));
			const failed = [...manifest], pending: string[] = [];
			if (kept.some(outcome => outcome.gate.kind === 'signature' && outcome.state === 'failed')) {
				failed.push(gateReasons.signature);
			}
			if (truncated) failed.push('over 100 check runs');
			if (!runs) pending.push('no checks yet');
			else if (!outcomes.some(outcome => outcome.gate.kind === 'check')) pending.push('no verification check yet');
			const checks = kept.flatMap(outcome =>
				outcome.gate.kind === 'check' ? [{ ...outcome, name: outcome.gate.name }] : []
			);
			const running = checks.filter(check => check.state === 'waiting').map(check => check.name);
			if (running.length) pending.push(`${running.join(', ')} running`);
			const failing = checks.flatMap(check =>
				check.state !== 'failed' ? [] : [check.fact === 'failure' ? check.name : `${check.name} (${check.fact})`]
			);
			if (failing.length) failed.push(`${gateReasons.checks}${failing.join(', ')}`);
			const status = kept.find(outcome => outcome.gate.kind === 'status');
			if (status && status.state !== 'passed') {
				(status.state === 'waiting' ? pending : failed).push(`${gateReasons.status}${status.fact}`);
			}
			const skipped = mergedOutcomes(outcomes).flatMap(outcome => {
				const skip = skipOf(outcome.gate);
				return skip && outcome.state !== 'passed' ? [skippedNote(outcome.gate, outcome.fact, skip)] : [];
			});
			const metadata = skipOf({ kind: 'metadata' });
			if (metadata) {
				const incomplete = yield* this.metadataProblemsOf(execution);
				if (incomplete.length) skipped.push(skippedNote({ kind: 'metadata' }, 'incomplete', metadata));
			}
			return { pending, failed, skipped };
		});
	}
	private refHead(
		execution: Execution,
		token: string,
		observedRef?: string,
	): CoordinatorEffect<{ ref: string; sha: string; tag: boolean } | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const configured = execution.workflow?.ref;
			if (configured === undefined) return undefined;
			const namespace = /^refs\/(heads|tags)\//.exec(configured)?.[1] ?? execution.refNamespace;
			const pattern = configured.replace(/^refs\/(heads|tags)\//, '');
			const patterned = /[*?[]/.test(pattern);
			const ref = patterned ? observedRef : pattern;
			if (!ref) return undefined;
			if (patterned || namespace !== undefined) {
				for (const candidate of namespace === undefined ? ['tags', 'heads'] : [namespace]) {
					const found = yield* (yield* this.gateway).read(
						Schema.NullOr(gitRefSchema),
						`/repos/${execution.repository}/git/ref/${candidate}/${encodeURIComponent(ref)}`,
						token,
					);
					if (found === null) continue;
					const target = yield* (yield* this.gateway).peelTag(execution.repository, found.object, token);
					return { ref, sha: target.sha, tag: candidate === 'tags' };
				}
				return yield* precondition(`Workflow ref ${ref} no longer exists`);
			}
			const commit = yield* (yield* this.gateway).read(
				Schema.NullOr(commitSchema),
				`/repos/${execution.repository}/commits/${encodeURIComponent(ref)}`,
				token,
			);
			if (commit === null) return yield* precondition(`Workflow ref ${ref} no longer exists`);
			return { ref, sha: commit.sha, tag: false };
		});
	}
	private contains(execution: Execution, sha: string, token: string): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (sha === execution.sourceSha) return true;
			if (!execution.eventId.startsWith('observed:') && !execution.currentWorkflow) {
				const executions = yield* allExecutions;
				let promotion = execution.operation === 'promote'
					? execution
					: executions.find(other => other.operation === 'promote' && other.dependencies.includes(execution.id));
				const pending = [...execution.dependencies];
				const visited = new Set<string>();
				while (!promotion && pending.length) {
					const id = pending.pop();
					if (id === undefined || visited.has(id)) continue;
					visited.add(id);
					const dependency = executions.find(other => other.id === id);
					if (
						dependency?.state !== 'succeeded' || dependency.sourceSha !== execution.sourceSha
						|| dependency.configurationSha !== execution.configurationSha || dependency.stream !== execution.stream
						|| dependency.version !== execution.version
					) continue;
					if (dependency.operation === 'promote') promotion = dependency;
					else pending.push(...dependency.dependencies);
				}
				return promotion !== undefined && (yield* this.versionKept(promotion, sha));
			}
			const comparison = yield* (yield* this.gateway).read(
				comparisonSchema,
				`/repos/${execution.repository}/compare/${execution.sourceSha}...${sha}`,
				token,
			);
			return comparison.status === 'ahead';
		});
	}
	private versionKept(execution: Execution, sha: string): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const stream = execution.configuration.streams[execution.stream];
			const record = yield* (yield* this.store).repositories.get(execution.repositoryId);
			if (!stream || !record) return false;
			if (JSON.stringify(record.configuration?.streams[execution.stream]) !== JSON.stringify(stream)) return false;
			const gateway = yield* this.gateway;
			const paths = releasePaths(record.inventory.packages, stream);
			const kept = (commit: string) =>
				unchangedSince(gateway, execution.repository, execution.repositoryId, commit, sha, paths);
			const newer = (yield* allExecutions).filter(other =>
				other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
				&& other.version === execution.version && other.createdAt > execution.createdAt
				&& other.state !== 'cancelled' && other.state !== 'failed'
			);
			for (const other of newer) if (yield* kept(other.sourceSha)) return false;
			return yield* kept(execution.sourceSha);
		});
	}
	private headMoved(
		execution: Execution,
		token: string,
		observedRef?: string,
	): CoordinatorEffect<string | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const head = yield* this.refHead(execution, token, observedRef);
			if (!head) return undefined;
			if (head.tag) {
				if (head.sha === execution.sourceSha) return undefined;
				return `Tag ${head.ref} moved to ${head.sha.slice(0, 12)}; this release builds ${
					execution.sourceSha.slice(0, 12)
				}`;
			}
			if (yield* this.contains(execution, head.sha, token)) return undefined;
			if (!execution.eventId.startsWith('observed:')) return moved(execution, head);
			return `${head.ref} at ${head.sha.slice(0, 12)} no longer contains ${execution.sourceSha.slice(0, 12)}`;
		});
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
			const moved = yield* this.headMoved(
				execution,
				token,
				typeof run?.head_branch === 'string' ? run.head_branch : undefined,
			);
			if (
				moved
				&& !(run !== null && run.head_sha === execution.sourceSha && (yield* this.versionTagged(execution)))
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
			const ledger = yield* (yield* DurableStorage).get(Keys.ledger, execution.id);
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
			if (!(yield* this.versionTagged(execution))) {
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
					const published = yield* this.publishedRelease(execution);
					if (published !== execution) yield* putExecution(published);
					yield* this.wakeUp();
				}
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
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			yield* this.wakeReleaseWorkflows();
			yield* (yield* AlarmPlanner).requestReconcile(clock.currentTimeMillisUnsafe());
			yield* (yield* AlarmPlanner).arm(clock.currentTimeMillisUnsafe());
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
			Effect.gen({ self: this }, function*() {
				yield* (yield* DurableStorage).put(Keys.observe, String(runId), { repositoryId, runId });
				yield* this.wakeUp();
			}),
			'coordinator.observeRun',
			{ repositoryId },
		);
	}
	trackRun(repositoryId: number, runId: number): Promise<void> {
		return this.serial(
			Effect.gen({ self: this }, function*() {
				const storage = yield* DurableStorage;
				if (!(yield* storage.has(Keys.track, String(runId)))) {
					yield* storage.put(Keys.track, String(runId), { repositoryId, runId });
				}
				yield* this.wakeUp();
			}),
			'coordinator.trackRun',
			{ repositoryId },
		);
	}
	private observedRun(
		event: Observation,
	): CoordinatorEffect<{ repository: ReadyRepository; run: WorkflowRun; token: string } | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const stored = yield* (yield* this.store).repositories.get(event.repositoryId);
			const state = stored && readiness(stored);
			if (state?.kind !== 'ready') return undefined;
			const repository = state.repository;
			const token = yield* (yield* this.gateway).token(repository.name, repository.id);
			const run = yield* (yield* this.gateway).read(
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
				return undefined;
			}
			return { repository, run, token };
		});
	}
	private observe(event: Observation): CoordinatorEffect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const observed = yield* this.observedRun(event);
			if (!observed) return;
			const executions = yield* this.observeRunOf(observed.repository, observed.run, observed.token, true);
			yield* this.openGates(observed.repository, observed.run, observed.token, Effect.succeed(executions));
		});
	}
	private track(event: Observation): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const observed = yield* this.observedRun(event);
			if (!observed || observed.run.status === 'completed') return true;
			const { repository, run, token } = observed;
			return !(yield* this.openGates(repository, run, token, this.observeRunOf(repository, run, token, false)));
		});
	}
	private runJobs(
		repository: string,
		run: Pick<WorkflowRun, 'id' | 'run_attempt'>,
		token: string,
	): CoordinatorEffect<RunJob[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const jobs: RunJob[] = [];
			for (let page = 1;; page++) {
				const listed = yield* (yield* this.gateway).read(
					workflowJobsSchema,
					`/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
					token,
				);
				jobs.push(...listed.jobs);
				if (!listed.jobs.length || jobs.length >= listed.total_count) return jobs;
			}
		});
	}
	private openGates(
		repository: ReadyRepository,
		run: WorkflowRun,
		token: string,
		parents: CoordinatorEffect<Execution[], DomainError>,
	): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			let waiting = false;
			let workflow: WorkflowJobs | null | undefined;
			let jobs: RunJob[] | undefined;
			const ready: { stream: string; operation: string; needed: string }[] = [];
			for (const [streamName, stream] of Object.entries(repository.configuration.streams)) {
				for (const [operation, binding] of Object.entries(stream.workflows)) {
					for (const [needed, required] of Object.entries(binding.needsJobs ?? {})) {
						if (run.path !== `.github/workflows/${stream.workflows[needed]?.file}`) continue;
						const id = yield* executionId(repository.id, streamName, operation, `observed:${run.id}`);
						if (yield* storedExecution(id)) continue;
						if (workflow === undefined) {
							const source = yield* (yield* this.gateway).file(repository.name, run.path, run.head_sha, token);
							workflow = (source === null ? undefined : workflowJobs(source)) ?? null;
						}
						if (!workflow || !resolvable(workflow, required)) continue;
						jobs ??= yield* this.runJobs(repository.name, run, token);
						const gate = gateState(workflow, required, jobs);
						if (gate === 'waiting') waiting = true;
						if (gate === 'ready') ready.push({ stream: streamName, operation, needed });
					}
				}
			}
			if (!ready.length) return waiting;
			const observed = yield* parents;
			for (const gate of ready) {
				const parent = observed.find(execution =>
					execution.stream === gate.stream && execution.operation === gate.needed && execution.state === 'running'
				);
				if (!parent) continue;
				const next = yield* deriveExecution(parent, repository, {
					stream: gate.stream,
					operation: gate.operation,
					eventId: parent.eventId,
					sourceSha: parent.sourceSha,
					...(parent.version ? { version: parent.version } : {}),
				});
				yield* putExecution({ ...next, dependencies: next.dependencies.filter(id => id !== parent.id) });
			}
			return waiting;
		});
	}
	private observeRunOf(
		repository: ReadyRepository,
		run: WorkflowRun,
		token: string,
		record: boolean,
	): CoordinatorEffect<Execution[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const gateway = yield* this.gateway;
			const observedExecutions: Execution[] = [];
			const settle = (execution: Execution) =>
				Effect.gen({ self: this }, function*() {
					if (record) yield* putExecution(execution);
					observedExecutions.push(execution);
				});
			if (typeof run.head_branch !== 'string') return observedExecutions;
			const branch = run.head_branch;
			const patterns = Object.values(repository.configuration.streams).flatMap(stream =>
				Object.values(stream.workflows).flatMap(binding =>
					run.path === `.github/workflows/${binding.file}` ? [binding.ref ?? repository.defaultBranch] : []
				)
			);
			const tagTarget = (name: string) =>
				Effect.gen(function*() {
					const tag = yield* gateway.read(
						Schema.NullOr(gitRefSchema),
						`/repos/${repository.name}/git/ref/tags/${encodeURIComponent(name)}`,
						token,
					);
					if (!tag) return undefined;
					return yield* gateway.peelTag(repository.name, tag.object, token);
				});
			const tagLike = patterns.some(pattern => matchesRef(pattern, `refs/tags/${branch}`))
				|| /^v?\d+\.\d+\.\d+/.test(branch);
			const branchLike = patterns.some(pattern =>
				!pattern.startsWith('refs/tags/') && matchesRef(pattern, `refs/heads/${branch}`)
			);
			const tagged = run.event === 'release'
				|| (tagLike && (!branchLike || (yield* tagTarget(branch))?.sha === run.head_sha));
			const ref = tagged ? `refs/tags/${branch}` : `refs/heads/${branch}`;
			for (const [streamName, stream] of Object.entries(repository.configuration.streams)) {
				for (const [operation, binding] of Object.entries(stream.workflows)) {
					const pattern = binding.ref ?? repository.defaultBranch;
					if (
						binding.mode !== 'observe'
						|| run.path !== `.github/workflows/${binding.file}`
						|| !matchesRef(pattern, ref)
					) {
						continue;
					}
					const tagName = pattern.startsWith('refs/tags/')
						? pattern.slice('refs/tags/'.length)
						: pattern.startsWith('refs/')
						? undefined
						: pattern;
					const prefix = [
						stream.versionSource?.prefix,
						tagName === undefined
							? undefined
							: tagName.endsWith('*')
							? /^[^*?[]*/.exec(tagName)?.[0]?.replace(/(?<![\d.])\d[\d.]*$/, '')
							: /^(.*?)v?\d+\.\d+/.exec(tagName)?.[1],
					].filter((value): value is string => value !== undefined && branch.startsWith(value))
						.sort((a, b) => b.length - a.length)[0] ?? '';
					const version = tagged
						? branch.slice(prefix.length).replace(/^v/, '')
						: undefined;
					const manifestVersions = !tagged
						&& (run.event === 'workflow_dispatch' || (binding.publications?.length ?? 0) > 0);
					const eventId = `observed:${run.id}`;
					const id = yield* executionId(repository.id, streamName, operation, eventId);
					if (yield* (yield* DurableStorage).has(Keys.execution, id)) {
						const previous = yield* getExecution(id);
						if (previous.state === 'succeeded' || (previous.runAttempt ?? 0) >= run.run_attempt) continue;
					}
					const snapshot = yield* repositorySnapshot(gateway, repository.name, repository.id, run.head_sha);
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
					execution.runId = run.id;
					execution.runAttempt = run.run_attempt;
					execution.refNamespace = tagged ? 'tags' : 'heads';
					execution.state = 'running';
					execution.dependencies = (yield* allExecutions).filter(other =>
						other.stream === streamName && other.operation === 'promote' && other.state === 'succeeded'
						&& version !== undefined && other.version === version && other.sourceSha === snapshot.sha
					).map(other => other.id);
					if (version) {
						const target = yield* tagTarget(branch);
						if (!target) {
							yield* settle({ ...execution, state: 'failed', reason: `Release tag ${branch} was not found` });
							continue;
						}
						if (target.type !== 'commit' || target.sha !== snapshot.sha) {
							yield* settle({
								...execution,
								state: 'failed',
								reason: `Release tag ${branch} does not point at the source commit`,
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
					const observed = publishablePackages(inventory.packages, stream.packages).filter(
						(p) =>
							(Boolean(version) || (manifestVersions && tagPrefix(p.versionSource) === undefined))
							&& (binding.publications === undefined
								|| binding.publications.some(reference => matchesPackage(reference, p))),
					);
					const mismatched = version !== undefined && stream.versioning === 'workspace'
						? observed.filter(p =>
							tagPrefix(p.versionSource) === undefined && p.version !== undefined && !placeholderVersion(p.version)
							&& p.version !== version
						)
						: [];
					if (mismatched.length) {
						yield* settle({
							...execution,
							state: 'failed',
							reason: `Tag ${branch} names version ${version}, but ${
								mismatched.map(p => `${p.name} carries ${p.version}`).join(', ')
							}`,
						});
						continue;
					}
					if (!record) {
						yield* settle(execution);
						continue;
					}
					for (const pkg of observed) {
						if (!canVerifyPublication(pkg.manager)) continue;
						const released = version === undefined ? pkg.version : observedVersion(pkg, branch, version);
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
						const context = (yield* this.gateway).verification(repository.name, repository.id);
						const transport = (yield* Automation).dependencies.transport;
						execution.publications.push(
							verifiedPublication(publication, yield* verifyPublication(publication, transport, context)),
						);
					}
					const releaseId = `github-release:${repository.name}`;
					if (tagged && binding.publications?.some(id => selectorKey(id) === selectorKey(releaseId))) {
						const release = yield* gateway.read(
							Schema.NullOr(releaseSchema),
							`/repos/${repository.name}/releases/tags/${encodeURIComponent(branch)}`,
							token,
						);
						execution.publications.push({
							id: releaseId,
							manager: 'github-release',
							name: repository.name,
							version: branch,
							outcome: release && release.draft === false && release.assets.length ? 'succeeded' : 'failed',
							required: true,
							...(typeof release?.html_url === 'string' ? { url: release.html_url } : {}),
						});
					}
					yield* settle(execution);
				}
			}
			return observedExecutions;
		});
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
						yield* this.deliverReleaseEvents(now);
						yield* (yield* ObserveQueue).drain(now, event => Effect.as(this.observe(event), undefined));
						yield* (yield* TrackQueue).drain(
							now,
							event => this.track(event).pipe(Effect.map(done => done ? undefined : trackLater(event, now))),
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
				const gateway = yield* this.gateway;
				const snapshot = yield* repositorySnapshot(
					gateway,
					execution.repository,
					execution.repositoryId,
					execution.sourceSha,
					operation.plan.edits.map(edit => edit.path),
				);
				execution.state = 'running';
				execution.attempts++;
				yield* putExecution(execution);
				const checkpoint = (head: string) => {
					operation.head = head;
					return putExecution(execution);
				};
				const result = committed(execution)
					? yield* commitVersion(
						gateway,
						snapshot,
						versionMessage(execution),
						operation.plan.edits,
						operation.head,
						checkpoint,
					)
					: operation.head
					? yield* resumePreparation(
						gateway,
						snapshot,
						operation.branch,
						operation.title,
						operation.body,
						operation.head,
					)
					: yield* pullRequest(gateway, {
						snapshot,
						branch: operation.branch,
						title: operation.title,
						body: operation.body,
						edits: operation.plan.edits,
						checkpoint,
						coAuthored: execution.initiatedBy !== undefined,
					});
				operation.result = yield* this.autoMerged(execution, result);
				execution.state = 'succeeded';
				delete execution.reason;
				yield* putExecution(execution);
			}).pipe(
				recover(error =>
					putExecution({
						...execution,
						state: committed(execution) && error.problem.code === 'precondition' ? 'failed' : 'uncertain',
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
					run.status === 'completed' ? yield* this.runJobs(execution.repository, run, token) : [],
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
						const until = Math.max(clock.currentTimeMillisUnsafe(), ...limited);
						if (execution.package?.manager === 'cargo') {
							yield* fromPromise(() => this.env.PUBLISH_BUDGET.getByName('crates-io').defer(until));
						}
						yield* putExecution({
							...execution,
							state: 'ready',
							supersededRuns: [...(execution.supersededRuns ?? []), runId],
							runId: undefined,
							runAttempt: undefined,
							github: undefined,
							workflowSha: undefined,
							notBefore: until,
							reason: `Registry rate limit until ${new Date(until).toISOString()}`,
							publications: execution.publications.map(publication =>
								publication.outcome === 'rate-limited' ? { ...publication, outcome: 'pending' } : publication
							),
						});
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
					yield* putExecution(yield* this.publishedRelease(ended).pipe(Effect.orElseSucceed(() => ended)));
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
			const reason = yield* this.headMoved(execution, token);
			if (reason) {
				yield* putExecution({ ...execution, state: 'failed', reason });
				return;
			}
			execution.resolvedInputs = yield* resolveInputs(execution, executions);
			const draftRelease = yield* this.draftRelease(execution);
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
		history: CoordinatorEffect<ReleaseHistory, DomainError>,
	): CoordinatorEffect<boolean, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (
				!['succeeded', 'failed', 'cancelled', 'pending'].includes(execution.state) || unresolved(execution)
				|| publishedAfterFailure(execution)
			) return true;
			const ledger = yield* (yield* DurableStorage).get(Keys.ledger, execution.id);
			if (ledger?.records.some(record => record.status.state === 'uploaded' || missingReceipt(execution, record))) {
				return true;
			}
			return execution.state === 'succeeded'
				&& ((yield* pendingContinuations(execution)).length > 0
					|| (yield* this.releaseGroup(execution, history)) !== undefined);
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
			const clock = yield* Clock.Clock;

			const ledger = yield* (yield* DurableStorage).get(Keys.ledger, execution.id);
			if (ledger?.records.some(record => record.status.state === 'uploaded' || missingReceipt(execution, record))) {
				yield* this.acceptedUploads(ledger);
				return 'continue' as const;
			}

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
				else yield* this.captureReleaseEvent(execution);
			}
			if (!active.includes(execution) || execution.state === 'pending') return 'continue' as const;
			if (execution.state === 'awaiting-approval') {
				const incomplete = execution.started?.force ? [] : yield* this.metadataBlocks(execution);
				const blocked = incomplete.length ? `${metadataReason}${incomplete.join('; ')}` : undefined;
				let current = execution;
				if (blocked !== execution.reason && (blocked || execution.reason?.startsWith(metadataReason))) {
					current = { ...execution, ...(blocked ? { reason: blocked } : {}) };
					if (!blocked) delete current.reason;
					yield* putExecution(current);
				}
				if (blocked && current.approvedBy === 'start') {
					yield* putExecution({ ...current, state: 'failed', reason: blocked });
					return 'continue' as const;
				}
				if (blocked) return 'continue' as const;
				if (
					current.configuration.streams[current.stream]?.promote.approval !== 'push'
					&& current.approvedBy === undefined
				) return 'continue' as const;
				return yield* this.approveFromPush(current, executions).pipe(
					Effect.flatMap(approved =>
						approved
							? AlarmPlanner.use(planner => planner.requestReconcile(clock.currentTimeMillisUnsafe())).pipe(
								Effect.as('stop' as const),
							)
							: Effect.succeed('continue' as const)
					),
					recover(error =>
						Effect.gen({ self: this }, function*() {
							const reason = `commit check error: ${decodeError(error)}`;
							if (current.reason !== reason) yield* putExecution({ ...current, reason });
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
			const history = Effect.succeed(releaseHistory);
			for (const execution of executions) {
				if (onlyExecution ? execution.id !== onlyExecution : Boolean(execution.releaseSet?.workflowId)) continue;
				const work = yield* Effect.result(this.hasAdvanceWork(execution, unresolved, history));
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
