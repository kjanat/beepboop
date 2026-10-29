import type { RepositoryRecord } from '../../automation/types.ts';
import { htmlEscape } from './html.ts';

function renderRepository(repository: RepositoryRecord): string {
	const packages = repository.inventory.packages.map(pkg => `
		<tr>
			<td>${htmlEscape(pkg.name)}</td>
			<td>${htmlEscape(pkg.version)}</td>
			<td>${htmlEscape(pkg.manager)}</td>
		</tr>`).join('');
	const workflows = repository.inventory.workflows.map(workflow =>
		`<li>${htmlEscape(workflow.file)} — ${htmlEscape(workflow.events.join(', '))}</li>`
	).join('');
	const diagnostics = (messages: string[]) => messages.map(message => `<p>${htmlEscape(message)}</p>`).join('');
	return `
		<article>
			<h3>${htmlEscape(repository.name)}</h3>
			<p>${htmlEscape(repository.inventory.managers.join(' · '))}</p>
			<p>${repository.configuration ? 'Configuration discovered' : 'Awaiting onboarding'} ·
				<code>${htmlEscape(repository.sha.slice(0, 12))}</code>
			</p>
			${diagnostics(repository.diagnostics)}
			<details>
				<summary>${repository.inventory.packages.length} packages · ${repository.inventory.workflows.length} workflows</summary>
				<table>
					<thead><tr><th>Package</th><th>Version</th><th>Manager</th></tr></thead>
					<tbody>${packages}</tbody>
				</table>
				<ul>${workflows}</ul>
				${diagnostics(repository.inventory.diagnostics)}
			</details>
		</article>`;
}

export function renderRepositories(repositories: RepositoryRecord[]): string {
	return `
		<section id="repositories">
			<h2>Repositories</h2>
			<form id="discover">
				<label>Repository<input name="repository" placeholder="owner/repository" required></label>
				<button name="action" value="discover">Inspect</button>
				<button name="action" value="onboard">Open onboarding PR</button>
			</form>
			${
		repositories.map(renderRepository).join('') || '<p>No repositories enrolled. Inspect a repository to begin.</p>'
	}
		</section>`;
}
