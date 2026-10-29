import type { Execution } from '../../automation/types.ts';
import { htmlEscape } from './html.ts';

function publications(execution: Execution): string {
	if (!execution.publications.length) return '<p class="muted">Awaiting publication reports.</p>';
	const rows = execution.publications.map(publication => `
		<tr>
			<td>${htmlEscape(publication.manager)} · ${htmlEscape(publication.name)}</td>
			<td>${htmlEscape(publication.version)}</td>
			<td>${htmlEscape(publication.outcome)}${publication.required ? '' : ' (optional)'}</td>
		</tr>`).join('');
	return `
		<table>
			<thead><tr><th>Destination</th><th>Version</th><th>Result</th></tr></thead>
			<tbody>${rows}</tbody>
		</table>`;
}

function controls(execution: Execution): string {
	const id = htmlEscape(execution.id);
	if (execution.state === 'blocked' && execution.operation === 'promote') {
		return `<button data-approve="${id}" data-sha="${htmlEscape(execution.sourceSha)}">Approve this commit</button>`;
	}
	if (execution.workflow && ['failed', 'cancelled'].includes(execution.state)) {
		return `<button data-retry="${id}">Retry failed jobs</button>`;
	}
	if (execution.state === 'uncertain') return `<button data-reconcile="${id}">Reconcile outcome</button>`;
	return '';
}

function renderExecution(execution: Execution): string {
	const preparation = execution.managed?.result ?? execution.prepared?.result;
	const preparationLink = preparation?.url.startsWith('https://github.com/')
		? `<p><a href="${htmlEscape(preparation.url)}">Preparation pull request</a></p>`
		: '';
	const platform = execution.workflow?.platform;
	const target = platform
		? `<p>Target: ${htmlEscape([platform.os, platform.arch, platform.abi].filter(Boolean).join(' / '))}</p>`
		: '';
	const run = execution.runId
		? ` · <a href="https://github.com/${
			htmlEscape(execution.repository)
		}/actions/runs/${execution.runId}">Workflow run ${execution.runId}</a>`
		: '';
	const identity = JSON.stringify(
		{
			configurationSha: execution.configurationSha,
			workflowSha: execution.workflowSha,
			runAttempt: execution.runAttempt,
			artifacts: execution.artifacts,
			resolvedInputs: execution.resolvedInputs,
			releaseSet: execution.releaseSet,
			preparation,
		},
		null,
		2,
	);
	return `
		<article>
			<h3>${htmlEscape(execution.repository)} · ${htmlEscape(execution.stream)} / ${
		htmlEscape(execution.operation)
	}</h3>
			<span class="state">${htmlEscape(execution.state)}</span> ${htmlEscape(execution.version)}
			<p>${htmlEscape(execution.reason)}</p>
			${preparationLink}
			${execution.releaseSet ? `<p>Release group: ${htmlEscape(execution.releaseSet.group)}</p>` : ''}
			${target}
			<p>Source <code>${htmlEscape(execution.sourceSha)}</code>${run}</p>
			${publications(execution)}
			${controls(execution)}
			<details><summary>Artifacts and identity</summary><pre>${htmlEscape(identity)}</pre></details>
		</article>`;
}

export function renderExecutions(executions: Execution[]): string {
	return `
		<section id="executions" hidden>
			<h2>Executions</h2>
			${executions.map(renderExecution).join('') || '<p>No executions yet.</p>'}
		</section>`;
}
