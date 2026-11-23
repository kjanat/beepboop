import { Effect, Schema } from 'effect';
import { pullRequest, refreshPullRequest } from '@/automation/preparation-pull-requests';
import { streamReleases } from '@/automation/release-capability';
import { branchConflictBlocker, previewSetup, setupBody, setupOptions, withRegistryStatus } from '@/automation/setup';
import { setupBranch, setupTitle } from '@/automation/setup-changes';
import { followsProposal, observationsKept, sameEdits, savedSetup, setupEdits } from '@/automation/setup-maintenance';
import { generatedFiles, openSetupPull, setupHead } from '@/automation/setup-pull-requests';
import { repositorySnapshot } from '@/automation/snapshot';
import { routes } from '@/contract/routes';
import { discover } from '@/discovery/discover.ts';
import { resolveConfiguration } from '@/domain/configuration/presets.ts';
import { configurationDiagnostics } from '@/domain/configuration/schema.ts';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import { gateLabel } from '@/domain/release-gates.ts';
import { repositoryName, repositoryReference } from '@/domain/repository-name.ts';
import { fromJson, fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { conflict, domainError, invalid, notFound, precondition } from '@/kernel/errors/domain-error.ts';
import { record } from '@/kernel/schema/result.ts';
import { encodeRepository } from '@/persistence/codecs/stored';
import type { Context } from '@/server/handlers/kit';
import { admin, storedRepository } from '@/server/handlers/kit';

function reference(input: string) {
	return repositoryReference(input).pipe(Effect.mapError(error => invalid(error.message, ['repository'])));
}

function ownerName(context: Context, input: string): Effect.Effect<string, DomainError> {
	return repositoryName(input, context.service.gateway.ownerLogin());
}

function shown(repository: RepositoryRecord) {
	return { ...encodeRepository(repository), releases: streamReleases(repository) };
}

export const repositoryEndpoints = {
	repositoriesPackageTags: admin(
		routes.repositoriesPackageTags,
		(input, { service, actor }) =>
			fromPromise(() =>
				service.coordinator(input.repositoryId).packageTags(
					input.repositoryId,
					input.stream,
					input.apply,
					input.after,
					actor,
				)
			),
	),
	repositoriesGates: admin(
		routes.repositoriesGates,
		(input, { service }) =>
			fromPromise(() => service.coordinator(input.repositoryId).gates(input.repositoryId, input.stream)),
	),
	repositoriesGateSkip: admin(routes.repositoriesGateSkip, (input, { service, actor }) =>
		Effect.gen(function*() {
			const repository = yield* storedRepository(service, input.repositoryId, 'Repository is not enrolled');
			if (!repository.configuration || !Object.hasOwn(repository.configuration.streams, input.stream)) {
				return yield* notFound('stream', `Unknown stream ${input.stream}`, input.stream);
			}
			const skips = service.store.gateSkips;
			yield* input.skip
				? skips.skip(repository.id, input.stream, input.gate, actor)
				: skips.restore(repository.id, input.stream, input.gate);
			yield* service.store.audit(
				actor,
				input.skip ? 'stream.gate.skip' : 'stream.gate.restore',
				`${repository.name}:${input.stream}:${gateLabel(input.gate)}`,
			);
			const coordinator = service.coordinator(repository.id);
			yield* fromPromise(() => coordinator.wake());
			return yield* fromPromise(() => coordinator.gates(repository.id, input.stream));
		})),
	repositoriesList: admin(
		routes.repositoriesList,
		(_, { service }) => service.store.repositories().pipe(Effect.map(rows => rows.map(shown))),
	),
	repositoriesResolve: admin(routes.repositoriesResolve, (input, { service }) =>
		Effect.gen(function*() {
			const wanted = yield* reference(input.repository);
			const name = wanted.name.toLowerCase(), owner = wanted.owner?.toLowerCase();
			const matches = (yield* service.store.enrollments()).filter(repository => {
				const [candidateOwner = '', candidateName = ''] = repository.name.toLowerCase().split('/');
				return candidateName === name && (owner === undefined || candidateOwner === owner);
			});
			const [found, ...others] = matches;
			if (others.length) {
				return yield* precondition(
					`Repository ${input.repository} matches ${
						matches.map(repository => repository.name).join(', ')
					}; name the owner`,
				);
			}
			const stored = found ? yield* service.store.repository(found.id) : undefined;
			if (stored) return shown(stored);
			return yield* notFound(
				'repository',
				`Repository ${input.repository} is not enrolled; run beepboop repositories discover ${input.repository}`,
				input.repository,
			);
		})),
	repositoriesDiscover: admin(routes.repositoriesDiscover, (input, context) =>
		Effect.gen(function*() {
			yield* reference(input.repository);
			const name = yield* ownerName(context, input.repository);
			return shown(yield* context.service.discover(name, input.repositoryId));
		})),
	setupPreview: admin(
		routes.setupPreview,
		(input, context) => setupReview(input, context).pipe(Effect.map(review => review.plan)),
	),
	setupApply: admin(routes.setupApply, (input, context) =>
		Effect.gen(function*() {
			const { service, actor } = context;
			const { plan, head, snapshot, saved, previous, branchConflict, id, branch } = yield* setupReview(input, context);
			const title = setupTitle(branch, plan.edits);
			const body = setupBody(plan, { branch, defaultBranch: snapshot.repository.defaultBranch });
			if (input.sourceSha !== plan.sourceSha) {
				return yield* conflict('stale-plan', `The default branch moved to ${snapshot.sha}. Preview again.`);
			}
			if (input.setupHead !== head) {
				return yield* conflict('stale-plan', 'The setup branch changed after the preview. Preview again.');
			}
			if (input.planId !== plan.planId) {
				return yield* conflict(
					'stale-plan',
					'These choices produce a different plan than the reviewed preview. An outdated beepboop CLI drops choice fields it does not know. Upgrade beepboop, or preview again if presets or publishing checks changed.',
				);
			}
			const takeOver = input.takeOver === true && branchConflict;
			const blockers = plan.blockers.filter(blocker => !takeOver || blocker !== branchConflictBlocker);
			if (blockers.length) return yield* precondition(blockers.join('\n'));
			if (!plan.edits.length) return yield* precondition('Release setup already matches the reviewed configuration');
			const result = head && !takeOver && saved?.sourceSha === snapshot.sha && sameEdits(previous, plan.edits)
				? yield* refreshPullRequest(service.gateway, snapshot, branch, title, body, head)
				: yield* pullRequest(service.gateway, {
					snapshot,
					branch,
					title,
					body,
					edits: plan.edits,
					expectedHead: head ?? undefined,
					setupEdits: previous,
					takeOver,
					coAuthored: true,
				});
			const content = plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after
				?? snapshot.files['.github/beepboop.json'];
			const generated = new Map(
				previous.flatMap(edit => {
					const after = snapshot.files[edit.path];
					return after === undefined ? [] : [[edit.path, { ...edit, after }] as const];
				}),
			);
			for (const edit of plan.edits) generated.set(edit.path, edit);
			yield* service.onboarding.save(id, {
				...result,
				content,
				sourceSha: snapshot.sha,
				choices: plan.choices,
				options: setupOptions(plan),
				inferred: plan.adoption !== undefined,
				edits: [...generated.values()],
				...observationsKept,
			});
			yield* service.store.audit(actor, 'repository.setup', String(id));
			return result;
		})),
} as const;

function setupReview(input: { repository: string; choices?: unknown }, context: Context) {
	const { service } = context;
	return Effect.gen(function*() {
		yield* reference(input.repository);
		const name = yield* ownerName(context, input.repository);
		const id = yield* service.gateway.identify(name);
		const snapshot = yield* repositorySnapshot(service.gateway, name, id);
		const raw = yield* fromJson(snapshot.files['.github/beepboop.json'] ?? '{}');
		const resolved = yield* resolveConfiguration(raw, ref => service.gateway.preset(ref)).pipe(
			Effect.mapError(error =>
				error instanceof Schema.SchemaError
					? domainError({ code: 'precondition', diagnostics: configurationDiagnostics(error) })
					: error
			),
		);
		const stored = yield* service.store.repository(id);
		const inventory = withRegistryStatus(discover(snapshot), stored?.inventory);
		const document = yield* service.onboarding.document(id);
		const saved = document === undefined ? undefined : yield* Effect.fromResult(record(yield* fromJson(document)));
		const branch = setupBranch(snapshot);
		const head = yield* setupHead(service.gateway, name, id, branch);
		const branchFiles = head ? yield* generatedFiles(service.gateway, name, id, head) : undefined;
		const branchConflict = !!head && saved?.head !== head && !branchFiles;
		const previous = branchFiles ?? setupEdits(saved);
		const priorConfiguration = previous.find(edit => edit.path === '.github/beepboop.json')?.before ?? '';
		const open = typeof saved?.url === 'string' ? yield* openSetupPull(service.gateway, name, id) : undefined;
		const proposed = open !== undefined && (snapshot.files['.github/beepboop.json'] ?? '') === priorConfiguration
			&& !followsProposal(saved, open.body);
		const choices = input.choices ?? (proposed ? saved?.choices : undefined);
		const workflowPermission = yield* service.gateway.canEditWorkflows(name, id);
		const plan = yield* previewSetup(snapshot, inventory, choices, {
			publishing: service.publishingAccess(snapshot.repository),
			...savedSetup(saved),
			head,
			workflowPermission,
			...(!workflowPermission ? { appPage: yield* service.gateway.appPage } : {}),
			branchConflict,
			presetShas: resolved.presetShas,
			...(typeof saved?.url === 'string'
				? { prior: { url: saved.url, content: typeof saved.content === 'string' ? saved.content : undefined } }
				: {}),
		}, resolved.configuration);
		return { id, snapshot, saved, head, branchConflict, previous, plan, branch };
	});
}
