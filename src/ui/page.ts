import type { Execution, RepositoryRecord } from '../automation/types.ts';
import { renderActivity } from './templates/activity.ts';
import { renderCredentials } from './templates/credentials.ts';
import { renderExecutions } from './templates/executions.ts';
import { renderReleases } from './templates/releases.ts';
import { renderRepositories } from './templates/repositories.ts';

export function renderPage(
	repositories: RepositoryRecord[],
	executions: Execution[],
	nonce: string,
	script: string,
	style: string,
): string {
	const navigation = ['Repositories', 'Releases', 'Executions', 'Credentials', 'Activity'].map((name, index) =>
		`<button data-tab="${name.toLowerCase()}" aria-selected="${index === 0}">${name}</button>`
	).join('');
	return `<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1">
				<title>Beepboop · Releases</title>
				<style nonce="${nonce}">${style}</style>
			</head>
			<body>
				<header>
					<div><h1>Beepboop</h1><span class="muted">Release automation</span></div>
					<form action="/auth/logout" method="post"><button>Sign out</button></form>
				</header>
				<nav aria-label="Dashboard">${navigation}</nav>
				${renderRepositories(repositories)}
				${renderReleases(repositories, executions)}
				${renderExecutions(executions)}
				${renderCredentials()}
				${renderActivity()}
				<output id="feedback" hidden></output>
				<script nonce="${nonce}">${script}</script>
			</body>
		</html>`;
}
