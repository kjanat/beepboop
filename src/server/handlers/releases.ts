import { Effect } from 'effect';
import { createExecution } from '@/automation/execution';
import { planReleaseSet } from '@/automation/planning';
import { pullRequest } from '@/automation/preparation-pull-requests';
import { capabilitySentence, releasable, releaseCapability, startRefusal } from '@/automation/release-capability';
import type { AutomationService } from '@/automation/service';
import { repositorySnapshot } from '@/automation/snapshot';
import type { Execution, ReleasePlan, ReleaseStarted, Stream } from '@/automation/types';
import { routes } from '@/contract/routes';
import { planHookUpdates } from '@/discovery/managers/precommit.ts';
import type { Inventory, Snapshot } from '@/domain/inventory.ts';
import { matchesPackage, publishablePackages } from '@/domain/package-identity.ts';
import { conflictMessage } from '@/domain/refs.ts';
import type { StartChannel } from '@/domain/release-start.ts';
import type { ReadyRepository } from '@/domain/repository';
import { semver } from '@/domain/semver.ts';
import type { VersionPrMerge } from '@/domain/setup-terms.ts';
import { nextVersion, parseVersionRequest } from '@/domain/version-request.ts';
import { latestTag, tagPrefix, versionsInFiles } from '@/domain/version-tags.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { conflict, notFound, precondition } from '@/kernel/errors/domain-error.ts';
import { planIdentity } from '@/persistence/identity-keys';
import { createReleasePreparation } from '@/release/domain/managed.ts';
import { planVersionFiles } from '@/release/domain/planning/editors.ts';
import { planRelease, selectedReleasePackages } from '@/release/domain/planning/managers.ts';
import { resolvePackageVersion } from '@/release/domain/version.ts';
import type { AdminContext } from '@/server/handlers/kit';
import { admin, readyRepository } from '@/server/handlers/kit';

export interface Selected {
	repository: ReadyRepository;
	stream: Stream;
}

export interface PlannedRelease {
	selection: Selected;
	selected: string[] | undefined;
	plan: ReleasePlan;
	planId: string;
}

function ready(service: AutomationService, repositoryId: number): Effect.Effect<ReadyRepository, DomainError> {
	return readyRepository(service, repositoryId, 'Repository not configured');
}

function reviewed<P extends object>({ plan, planId }: { plan: P; planId: string }): P & { planId: string } {
	return { ...plan, planId };
}

function configured(
	service: AutomationService,
	repositoryId: number,
	name: string,
): Effect.Effect<Selected, DomainError> {
	return Effect.gen(function*() {
		const repository = yield* ready(service, repositoryId);
		const stream = repository.configuration.streams[name];
		if (!stream) return yield* notFound('stream', 'Unknown stream', name);
		const capability = releaseCapability(stream, repository.inventory);
		if (!releasable(capability)) return yield* precondition(capabilitySentence(name, capability));
		return { repository, stream };
	});
}

function current(
	service: AutomationService,
	{ repository, stream }: Selected,
	message: string,
): Effect.Effect<Snapshot, DomainError> {
	return Effect.gen(function*() {
		const snapshot = yield* repositorySnapshot(
			service.gateway,
			repository.name,
			repository.id,
			undefined,
			(stream.versionFiles ?? []).map(rule => rule.path),
		);
		if (snapshot.sha !== repository.sha) return yield* conflict('stale-revision', message);
		return snapshot;
	});
}

interface ReleaseInput {
	repositoryId: number;
	stream: string;
	version?: unknown;
	packages?: string[] | undefined;
}

function latestTagVersion(service: AutomationService, repository: ReadyRepository, prefix: string) {
	return service.gateway.tagRefs(repository.name, repository.id).pipe(
		Effect.map(refs => latestTag(refs.map(ref => ref.name), prefix)),
	);
}

export function delegatedPlan(
	snapshot: Snapshot,
	inventory: Inventory,
	stream: Stream,
	target: unknown,
	selected: string[] | undefined,
): Effect.Effect<ReleasePlan, DomainError> {
	return Effect.gen(function*() {
		const version = (yield* Effect.fromResult(semver(target))).replace(/^v/, '');
		const packages = publishablePackages(inventory.packages, selected);
		const carried = packages.length > 0
			&& packages.every(pkg => tagPrefix(pkg.versionSource) === undefined && pkg.version === version);
		if (carried) {
			yield* resolvePackageVersion(yield* selectedReleasePackages(inventory, selected), { version });
			const prepared = yield* planRelease(snapshot, inventory, version, selected, undefined, stream.versionFiles).pipe(
				Effect.orElseSucceed(() => undefined),
			);
			if (prepared && !prepared.edits.length && !prepared.requiresPreparation) return prepared;
		}
		return {
			version,
			sourceSha: snapshot.sha,
			packages,
			edits: [],
			diagnostics: stream.prepare.workflow ? ['Preparation is delegated to the configured repository workflow'] : [],
			requiresPreparation: stream.prepare.workflow !== undefined,
		};
	});
}

function carriedPlan(
	service: AutomationService,
	{ repository, stream }: Selected,
	name: string,
	head: ReleasePlan,
	selected: string[] | undefined,
	planAt: (at: Snapshot) => Effect.Effect<ReleasePlan, DomainError>,
): Effect.Effect<ReleasePlan, DomainError> {
	return Effect.gen(function*() {
		const packages = publishablePackages(repository.inventory.packages, selected);
		const { snapshot } = yield* service.releaseSource(repository, name, stream, head.version, packages);
		if (snapshot.sha === head.sourceSha) return head;
		const held = yield* planAt(snapshot);
		return held.edits.length || held.requiresPreparation ? head : held;
	});
}

export function releasePlan(
	input: ReleaseInput,
	{ service }: Pick<AdminContext, 'service'>,
): Effect.Effect<PlannedRelease, DomainError> {
	return Effect.gen(function*() {
		const selection = yield* configured(service, input.repositoryId, input.stream);
		const { repository, stream } = selection;
		const snapshot = yield* current(service, selection, 'Refresh discovery before preparing this revision');
		if (stream.versioning === 'independent' && !stream.packages && input.packages === undefined) {
			return yield* precondition('Select packages for an independent release');
		}
		const selected = input.packages ?? stream.packages;
		if (
			stream.packages
			&& selected?.some(name =>
				!repository.inventory.packages.some(pkg =>
					matchesPackage(name, pkg) && stream.packages?.some(reference => matchesPackage(reference, pkg))
				)
			)
		) {
			return yield* precondition('Package is outside this release stream');
		}
		let target: unknown = input.version;
		if (stream.versionSource?.kind === 'tags') {
			const latest = yield* latestTagVersion(service, repository, stream.versionSource.prefix);
			const request = yield* parseVersionRequest(input.version);
			if (!latest && !('version' in request)) {
				return yield* precondition('Select an explicit version for the first release');
			}
			target = latest
				? yield* nextVersion(latest, request)
				: ('version' in request ? request.version : undefined);
			if (typeof target === 'string' && publishablePackages(repository.inventory.packages, selected).length) {
				yield* resolvePackageVersion(yield* selectedReleasePackages(repository.inventory, selected), {
					version: target,
				});
			}
		} else if (stream.prepare.strategy === 'workflow') {
			const request = yield* parseVersionRequest(input.version);
			target = 'version' in request && !publishablePackages(repository.inventory.packages, selected).length
				? request.version
				: yield* resolvePackageVersion(yield* selectedReleasePackages(repository.inventory, selected), request);
		}
		const planAt = (at: Snapshot): Effect.Effect<ReleasePlan, DomainError> =>
			stream.prepare.strategy !== 'workflow' && versionsInFiles(repository.inventory)
				? planRelease(at, repository.inventory, target, selected, undefined, stream.versionFiles)
				: stream.prepare.strategy !== 'workflow' && stream.versionFiles?.length
				? planVersionFiles(at, target, stream.versionFiles)
				: delegatedPlan(at, repository.inventory, stream, target, selected);
		const head = yield* planAt(snapshot);
		const plan = stream.versionSource?.kind === 'tags' || head.edits.length || head.requiresPreparation
			? head
			: yield* carriedPlan(service, selection, input.stream, head, selected, planAt);
		const planId = yield* planIdentity(plan, repository);
		return { selection, selected, plan, planId };
	});
}

function setPlan(input: { repositoryId: number; stream: string; plan: unknown }, { service }: AdminContext) {
	return Effect.gen(function*() {
		const { repository, stream } = yield* configured(service, input.repositoryId, input.stream);
		if (stream.versioning !== 'independent') return yield* precondition('Select an independent release stream');
		const snapshot = yield* current(service, { repository, stream }, 'Refresh discovery before planning this revision');
		const plan = yield* planReleaseSet(
			snapshot,
			repository.inventory,
			input.plan,
			stream.packages,
			stream.versionFiles,
		);
		const planId = yield* planIdentity(plan, repository);
		return { repository, plan, planId };
	});
}

function opensVersionPr(stream: Stream, plan: ReleasePlan): boolean {
	return (plan.edits.length > 0 || plan.requiresPreparation === true)
		&& stream.prepare.bump !== 'commit'
		&& !(stream.prepare.workflow && stream.prepare.strategy === 'workflow');
}

export function beginRelease(
	service: AutomationService,
	{ selection, selected, plan, planId }: PlannedRelease,
	name: string,
	actor: string,
	started?: ReleaseStarted,
	versionPrMerge?: VersionPrMerge,
): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const { repository, stream } = selection;
		const refusal = started && startRefusal(name, stream, plan, repository.inventory, selected);
		if (refusal) return yield* precondition(refusal);
		if (versionPrMerge && !opensVersionPr(stream, plan)) {
			return yield* precondition(`${plan.version} of ${name} opens no version PR to merge`);
		}
		if (!plan.edits.length && !plan.requiresPreparation) {
			const claim = yield* service.tagClaims(repository, name, stream, plan.version, plan.sourceSha);
			if (claim.conflict) return yield* precondition(`${conflictMessage(claim.conflict)}. Release a new version.`);
			const promotion = yield* createExecution(repository, {
				stream: name,
				operation: 'promote',
				eventId: `release:${plan.version}:${plan.sourceSha}`,
				sourceSha: plan.sourceSha,
				version: plan.version,
			});
			promotion.initiatedBy = actor;
			if (claim.reclaims.length) promotion.reclaims = claim.reclaims;
			if (started) {
				promotion.approvedBy = 'start';
				promotion.started = started;
			}
			const queued = yield* service.enqueue(repository, promotion);
			yield* service.store.audit(actor, 'release.prepare', queued.id);
			return queued;
		}
		const execution = yield* (
			stream.prepare.workflow && stream.prepare.strategy === 'workflow'
				? createExecution(repository, {
					stream: name,
					operation: 'prepare',
					eventId: `plan:${planId}`,
					sourceSha: repository.sha,
					version: plan.version,
				})
				: createReleasePreparation(repository, name, plan, started)
		);
		execution.initiatedBy = actor;
		if (started) execution.started = started;
		if (versionPrMerge) execution.versionPrMerge = versionPrMerge;
		const queued = yield* service.enqueue(repository, execution);
		yield* service.store.audit(actor, started ? 'release.start' : 'release.prepare', queued.id);
		return queued;
	});
}

function channel(request: Request): StartChannel {
	return request.headers.has('authorization') ? 'cli' : 'dashboard';
}

export const releaseEndpoints = {
	releasesPlan: admin(
		routes.releasesPlan,
		(input, context) =>
			releasePlan(input, context).pipe(
				Effect.map(({ selection, selected, plan, planId }) => ({
					...reviewed({ plan, planId }),
					starts: startRefusal(input.stream, selection.stream, plan, selection.repository.inventory, selected)
						=== undefined,
				})),
			),
	),
	releasesPrepare: admin(routes.releasesPrepare, (input, context) =>
		Effect.gen(function*() {
			const planned = yield* releasePlan(input, context);
			const { selection, selected, plan, planId } = planned;
			const { service, actor, request } = context;
			if (input.sourceSha !== plan.sourceSha || input.planId !== planId) {
				return yield* conflict('stale-plan', 'Release plan changed; preview it again');
			}
			const refusal = startRefusal(input.stream, selection.stream, plan, selection.repository.inventory, selected);
			const asked = input.force === true || input.start === true;
			if (refusal && asked) return yield* precondition(refusal);
			const started: ReleaseStarted | undefined = refusal || (input.start === false && !input.force)
				? undefined
				: { via: channel(request), actor, ...(input.force ? { force: true } : {}) };
			return yield* beginRelease(service, planned, input.stream, actor, started, input.versionPrMerge);
		})),
	releasesPlanSet: admin(
		routes.releasesPlanSet,
		(input, context) => setPlan(input, context).pipe(Effect.map(set => ({ ...reviewed(set), starts: false }))),
	),
	releasesPrepareSet: admin(routes.releasesPrepareSet, (input, context) =>
		Effect.gen(function*() {
			const { repository, plan, planId } = yield* setPlan(input, context);
			if (input.sourceSha !== plan.sourceSha) {
				return yield* conflict('stale-revision', 'Preview source revision changed');
			}
			if (input.planId !== planId) return yield* conflict('stale-plan', 'Release plan changed; preview it again');
			const execution = yield* createReleasePreparation(repository, input.stream, plan);
			execution.initiatedBy = context.actor;
			yield* context.service.store.audit(context.actor, 'release.prepare-set', execution.id);
			return yield* context.service.enqueue(repository, execution);
		})),
	releasesStartSet: admin(routes.releasesStartSet, (input, { service, actor }) =>
		Effect.gen(function*() {
			const preparation = yield* service.store.execution(input.preparationId);
			if (!preparation) return yield* notFound('execution', 'Unknown preparation', input.preparationId);
			const executions = yield* fromPromise(() =>
				service.coordinator(preparation.repositoryId).startReleaseSet(preparation.id, input.sourceSha)
			);
			yield* service.store.audit(actor, 'release.start-set', preparation.id);
			return executions;
		})),
	hooksUpdate: admin(routes.hooksUpdate, (input, { service, actor }) =>
		Effect.gen(function*() {
			const repository = yield* ready(service, input.repositoryId);
			if (!repository.configuration.managers.includes('pre-commit')) {
				return yield* precondition('Hook manager is not enabled');
			}
			const event = yield* service.releaseEvents().event(input.releaseEventId);
			if (event?.event !== 'release' || !event.release) {
				return yield* notFound('release-event', 'Verified upstream release event required', input.releaseEventId);
			}
			const release = event.release;
			const snapshot = yield* repositorySnapshot(service.gateway, repository.name, repository.id);
			const edits = yield* planHookUpdates(snapshot, release);
			if (input.preview !== false || !edits.length) {
				return { sourceSha: snapshot.sha, upstreamRelease: release, edits };
			}
			const result = yield* pullRequest(service.gateway, {
				snapshot,
				branch: `release/hooks/${release.repository.id}/${release.commit}`,
				title: `chore: update hooks to ${release.version}`,
				body: `Upstream: ${event.source}\nCommit: ${release.commit}`,
				edits,
				coAuthored: true,
			});
			yield* service.store.audit(actor, 'hooks.prepare', result.url);
			return result;
		})),
} as const;
