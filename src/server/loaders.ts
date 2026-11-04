import { z } from 'zod';
import { Authenticators } from '@/automation/auth.ts';
import { packageWatches } from '@/automation/package-watch.ts';
import { rowDocument } from '@/automation/schemas.ts';
import { type AutomationBindings, AutomationService } from '@/automation/service.ts';
import type { Readable, UnreadableExecution, UnreadableRepository } from '@/automation/store.ts';
import type { Execution, RepositoryRecord } from '@/automation/types.ts';
import { parseGrant } from '@/automation/vault.ts';
import type { Section } from '@/server/sections.ts';

export interface LoaderContext {
	env: AutomationBindings;
	actor: string;
}

export type Panel<T> = { kind: 'loaded'; value: T } | { kind: 'failed' };

export async function panel<T>(name: string, work: () => Promise<T>): Promise<Panel<T>> {
	try {
		return { kind: 'loaded', value: await work() };
	} catch (error) {
		console.error('dashboard panel failed', name, error);
		return { kind: 'failed' };
	}
}

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
export interface CLISession {
	id: string;
	created_at: number;
}
const secretSummaries: z.ZodType<SecretSummary[]> = z.array(
	z.object({ alias: z.string(), version: z.number(), created_at: z.number() }),
);
const cliSessionSummaries: z.ZodType<CLISession[]> = z.array(z.object({ id: z.string(), created_at: z.number() }));
const deliverySummaries: z.ZodType<DeliverySummary[]> = z.array(
	z.object({ grant_id: z.string(), version: z.number(), state: z.string(), updated_at: z.number() }),
);

interface Rows<T, U> {
	readable: T[];
	unreadable: U[];
}
function split<T, U extends { kind: 'unreadable' }>(rows: (Readable<T> | U)[]): Rows<T, U> {
	return {
		readable: rows.flatMap(row => row.kind === 'readable' ? [row.value] : []),
		unreadable: rows.flatMap(row => row.kind === 'unreadable' ? [row] : []),
	};
}

async function repositories(service: AutomationService): Promise<Rows<RepositoryRecord, UnreadableRepository>> {
	return split(await service.store.readRepositories());
}
async function executions(service: AutomationService): Promise<Rows<Execution, UnreadableExecution>> {
	return split(await service.store.readExecutions());
}
async function secrets(service: AutomationService): Promise<SecretSummary[]> {
	const rows = await service.store.db
		.prepare('SELECT alias,version,created_at FROM credentials WHERE active=1 ORDER BY alias')
		.all();
	return secretSummaries.parse(rows.results);
}
async function grants(service: AutomationService) {
	const rows = await service.store.db.prepare('SELECT document FROM grants').all();
	return rows.results.map(row => parseGrant(rowDocument(row)));
}
async function deliveries(service: AutomationService): Promise<DeliverySummary[]> {
	const rows = await service.store.db.prepare('SELECT grant_id,version,state,updated_at FROM secret_deliveries').all();
	return deliverySummaries.parse(rows.results);
}
async function cliSessions(service: AutomationService): Promise<CLISession[]> {
	const rows = await service.store.db.prepare('SELECT id,created_at FROM cli_sessions ORDER BY created_at DESC').all();
	return cliSessionSummaries.parse(rows.results);
}

export const loaders = {
	overview: async ({ env }) => {
		const service = new AutomationService(env);
		const [repositoryRows, executionRows] = await Promise.all([repositories(service), executions(service)]);
		return { section: 'overview', repositories: repositoryRows, executions: executionRows };
	},
	repositories: async ({ env }) => {
		const service = new AutomationService(env);
		const [repositoryRows, onboarding, latestWinget] = await Promise.all([
			repositories(service),
			service.store.onboardingPulls(),
			panel('winget-latest', () => service.winget().latestByRepository()),
		]);
		return { section: 'repositories', repositories: repositoryRows, onboarding, latestWinget };
	},
	packages: async ({ env }) => {
		const service = new AutomationService(env);
		const [repositoryRows, destinations, subscriptions] = await Promise.all([
			repositories(service),
			service.notifications().destinations(),
			service.notifications().subscriptions(),
		]);
		return {
			section: 'packages',
			packages: await packageWatches(service.store, repositoryRows.readable),
			destinations,
			subscriptions,
		};
	},
	notifications: async ({ env, actor }) => {
		const service = new AutomationService(env);
		const [keys, secretRows, destinations, subscriptions, notifications] = await Promise.all([
			new Authenticators(env).list(actor),
			secrets(service),
			service.notifications().destinations(),
			service.notifications().subscriptions(),
			service.notifications().recent(),
		]);
		return { section: 'notifications', keys, secrets: secretRows, destinations, subscriptions, notifications };
	},
	releases: async ({ env }) => {
		const service = new AutomationService(env);
		const [repositoryRows, executionRows] = await Promise.all([repositories(service), executions(service)]);
		return { section: 'releases', repositories: repositoryRows.readable, executions: executionRows.readable };
	},
	runs: async ({ env }) => {
		const service = new AutomationService(env);
		return { section: 'runs', executions: await executions(service) };
	},
	winget: async ({ env }) => {
		const service = new AutomationService(env);
		const [repositoryRows, submissions] = await Promise.all([
			repositories(service),
			panel('winget-submissions', () => service.winget().list()),
		]);
		return {
			section: 'winget',
			repositories: repositoryRows.readable,
			submissions,
			ready: service.winget().setup(),
		};
	},
	secrets: async ({ env, actor }) => {
		const service = new AutomationService(env);
		const [keys, secretRows, grantRows, deliveryRows, repositoryRows] = await Promise.all([
			new Authenticators(env).list(actor),
			secrets(service),
			grants(service),
			deliveries(service),
			repositories(service),
		]);
		return {
			section: 'secrets',
			keys,
			secrets: secretRows,
			grants: grantRows,
			deliveries: deliveryRows,
			repositories: repositoryRows.readable,
		};
	},
	activity: async ({ env }) => {
		const service = new AutomationService(env);
		return { section: 'activity', activity: await service.store.activity() };
	},
	security: async ({ env, actor }) => {
		const service = new AutomationService(env);
		const [keys, sessions] = await Promise.all([new Authenticators(env).list(actor), cliSessions(service)]);
		return { section: 'security', keys, cliSessions: sessions };
	},
} satisfies { [S in Section]: (context: LoaderContext) => Promise<{ section: S }> };

export type SectionView = Awaited<ReturnType<(typeof loaders)[Section]>>;
export type ViewOf<S extends Section> = Extract<SectionView, { section: S }>;

export function load(section: Section, context: LoaderContext): Promise<SectionView> {
	return loaders[section](context);
}
