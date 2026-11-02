import { script, style } from '../ui/dist/assets.ts';
import { renderPage } from '../ui/page.ts';
import type { Execution, RepositoryRecord } from './types.ts';

export function renderDashboard(
	repositories: RepositoryRecord[],
	executions: Execution[],
	onboarding: ReadonlyMap<number, string> = new Map(),
): Response {
	const nonce = crypto.randomUUID();
	const page = renderPage(repositories, executions, onboarding, nonce, script, style);
	return new Response(page, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Content-Security-Policy':
				`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
			'Referrer-Policy': 'same-origin',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}
