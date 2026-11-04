import { z } from 'zod';
import { resolveConfiguration } from '@/automation/configuration';
import { discover } from '@/automation/managers';
import { encodeRepository } from '@/automation/package-identity';
import { repositoryName, repositoryReference } from '@/automation/repository-name';
import { branchConflictBlocker, previewSetup, setupBody, setupOptions, withRegistryStatus } from '@/automation/setup';
import { sameEdits, setupEdits } from '@/automation/setup-maintenance';
import { conflict, DomainError, invalid, notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { configurationDiagnostics } from '@/domain/configuration';
import { record } from '@/model';
import { admin, type Context } from '@/server/handlers/kit';

function reference(input: string) {
	try {
		return repositoryReference(input);
	} catch (error) {
		throw invalid(error instanceof Error ? error.message : 'Invalid repository', ['repository']);
	}
}

export const repositoryEndpoints = {
	repositoriesList: admin(
		routes.repositoriesList,
		async (_, { service }) => (await service.store.repositories()).map(encodeRepository),
	),
	repositoriesResolve: admin(routes.repositoriesResolve, async (input, { service }) => {
		const wanted = reference(input.repository);
		const name = wanted.name.toLowerCase(), owner = wanted.owner?.toLowerCase();
		const matches = (await service.store.enrollments()).filter(repository => {
			const [candidateOwner = '', candidateName = ''] = repository.name.toLowerCase().split('/');
			return candidateName === name && (owner === undefined || candidateOwner === owner);
		});
		const [found, ...others] = matches;
		if (others.length) {
			throw precondition(
				`Repository ${input.repository} matches ${
					matches.map(repository => repository.name).join(', ')
				}; name the owner`,
			);
		}
		const record = found && await service.store.repository(found.id);
		if (record) return encodeRepository(record);
		throw notFound(
			'repository',
			`Repository ${input.repository} is not enrolled; run beepboop repositories discover ${input.repository}`,
			input.repository,
		);
	}),
	repositoriesDiscover: admin(routes.repositoriesDiscover, async (input, { service }) => {
		reference(input.repository);
		const name = await repositoryName(input.repository, () => service.gateway.ownerLogin());
		return encodeRepository(await service.discover(name, input.repositoryId));
	}),
	setupPreview: admin(routes.setupPreview, async (input, context) => (await setupReview(input, context)).plan),
	setupApply: admin(routes.setupApply, async (input, context) => {
		const { service, actor } = context;
		const review = await setupReview(input, context);
		const { plan, head, snapshot, saved, previous, branchConflict, id } = review;
		if (input.planId !== plan.planId || input.sourceSha !== plan.sourceSha || input.setupHead !== head) {
			throw conflict('stale-plan', 'Setup source, choices or branch changed; preview again');
		}
		const takeOver = input.takeOver === true && branchConflict;
		const blockers = plan.blockers.filter(blocker => !takeOver || blocker !== branchConflictBlocker);
		if (blockers.length) throw precondition(blockers.join('\n'));
		if (!plan.edits.length) throw precondition('Release setup already matches the reviewed configuration');
		const result = head && !takeOver && saved?.sourceSha === snapshot.sha && sameEdits(previous, plan.edits)
			? await service.gateway.refreshPullRequest(
				snapshot,
				'automation/onboarding',
				'chore: configure release automation',
				setupBody(plan),
				head,
			)
			: await service.gateway.pullRequest(
				snapshot,
				'automation/onboarding',
				'chore: configure release automation',
				setupBody(plan),
				plan.edits,
				head ?? undefined,
				undefined,
				previous,
				undefined,
				takeOver,
			);
		const content = plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after
			?? snapshot.files['.github/beepboop.json'];
		// Keep the complete set of generated files for safe later refreshes, including unchanged ones.
		const generated = new Map(
			previous.flatMap(edit => {
				const after = snapshot.files[edit.path];
				return after === undefined ? [] : [[edit.path, { ...edit, after }] as const];
			}),
		);
		for (const edit of plan.edits) generated.set(edit.path, edit);
		await service.onboarding.save(id, {
			...result,
			content,
			sourceSha: snapshot.sha,
			choices: plan.choices,
			options: setupOptions(plan),
			edits: [...generated.values()],
		});
		await service.store.audit(actor, 'repository.setup', String(id));
		return result;
	}),
} as const;

async function setupReview(
	input: { repository: string; choices?: unknown },
	{ service }: Context,
) {
	reference(input.repository);
	const name = await repositoryName(input.repository, () => service.gateway.ownerLogin());
	const id = await service.gateway.identify(name);
	const snapshot = await service.gateway.snapshot(name, id);
	const raw = JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}');
	const resolved = await resolveConfiguration(raw, ref => service.gateway.preset(ref)).catch((error: unknown) => {
		if (error instanceof z.ZodError) {
			throw new DomainError({ code: 'precondition', diagnostics: configurationDiagnostics(error) });
		}
		throw error;
	});
	const inventory = withRegistryStatus(discover(snapshot), (await service.store.repository(id))?.inventory);
	const document = await service.onboarding.document(id);
	const saved = document === undefined ? undefined : record(JSON.parse(document));
	const head = await service.gateway.setupHead(name, id);
	const branchFiles = head ? await service.gateway.generatedFiles(name, id, head) : undefined;
	const branchConflict = !!head && saved?.head !== head && !branchFiles;
	const previous = branchFiles ?? setupEdits(saved);
	const priorConfiguration = previous.find(edit => edit.path === '.github/beepboop.json')?.before ?? '';
	const choices = input.choices
		?? ((snapshot.files['.github/beepboop.json'] ?? '') === priorConfiguration ? saved?.choices : undefined);
	const plan = await previewSetup(snapshot, inventory, choices, {
		head,
		workflowPermission: await service.gateway.canEditWorkflows(name, id),
		branchConflict,
		presetShas: resolved.presetShas,
		...(typeof saved?.url === 'string'
			? { prior: { url: saved.url, content: typeof saved.content === 'string' ? saved.content : undefined } }
			: {}),
	}, resolved.configuration);
	return { id, snapshot, saved, head, branchConflict, previous, plan };
}
