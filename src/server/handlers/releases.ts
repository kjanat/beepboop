import { Effect } from 'effect';
import { planVersionFiles } from '@/automation/editors';
import { createExecution } from '@/automation/execution';
import { createReleasePreparation } from '@/automation/managed';
import { planRelease, versionsInFiles } from '@/automation/managers';
import { matchesPackage } from '@/automation/package-identity';
import { planReleaseSet } from '@/automation/planning';
import { planHookUpdates } from '@/automation/precommit';
import type { AutomationService } from '@/automation/service';
import type { ReleasePlan, Snapshot, Stream } from '@/automation/types';
import { nextVersion, parseVersionRequest } from '@/automation/version';
import { conflict, type DomainError, notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { type ReadyRepository, requireReady } from '@/domain/repository';
import { fromPromise, fromSync } from '@/failure';
import { compareVersions, semver } from '@/model';
import { planIdentity } from '@/persistence/identity-keys';
import { type AdminContext, admin } from '@/server/handlers/kit';

interface Selected {
	repository: ReadyRepository;
	stream: Stream;
}

function ready(service: AutomationService, repositoryId: number): Effect.Effect<ReadyRepository, DomainError> {
	return Effect.gen(function*() {
		const repository = yield* service.store.repository(repositoryId);
		if (!repository) return yield* notFound('repository', 'Repository not configured', String(repositoryId));
		return yield* requireReady(repository);
	});
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

function tagVersions(service: AutomationService, repository: ReadyRepository, prefix: string) {
	return service.gateway.tagRefs(repository.name, repository.id).pipe(
		Effect.map(refs =>
			refs.flatMap(ref => {
				if (!ref.name.startsWith(prefix)) return [];
				try {
					return [semver(ref.name.slice(prefix.length)).replace(/^v/, '')];
				} catch {
					return [];
				}
			}).sort(compareVersions)
		),
	);
}

function releasePlan(input: ReleaseInput, { service }: AdminContext) {
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
			const versions = yield* tagVersions(service, repository, stream.versionSource.prefix);
			const request = yield* parseVersionRequest(input.version);
			const latest = versions.at(-1);
			if (!latest && !('version' in request)) {
				return yield* precondition('Select an explicit version for the first release');
			}
			target = latest
				? yield* nextVersion(latest, request)
				: ('version' in request ? request.version : undefined);
		}
		const plan: ReleasePlan = stream.prepare.strategy !== 'workflow' && versionsInFiles(repository.inventory)
			? yield* planRelease(snapshot, repository.inventory, target, selected, undefined, stream.versionFiles)
			: stream.prepare.strategy !== 'workflow' && stream.versionFiles?.length
			? yield* planVersionFiles(snapshot, target, stream.versionFiles)
			: {
				version: yield* fromSync(() => semver(target).replace(/^v/, '')),
				sourceSha: snapshot.sha,
				packages: [],
				edits: [],
				diagnostics: ['Preparation is delegated to the configured repository workflow'],
				requiresPreparation: true,
			};
		const planId = yield* planIdentity(plan, repository);
		return { selection, plan, planId };
	});
}

function setPlan(input: { repositoryId: number; stream: string; plan: unknown }, { service }: AdminContext) {
	return Effect.gen(function*() {
		const repository = yield* ready(service, input.repositoryId);
		const stream = repository.configuration.streams[input.stream];
		if (stream?.versioning !== 'independent') return yield* precondition('Select an independent release stream');
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

export const releaseEndpoints = {
	releasesPlan: admin(
		routes.releasesPlan,
		(input, context) => releasePlan(input, context).pipe(Effect.map(({ plan, planId }) => ({ ...plan, planId }))),
	),
	releasesPrepare: admin(routes.releasesPrepare, (input, context) =>
		Effect.gen(function*() {
			const { selection, plan, planId } = yield* releasePlan(input, context);
			const { repository, stream } = selection;
			const { service, actor } = context;
			if (input.sourceSha !== plan.sourceSha || input.planId !== planId) {
				return yield* conflict('stale-plan', 'Release plan changed; preview it again');
			}
			if (!plan.edits.length && !plan.requiresPreparation) {
				const promotion = yield* (
					createExecution(repository, {
						stream: input.stream,
						operation: 'promote',
						eventId: `release:${plan.version}:${plan.sourceSha}`,
						sourceSha: plan.sourceSha,
						version: plan.version,
					})
				);
				yield* service.store.audit(actor, 'release.prepare', promotion.id);
				return yield* service.enqueue(repository, promotion);
			}
			const execution = yield* (
				stream.prepare.workflow && stream.prepare.strategy === 'workflow'
					? createExecution(repository, {
						stream: input.stream,
						operation: 'prepare',
						eventId: `plan:${planId}`,
						sourceSha: repository.sha,
						version: plan.version,
					})
					: createReleasePreparation(repository, input.stream, plan)
			);
			yield* service.store.audit(actor, 'release.prepare', execution.id);
			return yield* service.enqueue(repository, execution);
		})),
	releasesPlanSet: admin(
		routes.releasesPlanSet,
		(input, context) => setPlan(input, context).pipe(Effect.map(({ plan, planId }) => ({ ...plan, planId }))),
	),
	releasesPrepareSet: admin(routes.releasesPrepareSet, (input, context) =>
		Effect.gen(function*() {
			const { repository, plan, planId } = yield* setPlan(input, context);
			if (input.sourceSha !== plan.sourceSha) {
				return yield* conflict('stale-revision', 'Preview source revision changed');
			}
			if (input.planId !== planId) return yield* conflict('stale-plan', 'Release plan changed; preview it again');
			const execution = yield* createReleasePreparation(repository, input.stream, plan);
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
			);
			yield* service.store.audit(actor, 'hooks.prepare', result.url);
			return result;
		})),
} as const;
