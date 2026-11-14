import { Effect } from 'effect';
import { planVersionFiles } from '@/automation/editors';
import { createExecution } from '@/automation/execution';
import { createReleasePreparation } from '@/automation/managed';
import { planRelease, selectedReleasePackages, versionsInFiles } from '@/automation/managers';
import { latestTag } from '@/automation/managers/tags';
import { matchesPackage } from '@/automation/package-identity';
import { planReleaseSet } from '@/automation/planning';
import { planHookUpdates } from '@/automation/precommit';
import { capabilitySentence, releasable, releaseCapability } from '@/automation/release-capability';
import { resolvePackageVersion } from '@/automation/release-version';
import type { AutomationService } from '@/automation/service';
import type { Execution, ReleasePlan, ReleaseStarted, Snapshot, Stream } from '@/automation/types';
import { nextVersion, parseVersionRequest } from '@/automation/version';
import type { DomainError } from '@/contract/errors';
import { conflict, notFound, precondition } from '@/contract/errors';
import type { StartChannel } from '@/contract/release-start';
import { startsFrom } from '@/contract/release-start';
import { routes } from '@/contract/routes';
import type { VersionPrMerge } from '@/contract/setup-terms';
import type { ReadyRepository } from '@/domain/repository';
import { fromPromise } from '@/failure';
import { semver } from '@/model';
import { planIdentity } from '@/persistence/identity-keys';
import type { AdminContext } from '@/server/handlers/kit';
import { admin, readyRepository } from '@/server/handlers/kit';

export interface Selected {
	repository: ReadyRepository;
	stream: Stream;
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
		const snapshot = yield* service.gateway.snapshot(
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

export function releasePlan(input: ReleaseInput, { service }: Pick<AdminContext, 'service'>) {
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
		} else if (stream.prepare.strategy === 'workflow') {
			const request = yield* parseVersionRequest(input.version);
			target = 'version' in request
				? request.version
				: yield* resolvePackageVersion(yield* selectedReleasePackages(repository.inventory, selected), request);
		}
		const plan: ReleasePlan = stream.prepare.strategy !== 'workflow' && versionsInFiles(repository.inventory)
			? yield* planRelease(snapshot, repository.inventory, target, selected, undefined, stream.versionFiles)
			: stream.prepare.strategy !== 'workflow' && stream.versionFiles?.length
			? yield* planVersionFiles(snapshot, target, stream.versionFiles)
			: {
				version: (yield* Effect.fromResult(semver(target))).replace(/^v/, ''),
				sourceSha: snapshot.sha,
				packages: [],
				edits: [],
				diagnostics: stream.prepare.workflow
					? ['Preparation is delegated to the configured repository workflow']
					: [],
				requiresPreparation: stream.prepare.workflow !== undefined,
			};
		const planId = yield* planIdentity(plan, repository);
		return { selection, plan, planId };
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
	selection: Selected,
	name: string,
	plan: ReleasePlan,
	planId: string,
	actor: string,
	started?: ReleaseStarted,
	versionPrMerge?: VersionPrMerge,
): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const { repository, stream } = selection;
		if (started && (stream.versionSource?.kind === 'tags' || stream.versioning === 'independent')) {
			return yield* precondition(`${name} cannot start releases: it needs one shared version kept in its manifests`);
		}
		if (versionPrMerge && !opensVersionPr(stream, plan)) {
			return yield* precondition(`${plan.version} of ${name} opens no version PR to merge`);
		}
		if (!plan.edits.length && !plan.requiresPreparation) {
			const promotion = yield* createExecution(repository, {
				stream: name,
				operation: 'promote',
				eventId: `release:${plan.version}:${plan.sourceSha}`,
				sourceSha: plan.sourceSha,
				version: plan.version,
			});
			promotion.initiatedBy = actor;
			if (started) {
				promotion.approvedBy = 'start';
				promotion.started = started;
			}
			yield* service.store.audit(actor, 'release.prepare', promotion.id);
			return yield* service.enqueue(repository, promotion);
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
		yield* service.store.audit(actor, started ? 'release.start' : 'release.prepare', execution.id);
		return yield* service.enqueue(repository, execution);
	});
}

function channel(request: Request): StartChannel {
	return request.headers.has('authorization') ? 'cli' : 'dashboard';
}

export const releaseEndpoints = {
	releasesPlan: admin(
		routes.releasesPlan,
		(input, context) => releasePlan(input, context).pipe(Effect.map(reviewed)),
	),
	releasesPrepare: admin(routes.releasesPrepare, (input, context) =>
		Effect.gen(function*() {
			const { selection, plan, planId } = yield* releasePlan(input, context);
			const { service, actor, request } = context;
			if (input.sourceSha !== plan.sourceSha || input.planId !== planId) {
				return yield* conflict('stale-plan', 'Release plan changed; preview it again');
			}
			const via = channel(request);
			const started = startsFrom(selection.stream.start, via) ? { via, actor } : undefined;
			return yield* beginRelease(
				service,
				selection,
				input.stream,
				plan,
				planId,
				actor,
				started,
				input.versionPrMerge,
			);
		})),
	releasesPlanSet: admin(
		routes.releasesPlanSet,
		(input, context) => setPlan(input, context).pipe(Effect.map(reviewed)),
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
			const event = yield* service.store.event(input.releaseEventId);
			if (event?.event !== 'release' || !event.release) {
				return yield* notFound('release-event', 'Verified upstream release event required', input.releaseEventId);
			}
			const release = event.release;
			const snapshot = yield* service.gateway.snapshot(repository.name, repository.id);
			const edits = yield* planHookUpdates(snapshot, release);
			if (input.preview !== false || !edits.length) {
				return { sourceSha: snapshot.sha, upstreamRelease: release, edits };
			}
			const result = yield* service.gateway.pullRequest(
				snapshot,
				`release/hooks/${release.repository.id}/${release.commit}`,
				`chore: update hooks to ${release.version}`,
				`Upstream: ${event.source}\nCommit: ${release.commit}`,
				edits,
				undefined,
				undefined,
				undefined,
				undefined,
				{ coAuthored: true },
			);
			yield* service.store.audit(actor, 'hooks.prepare', result.url);
			return result;
		})),
} as const;
