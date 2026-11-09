import { expect } from 'bun:test';
import type { Api, Reply } from '@root/test/support/http.ts';
import { Effect } from 'effect';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices, SetupPlan } from '@/automation/setup-types';

export async function previewSetup(api: Api, repository: string, choices?: SetupChoices): Promise<SetupPlan> {
	const preview = await api(
		'/api/repositories/setup/preview',
		choices === undefined ? { repository } : { repository, choices },
	);
	return Effect.runPromise(parseSetupPlan(preview.body));
}

export async function discoverSetup(api: Api, repository: string): Promise<SetupPlan> {
	expect((await api('/api/repositories/discover', { repository })).status).toBe(200);
	return previewSetup(api, repository);
}

export function applySetup(
	api: Api,
	repository: string,
	plan: Pick<SetupPlan, 'planId' | 'sourceSha' | 'setupHead'>,
	choices: SetupChoices,
): Promise<Reply> {
	return api('/api/repositories/setup/apply', {
		repository,
		choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
}

export async function applyChoices(api: Api, repository: string, choices: SetupChoices): Promise<SetupPlan> {
	const plan = await previewSetup(api, repository, choices);
	expect(plan.blockers).toEqual([]);
	expect((await applySetup(api, repository, plan, choices)).status).toBe(200);
	return plan;
}
