import { z } from 'zod';
import { Authenticators } from '@/automation/auth.ts';
import { rowDocument } from '@/automation/schemas.ts';
import { type AutomationBindings, AutomationService } from '@/automation/service.ts';
import type { RepositoryRecord } from '@/automation/types.ts';
import { parseGrant } from '@/automation/vault.ts';

export interface SecretSummary {
	alias: string;
	version: number;
	created_at: number;
}
export interface DeliverySummary {
	grant_id: string;
	version: number;
	state: string;
	updated_at: number;
}
const secretSummaries: z.ZodType<SecretSummary[]> = z.array(
	z.object({ alias: z.string(), version: z.number(), created_at: z.number() }),
);
const deliverySummaries: z.ZodType<DeliverySummary[]> = z.array(
	z.object({ grant_id: z.string(), version: z.number(), state: z.string(), updated_at: z.number() }),
);

export function workflowChoices(repository: RepositoryRecord) {
	if (!repository.configuration || repository.suspended || repository.diagnostics.length) return [];
	return Object.entries(repository.configuration.streams).flatMap(([stream, configuration]) => {
		const bindings = {
			...configuration.workflows,
			...(configuration.prepare.workflow ? { prepare: configuration.prepare.workflow } : {}),
			...(configuration.promote.workflow ? { promote: configuration.promote.workflow } : {}),
		};
		return Object.entries(bindings).map(([operation, workflow]) => ({
			stream,
			operation,
			file: workflow.file,
			ref: workflow.ref ?? repository.defaultBranch,
			credentials: configuration.credentials,
			mode: workflow.mode ?? 'dispatch',
		}));
	});
}

export async function dashboard(env: AutomationBindings, actor: string) {
	const service = new AutomationService(env);
	const [
		repositories,
		executions,
		onboarding,
		activity,
		keys,
		secrets,
		grants,
		deliveries,
		winget,
		latestWinget,
	] = await Promise.all(
		[
			service.store.repositories(),
			service.store.executions(),
			service.store.onboardingPulls(),
			service.store.activity(),
			new Authenticators(env).list(actor),
			service.store.db.prepare('SELECT alias,version,created_at FROM credentials WHERE active=1 ORDER BY alias').all(),
			service.store.db.prepare('SELECT document FROM grants').all(),
			service.store.db.prepare('SELECT grant_id,version,state,updated_at FROM secret_deliveries').all(),
			service.winget().list(),
			service.winget().latestByRepository(),
		],
	);
	return {
		winget,
		latestWinget,
		wingetReady: service.winget().setup(),
		repositories,
		executions,
		onboarding,
		activity,
		keys,
		secrets: secretSummaries.parse(secrets.results),
		grants: grants.results.map(row => parseGrant(rowDocument(row))),
		deliveries: deliverySummaries.parse(deliveries.results),
	};
}
export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
export function date(value: number) {
	return `${new Date(value).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}
