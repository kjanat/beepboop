import { Effect, Option, Semaphore } from 'effect';
import { checkGitHub } from 'github-up/browser';
import type { DomainError } from '@/contract/errors';
import { fromPromise } from '@/failure';

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
	Effect.suspend(() =>
		latest && Date.now() - latest.at < 60_000
			? Effect.void
			: check.pipe(Effect.flatMap(outage =>
				Effect.sync(() => {
					latest = { at: Date.now(), outage };
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
	if (result?.kind !== 'ok') return undefined;
	const { summary } = result;
	const components = summary.components
		.filter(component => !component.group && component.status !== 'operational')
		.map(component => ({ name: component.name, status: component.status.replaceAll('_', ' ') }));
	const incidents = summary.incidents.map(incident => ({
		name: incident.name,
		status: incident.status,
		url: incident.shortlink,
	}));
	if (!components.length && !incidents.length) return undefined;
	return { description: summary.status.description, incidents, components, page, source };
});

export function outageLine(outage: GitHubOutage): string {
	const parts = [
		...outage.incidents.map(incident => `${incident.name} (${incident.status})`),
		...(outage.components.length
			? [`affected: ${outage.components.map(component => `${component.name} ${component.status}`).join(', ')}`]
			: []),
	];
	return `GitHub ${outage.description}: ${parts.join('; ')}. ${outage.page} (${outage.source})`.replace(
		/[^\x20-\x7e]/g,
		' ',
	);
}
