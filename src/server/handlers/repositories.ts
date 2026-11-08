import { Effect } from 'effect';
import { z } from 'zod';
import { resolveConfiguration } from '@/automation/configuration';
import { discover } from '@/automation/managers';
import { encodeRepository } from '@/automation/package-identity';
import { repositoryName, repositoryReference } from '@/automation/repository-name';
import { branchConflictBlocker, previewSetup, setupBody, setupOptions, withRegistryStatus } from '@/automation/setup';
import { sameEdits, setupEdits } from '@/automation/setup-maintenance';
import { conflict, type DomainError, domainError, invalid, notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { configurationDiagnostics } from '@/domain/configuration';
import { fromJson } from '@/failure';
import { record } from '@/model';
import { admin, type Context } from '@/server/handlers/kit';

function reference(input: string) {
	return repositoryReference(input).pipe(Effect.mapError(error => invalid(error.message, ['repository'])));
}

function ownerName(context: Context, input: string): Effect.Effect<string, DomainError> {
	return repositoryName(input, context.service.gateway.ownerLogin());
}

export const repositoryEndpoints = {
	repositoriesList: admin(
		routes.repositoriesList,
		(_, { service }) => service.store.repositories().pipe(Effect.map(rows => rows.map(encodeRepository))),
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
			if (stored) return encodeRepository(stored);
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
			return encodeRepository(yield* context.service.discover(name, input.repositoryId));
		})),
	setupPreview: admin(
		routes.setupPreview,
		(input, context) => setupReview(input, context).pipe(Effect.map(review => review.plan)),
	),
	setupApply: admin(routes.setupApply, (input, context) =>
		Effect.gen(function*() {
			const { service, actor } = context;
			const { plan, head, snapshot, saved, previous, branchConflict, id } = yield* setupReview(input, context);
			if (input.sourceSha !== plan.sourceSha) {
				return yield* conflict('stale-plan', `The default branch moved to ${snapshot.sha}. Preview again.`);
			}
			if (input.setupHead !== head) {
				return yield* conflict('stale-plan', 'The setup branch changed after the preview. Preview again.');
			}
			if (input.planId !== plan.planId) {
				return yield* conflict(
					'stale-plan',
					'These choices produce a different plan than the reviewed preview. An outdated beepboop CLI drops choice fields it does not know. Upgrade beepboop, or preview again if presets changed.',
				);
			}
			const takeOver = input.takeOver === true && branchConflict;
			const blockers = plan.blockers.filter(blocker => !takeOver || blocker !== branchConflictBlocker);
			if (blockers.length) return yield* precondition(blockers.join('\n'));
			if (!plan.edits.length) return yield* precondition('Release setup already matches the reviewed configuration');
			const result = head && !takeOver && saved?.sourceSha === snapshot.sha && sameEdits(previous, plan.edits)
				? yield* service.gateway.refreshPullRequest(
					snapshot,
					'automation/onboarding',
					'chore: configure release automation',
					setupBody(plan),
					head,
				)
				: yield* service.gateway.pullRequest(
					snapshot,
					'automation/onboarding',
					'chore: configure release automation',
					setupBody(plan),
					plan.edits,
					head ?? undefined,
					undefined,
					previous,
					undefined,
					{ takeOver, coAuthored: true },
				);
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
				edits: [...generated.values()],
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
		const snapshot = yield* service.gateway.snapshot(name, id);
		const raw = yield* fromJson(snapshot.files['.github/beepboop.json'] ?? '{}');
		const resolved = yield* resolveConfiguration(raw, ref => service.gateway.preset(ref)).pipe(
			Effect.mapError(error =>
				error instanceof z.ZodError
					? domainError({ code: 'precondition', diagnostics: configurationDiagnostics(error) })
					: error
			),
		);
		const stored = yield* service.store.repository(id);
		const inventory = withRegistryStatus(discover(snapshot), stored?.inventory);
		const document = yield* service.onboarding.document(id);
		const saved = document === undefined ? undefined : yield* Effect.fromResult(record(yield* fromJson(document)));
		const head = yield* service.gateway.setupHead(name, id);
		const branchFiles = head ? yield* service.gateway.generatedFiles(name, id, head) : undefined;
		const branchConflict = !!head && saved?.head !== head && !branchFiles;
		const previous = branchFiles ?? setupEdits(saved);
		const priorConfiguration = previous.find(edit => edit.path === '.github/beepboop.json')?.before ?? '';
		const proposed = typeof saved?.url === 'string'
			&& (snapshot.files['.github/beepboop.json'] ?? '') === priorConfiguration
			&& (yield* service.gateway.openSetupPull(name, id)) !== undefined;
		const choices = input.choices ?? (proposed ? saved?.choices : undefined);
		const workflowPermission = yield* service.gateway.canEditWorkflows(name, id);
		const plan = yield* previewSetup(snapshot, inventory, choices, {
			head,
			workflowPermission,
			branchConflict,
			presetShas: resolved.presetShas,
			...(typeof saved?.url === 'string'
				? { prior: { url: saved.url, content: typeof saved.content === 'string' ? saved.content : undefined } }
				: {}),
		}, resolved.configuration);
		return { id, snapshot, saved, head, branchConflict, previous, plan };
	});
}
