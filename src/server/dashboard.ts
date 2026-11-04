import { z } from 'zod';
import { Authenticators } from '@/automation/auth.ts';
import { packageWatches } from '@/automation/package-watch.ts';
import { rowDocument } from '@/automation/schemas.ts';
import { type AutomationBindings, AutomationService } from '@/automation/service.ts';
import type { Readable } from '@/automation/store.ts';
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
export interface CLISession {
	id: string;
	created_at: number;
}
const cliSessionSummaries: z.ZodType<CLISession[]> = z.array(z.object({ id: z.string(), created_at: z.number() }));
const deliverySummaries: z.ZodType<DeliverySummary[]> = z.array(
	z.object({ grant_id: z.string(), version: z.number(), state: z.string(), updated_at: z.number() }),
);

function readable<T>(rows: (Readable<T> | { kind: 'unreadable' })[]): T[] {
	return rows.flatMap(row => row.kind === 'readable' ? [row.value] : []);
}
function unreadable<T, U extends { kind: 'unreadable' }>(rows: (Readable<T> | U)[]): U[] {
	return rows.flatMap(row => row.kind === 'unreadable' ? [row] : []);
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
	const [
		repositoryRows,
		executionRows,
		onboarding,
		activity,
		keys,
		secrets,
		grants,
		deliveries,
		winget,
		latestWinget,
		destinations,
		subscriptions,
		notifications,
		cliSessions,
	] = await Promise.all(
		[
			service.store.readRepositories(),
			service.store.readExecutions(),
			service.store.onboardingPulls(),
			service.store.activity(),
			new Authenticators(env).list(actor),
			service.store.db.prepare('SELECT alias,version,created_at FROM credentials WHERE active=1 ORDER BY alias').all(),
			service.store.db.prepare('SELECT document FROM grants').all(),
			service.store.db.prepare('SELECT grant_id,version,state,updated_at FROM secret_deliveries').all(),
			service.winget().list(),
			service.winget().latestByRepository(),
			service.notifications().destinations(),
			service.notifications().subscriptions(),
			service.notifications().recent(),
			service.store.db.prepare('SELECT id,created_at FROM cli_sessions ORDER BY created_at DESC').all(),
		],
	);
	const repositories = readable(repositoryRows);
	const executions = readable(executionRows);
	return {
		winget,
		latestWinget,
		wingetReady: service.winget().setup(),
		repositories,
		packages: await packageWatches(service.store, repositories),
		destinations,
		subscriptions,
		notifications,
		executions,
		unreadable: { repositories: unreadable(repositoryRows), executions: unreadable(executionRows) },
		onboarding,
		activity,
		keys,
		secrets: secretSummaries.parse(secrets.results),
		grants: grants.results.map(row => parseGrant(rowDocument(row))),
		deliveries: deliverySummaries.parse(deliveries.results),
		cliSessions: cliSessionSummaries.parse(cliSessions.results),
	};
}
export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
