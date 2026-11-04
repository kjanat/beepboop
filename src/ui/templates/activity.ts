import type { ActivityEntry, RepositoryRecord } from '@/automation/types';
import { githubHref } from '@/contract/links';
import { htmlEscape, link } from '@/ui/templates/html';

function repositoryLink(name: string): string {
	return link(githubHref(name), name);
}

function runRepository(entry: ActivityEntry): string | undefined {
	return /^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)/.exec(entry.target)?.[1];
}

function actor(entry: ActivityEntry): string {
	const run = /^run:(\d+)$/.exec(entry.actor)?.[1];
	if (!run) return 'Administrator';
	const repository = runRepository(entry);
	return repository
		? link(githubHref(repository, 'actions', 'runs', run), `Workflow run ${run}`)
		: htmlEscape(`Workflow run ${run}`);
}

function target(entry: ActivityEntry, names: ReadonlyMap<number, string>): string {
	if (entry.action === 'repository.onboard') {
		const name = names.get(Number(entry.target));
		return name ? repositoryLink(name) : htmlEscape(entry.target);
	}
	if (entry.action === 'token.issued') {
		const [repository = '', permissions = ''] = entry.target.split(' ');
		return `${repositoryLink(repository)} <span class="muted">${htmlEscape(permissions)}</span>`;
	}
	if (entry.target.startsWith('https://')) return link(entry.target, entry.target);
	return htmlEscape(entry.target);
}

export function renderActivityRows(entries: ActivityEntry[], repositories: RepositoryRecord[]): string {
	if (entries.length === 0) return '<tr><td colspan="4">No activity yet.</td></tr>';
	const names = new Map(repositories.map(repository => [repository.id, repository.name]));
	return entries.map(entry => {
		const time = new Date(entry.createdAt).toISOString();
		return `<tr>
			<td><time datetime="${time}">${time.slice(0, 19).replace('T', ' ')} UTC</time></td>
			<td><code>${htmlEscape(entry.action)}</code></td>
			<td>${actor(entry)}</td>
			<td>${target(entry, names)}</td>
		</tr>`;
	}).join('');
}
