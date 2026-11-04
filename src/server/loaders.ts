import { Authenticators } from '@/automation/auth.ts';
import { packageWatches } from '@/automation/package-watch.ts';
import { type AutomationBindings, AutomationService } from '@/automation/service.ts';
import type { Readable, UnreadableExecution, UnreadableRepository } from '@/automation/store.ts';
import type { Execution, RepositoryRecord } from '@/automation/types.ts';
import { parseGrant } from '@/automation/vault.ts';
import type { CLISessionRow } from '@/persistence/d1/cli-sessions.ts';
import type { ActiveCredential, DeliveryRow } from '@/persistence/d1/credentials.ts';
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

export type SecretSummary = ActiveCredential;
export type DeliverySummary = DeliveryRow;
export type CLISession = CLISessionRow;

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
function secrets(service: AutomationService): Promise<SecretSummary[]> {
	return service.credentials.active();
}
async function grants(service: AutomationService) {
	return (await service.credentials.grantDocuments()).map(parseGrant);
}
function deliveries(service: AutomationService): Promise<DeliverySummary[]> {
	return service.credentials.deliveries();
}
function cliSessions(service: AutomationService): Promise<CLISession[]> {
	return service.cliSessions.list();
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
