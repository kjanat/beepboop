import { Authenticators } from '@/automation/auth.ts';
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
	const [repositories, executions, onboarding, activity, keys, secrets, grants, deliveries, winget] = await Promise.all(
		[
			service.store.repositories(),
			service.store.executions(),
			service.store.onboardingPulls(),
			service.store.activity(),
			new Authenticators(env).list(actor),
			service.store.db.prepare('SELECT alias,version,created_at FROM credentials WHERE active=1 ORDER BY alias').all<
				SecretSummary
			>(),
			service.store.db.prepare('SELECT document FROM grants').all<{ document: string }>(),
			service.store.db.prepare('SELECT grant_id,version,state,updated_at FROM secret_deliveries').all<
				DeliverySummary
			>(),
			service.winget().list(),
		],
	);
	return {
		winget,
		wingetReady: service.winget().setup(),
		repositories,
		executions,
		onboarding,
		activity,
		keys,
		secrets: secrets.results,
		grants: grants.results.map(row => parseGrant(JSON.parse(row.document))),
		deliveries: deliveries.results,
	};
}
export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
export function date(value: number) {
	return `${new Date(value).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}
