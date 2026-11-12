import { Effect } from 'effect';
import { packageWatches } from '@/automation/package-watch.ts';
import type { Automation, AutomationBindings, AutomationService } from '@/automation/service.ts';
import { withAutomation } from '@/automation/service.ts';
import type { Readable, UnreadableExecution, UnreadableRepository } from '@/automation/store.ts';
import { readableValues } from '@/automation/store.ts';
import type { Execution, RepositoryRecord } from '@/automation/types.ts';
import { parseGrant } from '@/automation/vault.ts';
import type { DomainError } from '@/contract/errors';
import { recover } from '@/failure';
import type { CLISessionRow } from '@/persistence/d1/cli-sessions.ts';
import type { ActiveCredential, DeliveryRow } from '@/persistence/d1/credentials.ts';
import { ioConcurrency } from '@/runtime/policy';
import type { Section } from '@/server/sections.ts';

export interface LoaderContext {
	env: AutomationBindings;
	actor: string;
	repository?: string;
}

export type Panel<T> = { kind: 'loaded'; value: T } | { kind: 'failed' };

export function panel<T, R>(name: string, work: Effect.Effect<T, DomainError, R>): Effect.Effect<Panel<T>, never, R> {
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
		readable: readableValues(rows),
		unreadable: rows.flatMap(row => row.kind === 'unreadable' ? [row] : []),
	};
}

function repositories(
	service: AutomationService,
): Effect.Effect<Rows<RepositoryRecord, UnreadableRepository>, DomainError> {
	return service.store.readRepositories().pipe(Effect.map(split));
}
function executions(
	service: AutomationService,
	repositoryId?: number,
): Effect.Effect<Rows<Execution, UnreadableExecution>, DomainError> {
	return service.store.readExecutions(repositoryId).pipe(Effect.map(split));
}
function grants(service: AutomationService) {
	return service.credentials.grantDocuments().pipe(
		Effect.flatMap(documents => Effect.forEach(documents, parseGrant)),
	);
}
const concurrent = { concurrency: ioConcurrency } as const;

export const loaders = {
	overview: (_context) => withAutomation(service => {
		return Effect.all([repositories(service), executions(service)], concurrent).pipe(
			Effect.map(([repositoryRows, executionRows]) => ({
				section: 'overview' as const,
				repositories: repositoryRows,
				executions: executionRows,
			})),
		);
	}),
	repositories: (_context) => withAutomation(service => {
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
	}),
	packages: (_context) =>
		withAutomation(service => Effect.gen(function*() {
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
		})),
	notifications: ({ actor }) => withAutomation(service => {
		const notifications = service.notifications();
		return Effect.all([
			service.authentication.authenticators.list(actor),
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
	}),
	releases: (_context) => withAutomation(service => {
		return Effect.all([repositories(service), service.store.succeededExecutions()], concurrent).pipe(
			Effect.map(([repositoryRows, succeeded]) => ({
				section: 'releases' as const,
				repositories: repositoryRows.readable,
				executions: succeeded,
			})),
		);
	}),
	runs: ({ repository }) => withAutomation(service => Effect.clockWith(clock => {
		return repositories(service).pipe(
			Effect.flatMap(repositoryRows => {
				const selected = repositoryRows.readable.find(entry => entry.name === repository);
				return executions(service, selected?.id).pipe(
					Effect.map(executionRows => ({
						section: 'runs' as const,
						now: clock.currentTimeMillisUnsafe(),
						executions: executionRows,
						repositories: repositoryRows.readable.map(entry => entry.name).sort(),
						selected: selected?.name,
					})),
				);
			}),
		);
	})),
	winget: (_context) => withAutomation(service => {
		return Effect.all([repositories(service), panel('winget-submissions', service.winget().list())], concurrent).pipe(
			Effect.map(([repositoryRows, submissions]) => ({
				section: 'winget' as const,
				repositories: repositoryRows.readable,
				submissions,
				ready: service.winget().setup(),
			})),
		);
	}),
	secrets: ({ actor }) => withAutomation(service => {
		return Effect.all([
			service.authentication.authenticators.list(actor),
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
	}),
	activity: (_context) =>
		withAutomation(service =>
			service.store.activity().pipe(
				Effect.map(activity => ({ section: 'activity' as const, activity })),
			)
		),
	security: ({ actor }) => withAutomation(service => {
		return Effect.all([service.authentication.authenticators.list(actor), service.cliSessions.list()], concurrent).pipe(
			Effect.map(([keys, sessions]) => ({ section: 'security' as const, keys, cliSessions: sessions })),
		);
	}),
} satisfies { [S in Section]: (context: LoaderContext) => Effect.Effect<{ section: S }, DomainError, Automation> };

export type SectionView = Effect.Success<ReturnType<(typeof loaders)[Section]>>;
export type ViewOf<S extends Section> = Extract<SectionView, { section: S }>;

export function load(section: Section, context: LoaderContext): Effect.Effect<SectionView, DomainError, Automation> {
	return loaders[section](context);
}
