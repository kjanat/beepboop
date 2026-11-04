import { planVersionFiles } from '@/automation/editors';
import { createExecution } from '@/automation/execution';
import { createReleasePreparation } from '@/automation/managed';
import { planRelease, versionsInFiles } from '@/automation/managers';
import { matchesPackage } from '@/automation/package-identity';
import { planReleaseSet } from '@/automation/planning';
import { planHookUpdates } from '@/automation/precommit';
import type { AutomationService } from '@/automation/service';
import type { Stream } from '@/automation/types';
import { nextVersion, parseVersionRequest } from '@/automation/version';
import { conflict, notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { type ReadyRepository, requireReady } from '@/domain/repository';
import { compareVersions, semver } from '@/model';
import { planIdentity } from '@/persistence/identity-keys';
import { type AdminContext, admin } from '@/server/handlers/kit';

interface Selected {
	repository: ReadyRepository;
	stream: Stream;
}

async function ready(service: AutomationService, repositoryId: number): Promise<ReadyRepository> {
	const repository = await service.store.repository(repositoryId);
	if (!repository) throw notFound('repository', 'Repository not configured', String(repositoryId));
	return requireReady(repository);
}

async function configured(service: AutomationService, repositoryId: number, name: string): Promise<Selected> {
	const repository = await ready(service, repositoryId);
	const stream = repository.configuration.streams[name];
	if (!stream) throw notFound('stream', 'Unknown stream', name);
	return { repository, stream };
}

async function current(service: AutomationService, { repository, stream }: Selected, message: string) {
	const snapshot = await service.gateway.snapshot(
		repository.name,
		repository.id,
		undefined,
		(stream.versionFiles ?? []).map(rule => rule.path),
	);
	if (snapshot.sha !== repository.sha) throw conflict('stale-revision', message);
	return snapshot;
}

interface ReleaseInput {
	repositoryId: number;
	stream: string;
	version?: unknown;
	packages?: string[] | undefined;
}

async function releasePlan(input: ReleaseInput, { service }: AdminContext) {
	const selection = await configured(service, input.repositoryId, input.stream);
	const { repository, stream } = selection;
	const snapshot = await current(service, selection, 'Refresh discovery before preparing this revision');
	if (stream.versioning === 'independent' && !stream.packages && input.packages === undefined) {
		throw precondition('Select packages for an independent release');
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
		throw precondition('Package is outside this release stream');
	}
	let target: unknown = input.version;
	if (stream.versionSource?.kind === 'tags') {
		const prefix = stream.versionSource.prefix;
		const versions = (await service.gateway.tagRefs(repository.name, repository.id)).flatMap(ref => {
			if (!ref.name.startsWith(prefix)) return [];
			try {
				return [semver(ref.name.slice(prefix.length)).replace(/^v/, '')];
			} catch {
				return [];
			}
		}).sort(compareVersions);
		const request = parseVersionRequest(input.version);
		const latest = versions.at(-1);
		if (!latest && !('version' in request)) throw precondition('Select an explicit version for the first release');
		target = latest ? nextVersion(latest, request) : ('version' in request ? request.version : undefined);
	}
	const plan = stream.prepare.strategy !== 'workflow' && versionsInFiles(repository.inventory)
		? planRelease(snapshot, repository.inventory, target, selected, undefined, stream.versionFiles)
		: stream.prepare.strategy !== 'workflow' && stream.versionFiles?.length
		? planVersionFiles(snapshot, target, stream.versionFiles)
		: {
			version: semver(target).replace(/^v/, ''),
			sourceSha: snapshot.sha,
			packages: [],
			edits: [],
			diagnostics: ['Preparation is delegated to the configured repository workflow'],
			requiresPreparation: true,
		};
	return { selection, plan, planId: await planIdentity(plan, repository) };
}

async function setPlan(input: { repositoryId: number; stream: string; plan: unknown }, { service }: AdminContext) {
	const repository = await ready(service, input.repositoryId);
	const stream = repository.configuration.streams[input.stream];
	if (stream?.versioning !== 'independent') throw precondition('Select an independent release stream');
	const snapshot = await current(service, { repository, stream }, 'Refresh discovery before planning this revision');
	const plan = planReleaseSet(snapshot, repository.inventory, input.plan, stream.packages, stream.versionFiles);
	return { repository, plan, planId: await planIdentity(plan, repository) };
}

export const releaseEndpoints = {
	releasesPlan: admin(routes.releasesPlan, async (input, context) => {
		const { plan, planId } = await releasePlan(input, context);
		return { ...plan, planId };
	}),
	releasesPrepare: admin(routes.releasesPrepare, async (input, context) => {
		const { selection, plan, planId } = await releasePlan(input, context);
		const { repository, stream } = selection;
		const { service, actor } = context;
		if (input.sourceSha !== plan.sourceSha || input.planId !== planId) {
			throw conflict('stale-plan', 'Release plan changed; preview it again');
		}
		if (!plan.edits.length && !plan.requiresPreparation) {
			const promotion = await createExecution(repository, {
				stream: input.stream,
				operation: 'promote',
				eventId: `release:${plan.version}:${plan.sourceSha}`,
				sourceSha: plan.sourceSha,
				version: plan.version,
			});
			await service.store.audit(actor, 'release.prepare', promotion.id);
			return service.enqueue(repository, promotion);
		}
		const execution = stream.prepare.workflow && stream.prepare.strategy === 'workflow'
			? await createExecution(repository, {
				stream: input.stream,
				operation: 'prepare',
				eventId: `plan:${planId}`,
				sourceSha: repository.sha,
				version: plan.version,
			})
			: await createReleasePreparation(repository, input.stream, plan);
		await service.store.audit(actor, 'release.prepare', execution.id);
		return service.enqueue(repository, execution);
	}),
	releasesPlanSet: admin(routes.releasesPlanSet, async (input, context) => {
		const { plan, planId } = await setPlan(input, context);
		return { ...plan, planId };
	}),
	releasesPrepareSet: admin(routes.releasesPrepareSet, async (input, context) => {
		const { repository, plan, planId } = await setPlan(input, context);
		if (input.sourceSha !== plan.sourceSha) throw conflict('stale-revision', 'Preview source revision changed');
		if (input.planId !== planId) throw conflict('stale-plan', 'Release plan changed; preview it again');
		const execution = await createReleasePreparation(repository, input.stream, plan);
		await context.service.store.audit(context.actor, 'release.prepare-set', execution.id);
		return context.service.enqueue(repository, execution);
	}),
	releasesStartSet: admin(routes.releasesStartSet, async (input, { service, actor }) => {
		const preparation = await service.store.execution(input.preparationId);
		if (!preparation) throw notFound('execution', 'Unknown preparation', input.preparationId);
		const executions = await service.coordinator(preparation.repositoryId).startReleaseSet(
			preparation.id,
			input.sourceSha,
		);
		await service.store.audit(actor, 'release.start-set', preparation.id);
		return executions;
	}),
	hooksUpdate: admin(routes.hooksUpdate, async (input, { service, actor }) => {
		const repository = await ready(service, input.repositoryId);
		if (!repository.configuration.managers.includes('pre-commit')) throw precondition('Hook manager is not enabled');
		const event = await service.store.event(input.releaseEventId);
		if (event?.event !== 'release' || !event.release) {
			throw notFound('release-event', 'Verified upstream release event required', input.releaseEventId);
		}
		const snapshot = await service.gateway.snapshot(repository.name, repository.id);
		const edits = planHookUpdates(snapshot, event.release);
		if (input.preview !== false || !edits.length) {
			return { sourceSha: snapshot.sha, upstreamRelease: event.release, edits };
		}
		const result = await service.gateway.pullRequest(
			snapshot,
			`release/hooks/${event.release.repository.id}/${event.release.commit}`,
			`chore: update hooks to ${event.release.version}`,
			`Upstream: ${event.source}\nCommit: ${event.release.commit}`,
			edits,
		);
		await service.store.audit(actor, 'hooks.prepare', result.url);
		return result;
	}),
} as const;
