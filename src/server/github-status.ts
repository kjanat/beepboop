import { checkGitHub } from 'github-up/browser';

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
let pending: Promise<void> | undefined;

export function knownOutage(): GitHubOutage | undefined {
	return latest?.outage;
}

export async function githubOutage(): Promise<GitHubOutage | undefined> {
	await refreshOutage();
	return knownOutage();
}

export function refreshOutage(): Promise<void> {
	if (latest && Date.now() - latest.at < 60_000) return Promise.resolve();
	pending ??= check().then(outage => {
		latest = { at: Date.now(), outage };
	}).finally(() => {
		pending = undefined;
	});
	return pending;
}

async function check(): Promise<GitHubOutage | undefined> {
	const result = await Promise.race([
		checkGitHub(),
		new Promise<undefined>(resolve => setTimeout(resolve, 3000)),
	]);
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
}

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
