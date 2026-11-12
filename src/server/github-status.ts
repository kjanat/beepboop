import { Effect, Option, Schema, Semaphore } from 'effect';
import { checkGitHub } from 'github-up/browser';
import { listed } from '@/automation/setup-summary';
import type { DomainError } from '@/contract/errors';
import { fromPromise } from '@/failure';
import { looseStruct, mutableArray, safeDecode } from '@/schema';

export interface GitHubOutage {
	description: string;
	incidents: { name: string; status: string; url: string }[];
	components: { name: string; status: string }[];
	page: string;
	source: string;
}

const page = 'https://github-up.kjanat.dev';
const source = 'https://www.githubstatus.com';

let latest: { at: number; outage: GitHubOutage | undefined } | undefined;
const refreshing = Semaphore.makeUnsafe(1);

export function knownOutage(): GitHubOutage | undefined {
	return latest?.outage;
}

export const refreshOutage: Effect.Effect<void, DomainError> = Semaphore.withPermit(
	refreshing,
	Effect.clockWith(clock =>
		latest && clock.currentTimeMillisUnsafe() - latest.at < 60_000
			? Effect.void
			: check.pipe(Effect.flatMap(outage =>
				Effect.sync(() => {
					latest = { at: clock.currentTimeMillisUnsafe(), outage };
				})
			))
	),
);

export const githubOutage: Effect.Effect<GitHubOutage | undefined, DomainError> = refreshOutage.pipe(
	Effect.map(knownOutage),
);

const check: Effect.Effect<GitHubOutage | undefined, DomainError> = Effect.gen(function*() {
	const result = yield* fromPromise(() => checkGitHub()).pipe(
		Effect.timeoutOption('3 seconds'),
		Effect.map(Option.getOrUndefined),
	);
	return result?.kind === 'ok' ? outageFrom(result.summary) : undefined;
});

const reliedOn: ReadonlySet<string> = new Set([
	'Git Operations',
	'API Requests',
	'Webhooks',
	'Pull Requests',
	'Actions',
	'Packages',
	'Pages',
]);
const scoped = looseStruct({ components: Schema.optional(mutableArray(looseStruct({ name: Schema.String }))) });

export interface StatusSummary {
	components: readonly { name: string; status: string; group: boolean }[];
	incidents: readonly { name: string; status: string; shortlink: string }[];
}

export function outageFrom(summary: StatusSummary): GitHubOutage | undefined {
	const components = summary.components
		.filter(component => !component.group && component.status !== 'operational' && reliedOn.has(component.name))
		.map(component => ({ name: component.name, status: component.status.replaceAll('_', ' ') }));
	const affecting = summary.incidents.flatMap(incident => {
		if (incident.status === 'resolved' || incident.status === 'postmortem') return [];
		const named = safeDecode(scoped, incident).data?.components?.map(component => component.name) ?? [];
		const relied = named.filter(name => reliedOn.has(name));
		return named.length && !relied.length ? [] : [{ incident, relied }];
	});
	if (!components.length && !affecting.length) return undefined;
	const names = [
		...new Set([...components.map(component => component.name), ...affecting.flatMap(entry => entry.relied)]),
	];
	return {
		description: names.length
			? `GitHub reports problems with ${listed(names)}`
			: 'GitHub reports an incident without naming the services it affects',
		incidents: affecting.map(({ incident }) => ({
			name: incident.name,
			status: incident.status,
			url: incident.shortlink,
		})),
		components,
		page,
		source,
	};
}

export function outageLine(outage: GitHubOutage): string {
	const parts = [
		...outage.incidents.map(incident => `${incident.name} (${incident.status})`),
		...(outage.components.length
			? [`affected: ${outage.components.map(component => `${component.name} ${component.status}`).join(', ')}`]
			: []),
	];
	return `${outage.description}: ${parts.join('; ')}. ${outage.page} (${outage.source})`.replace(
		/[^\x20-\x7e]/g,
		' ',
	);
}
