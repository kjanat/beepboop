import type { RepositoryRecord } from '../../automation/types.ts';
import { githubHref, htmlEscape, link, registryHref } from './html.ts';

function renderRepository(repository: RepositoryRecord, pull: string | undefined): string {
	const packages = repository.inventory.packages.map(pkg => {
		const version = pkg.published ?? pkg.version;
		const registry = pkg.publish && version !== undefined
			? registryHref(pkg.manager, pkg.name, version, repository.name)
			: undefined;
		const shown = version === undefined ? 'unreleased' : registry ? link(registry, version) : htmlEscape(version);
		const manifest = pkg.published !== undefined && pkg.version !== undefined && pkg.version !== pkg.published
			? ` <small>manifest ${htmlEscape(pkg.version)}</small>`
			: '';
		return `
		<tr>
			<td>${link(githubHref(repository.name, 'blob', repository.sha, pkg.manifest), pkg.name)}</td>
			<td>${shown}${manifest}</td>
			<td>${htmlEscape(pkg.manager)}</td>
		</tr>`;
	}).join('');
	const workflows = repository.inventory.workflows.map(workflow =>
		`<li>${
			link(githubHref(repository.name, 'blob', repository.sha, '.github/workflows', workflow.file), workflow.file)
		} — ${htmlEscape(workflow.events.join(', '))}</li>`
	).join('');
	const diagnostics = (messages: string[]) => messages.map(message => `<p>${htmlEscape(message)}</p>`).join('');
	return `
		<article>
			<h3>${link(githubHref(repository.name), repository.name)}</h3>
			<p>${htmlEscape(repository.inventory.managers.join(' · '))}</p>
			<p>${repository.configuration ? 'Configuration discovered' : 'Awaiting onboarding'} ·
				<code>${link(githubHref(repository.name, 'commit', repository.sha), repository.sha.slice(0, 12))}</code>
			</p>
			${diagnostics(repository.diagnostics)}
			${
		repository.configuration
			? ''
			: pull
			? `<p>Onboarding PR: <a href="${htmlEscape(pull)}">${htmlEscape(pull)}</a></p>`
			: `<p data-onboarding="${repository.id}"><button data-onboard="${
				htmlEscape(repository.name)
			}" data-repository-id="${repository.id}">Open onboarding PR</button></p>`
	}
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

export function renderRepositories(
	repositories: RepositoryRecord[],
	onboarding: ReadonlyMap<number, string>,
): string {
	return `
		<section id="repositories">
			<h2>Repositories</h2>
			<form id="discover">
				<label>Repository<input name="repository" placeholder="owner/repository" required></label>
				<button name="action" value="discover">Inspect</button>
				<button name="action" value="onboard">Open onboarding PR</button>
			</form>
			${
		repositories.map(repository => renderRepository(repository, onboarding.get(repository.id))).join('')
		|| '<p>No repositories enrolled. Inspect a repository to begin.</p>'
	}
		</section>`;
}
