import type { Configuration, Operation } from '#model';

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
	);
export function dashboard(
	configuration: Configuration,
	operations: Operation[],
	discovery: { routeId: string; healthy: boolean; updatedAt: number }[],
): Response {
	const cards = configuration.routes
		.map((route) => {
			const health = discovery.find((entry) => entry.routeId === route.id);
			const entries = operations
				.filter((operation) => operation.routeId === route.id)
				.sort((a, b) => b.updatedAt - a.updatedAt);
			return `<section><h2>${escapeHtml(route.id)}</h2><p>${escapeHtml(route.source.name)} · ${
				escapeHtml(
					route.channel ?? 'stable',
				)
			} · ${route.mode === 'observe' ? 'Publication tracking' : escapeHtml(route.destination.name)}</p><p>${
				route.enabled === false
					? 'Disabled — awaiting activation'
					: !health
					? 'Discovery pending'
					: health.healthy
					? 'Discovery healthy'
					: 'Discovery unavailable'
			}</p>${
				entries.length
					? entries
						.map(
							(operation) =>
								`<article><h3>${escapeHtml(operation.release.tag)} <span>${
									escapeHtml(
										operation.state,
									)
								}</span></h3><p>Checked ${escapeHtml(new Date(operation.updatedAt).toISOString())}</p>${
									'reason' in operation ? `<p>${escapeHtml(operation.reason)}</p>` : ''
								}<ul>${
									(operation.checks ?? [])
										.map(
											(check) =>
												`<li>${escapeHtml(check.name)}: <strong>${escapeHtml(check.state)}</strong>${
													check.url
														&& /^https:\/\/(github\.com|registry\.npmjs\.org|crates\.io|pypi\.org)\//.test(
															check.url,
														)
														? ` <a href="${escapeHtml(check.url)}">Evidence</a>`
														: ''
												}</li>`,
										)
										.join('')
								}</ul>${
									'runId' in operation && operation.runId
										? `<a href="https://github.com/${
											escapeHtml(
												route.destination.name,
											)
										}/actions/runs/${operation.runId}">Delivery run</a>`
										: ''
								}</article>`,
						)
						.join('')
					: '<p>No eligible release observed.</p>'
			}</section>`;
		})
		.join('');
	return new Response(
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beepboop releases</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:0 24px;background:#101820;color:#edf4f5}h1{font-size:40px}section{border-top:1px solid #49616a;padding:20px 0}article{background:#1c2a33;padding:16px;margin:12px 0}a{color:#8be6cf}span{font-size:16px;color:#8be6cf}li{margin:8px 0}p{color:#c3d3d8}</style><h1>Beepboop</h1><p>Release publication and delivery. Refresh to see the latest recorded evidence.</p>${
			configuration.enabled ? '' : '<p>Service disabled.</p>'
		}${cards}</html>`,
		{
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store',
				'Content-Security-Policy':
					"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
				'X-Content-Type-Options': 'nosniff',
			},
		},
	);
}
