import { Effect, Option, Schema } from 'effect';
import { fromPromise, toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { responseJson } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { decode } from '@/kernel/schema/result.ts';
import { looseStruct, mutableArray, safeDecode } from '@/kernel/schema/structs.ts';
import { listed } from '@/kernel/text/listing.ts';

export interface GitHubOutage {
	description: string;
	incidents: { name: string; status: string; url: string }[];
	components: { name: string; status: string }[];
	page: string;
	source: string;
}

const page = 'https://github-up.kjanat.dev';
const source = 'https://www.githubstatus.com';

const statusSummary = looseStruct({
	components: mutableArray(looseStruct({ name: Schema.String, status: Schema.String, group: Schema.Boolean })),
	incidents: mutableArray(looseStruct({ name: Schema.String, status: Schema.String, shortlink: Schema.String })),
});

export function fetchOutage(transport: Fetcher): Effect.Effect<GitHubOutage | undefined, DomainError> {
	return fromPromise(signal => transport('https://www.githubstatus.com/api/v2/summary.json', { signal })).pipe(
		Effect.flatMap(response => responseJson(response).pipe(Effect.mapError(toDomainError))),
		Effect.flatMap(value => Effect.fromResult(decode(statusSummary, value))),
		Effect.timeoutOption('3 seconds'),
		Effect.map(Option.getOrUndefined),
		Effect.map(result => result ? outageFrom(result) : undefined),
	);
}

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
