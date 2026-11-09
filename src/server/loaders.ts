import { Effect } from 'effect';
import { Authenticators } from '@/automation/auth.ts';
import { packageWatches } from '@/automation/package-watch.ts';
import type { AutomationBindings } from '@/automation/service.ts';
import { AutomationService } from '@/automation/service.ts';
import type { Readable, UnreadableExecution, UnreadableRepository } from '@/automation/store.ts';
import type { Execution, RepositoryRecord } from '@/automation/types.ts';
import { parseGrant } from '@/automation/vault.ts';
import type { DomainError } from '@/contract/errors';
import { recover } from '@/failure';
import type { CLISessionRow } from '@/persistence/d1/cli-sessions.ts';
import type { ActiveCredential, DeliveryRow } from '@/persistence/d1/credentials.ts';
import type { Section } from '@/server/sections.ts';

export interface LoaderContext {
	env: AutomationBindings;
	actor: string;
}

export type Panel<T> = { kind: 'loaded'; value: T } | { kind: 'failed' };

export function panel<T>(name: string, work: Effect.Effect<T, DomainError>): Effect.Effect<Panel<T>> {
	return work.pipe(
		Effect.map((value): Panel<T> => ({ kind: 'loaded', value })),
		recover(error =>
			Effect.sync((): Panel<T> => {
				console.error('dashboard panel failed', name, error);
				return { kind: 'failed' };
			})
		),
	);
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

function repositories(
	service: AutomationService,
): Effect.Effect<Rows<RepositoryRecord, UnreadableRepository>, DomainError> {
	return service.store.readRepositories().pipe(Effect.map(split));
}
function executions(service: AutomationService): Effect.Effect<Rows<Execution, UnreadableExecution>, DomainError> {
	return service.store.readExecutions().pipe(Effect.map(split));
}
function grants(service: AutomationService) {
	return service.credentials.grantDocuments().pipe(
		Effect.flatMap(documents => Effect.forEach(documents, parseGrant)),
	);
}
const concurrent = { concurrency: 'unbounded' } as const;

export const loaders = {
	overview: ({ env }) => {
		const service = new AutomationService(env);
		return Effect.all([repositories(service), executions(service)], concurrent).pipe(
			Effect.map(([repositoryRows, executionRows]) => ({
				section: 'overview' as const,
				repositories: repositoryRows,
				executions: executionRows,
			})),
		);
	},
	repositories: ({ env }) => {
		const service = new AutomationService(env);
		return Effect.all([
			repositories(service),
			service.store.onboardingPulls(),
			panel('winget-latest', service.winget().latestByRepository()),
		], concurrent).pipe(
			Effect.map(([repositoryRows, onboarding, latestWinget]) => ({
				section: 'repositories' as const,
				repositories: repositoryRows,
				onboarding,
				latestWinget,
			})),
		);
	},
	packages: ({ env }) =>
		Effect.gen(function*() {
			const service = new AutomationService(env);
			const notifications = service.notifications();
			const [repositoryRows, destinations, subscriptions] = yield* Effect.all([
				repositories(service),
				notifications.destinations(),
				notifications.subscriptions(),
			], concurrent);
			return {
				section: 'packages' as const,
				packages: yield* packageWatches(service.store, repositoryRows.readable),
				destinations,
				subscriptions,
			};
		}),
	notifications: ({ env, actor }) => {
		const service = new AutomationService(env);
		const notifications = service.notifications();
		return Effect.all([
			new Authenticators(env).list(actor),
			service.credentials.active(),
			notifications.destinations(),
			notifications.subscriptions(),
			notifications.recent(),
		], concurrent).pipe(
			Effect.map(([keys, secretRows, destinations, subscriptions, deliveries]) => ({
				section: 'notifications' as const,
				keys,
				secrets: secretRows,
				destinations,
				subscriptions,
				notifications: deliveries,
			})),
		);
	},
	releases: ({ env }) => {
		const service = new AutomationService(env);
		return Effect.all([repositories(service), executions(service)], concurrent).pipe(
			Effect.map(([repositoryRows, executionRows]) => ({
				section: 'releases' as const,
				repositories: repositoryRows.readable,
				executions: executionRows.readable,
			})),
		);
	},
	runs: ({ env }) =>
		executions(new AutomationService(env)).pipe(
			Effect.map(executionRows => ({ section: 'runs' as const, executions: executionRows })),
		),
	winget: ({ env }) => {
		const service = new AutomationService(env);
		return Effect.all([repositories(service), panel('winget-submissions', service.winget().list())], concurrent).pipe(
			Effect.map(([repositoryRows, submissions]) => ({
				section: 'winget' as const,
				repositories: repositoryRows.readable,
				submissions,
				ready: service.winget().setup(),
			})),
		);
	},
	secrets: ({ env, actor }) => {
		const service = new AutomationService(env);
		return Effect.all([
			new Authenticators(env).list(actor),
			service.credentials.active(),
			grants(service),
			service.credentials.deliveries(),
			repositories(service),
		], concurrent).pipe(
			Effect.map(([keys, secretRows, grantRows, deliveryRows, repositoryRows]) => ({
				section: 'secrets' as const,
				keys,
				secrets: secretRows,
				grants: grantRows,
				deliveries: deliveryRows,
				repositories: repositoryRows.readable,
			})),
		);
	},
	activity: ({ env }) =>
		new AutomationService(env).store.activity().pipe(
			Effect.map(activity => ({ section: 'activity' as const, activity })),
		),
	security: ({ env, actor }) => {
		const service = new AutomationService(env);
		return Effect.all([new Authenticators(env).list(actor), service.cliSessions.list()], concurrent).pipe(
			Effect.map(([keys, sessions]) => ({ section: 'security' as const, keys, cliSessions: sessions })),
		);
	},
} satisfies { [S in Section]: (context: LoaderContext) => Effect.Effect<{ section: S }, DomainError> };

export type SectionView = Effect.Success<ReturnType<(typeof loaders)[Section]>>;
export type ViewOf<S extends Section> = Extract<SectionView, { section: S }>;

export function load(section: Section, context: LoaderContext): Effect.Effect<SectionView, DomainError> {
	return loaders[section](context);
}
