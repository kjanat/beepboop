import { defineMiddleware } from 'astro:middleware';
import { Effect } from 'effect';
import { administrator } from '@/automation/auth.ts';
import { Automation, applicationLayer } from '@/automation/service';
import { failure } from '@/failure';
import { jsonLogging } from '@/runtime/logging';
import { bindings } from '@/server/bindings.ts';
import { dashboardPaths } from '@/server/sections.ts';

export const onRequest = defineMiddleware(async (context, next) => {
	if (dashboardPaths.has(context.url.pathname.replace(/\/$/, '') || '/')) {
		const refused = await Effect.runPromise(
			bindings.pipe(
				Effect.flatMap(env =>
					Effect.flatMap(Automation, service => administrator(context.request, env, service.authentication)).pipe(
						Effect.provide(applicationLayer(env)),
					)
				),
				Effect.flatMap(actor =>
					Effect.sync(() => {
						context.locals.actor = actor;
					})
				),
				Effect.as(undefined),
				Effect.catchTag('DomainError', error =>
					error.problem.code === 'unauthenticated'
						? Effect.succeed(context.redirect(
							`/auth/login?return=${encodeURIComponent(`${context.url.pathname}${context.url.search}`)}`,
							302,
						))
						: failure(context.request, error)),
				Effect.provide(jsonLogging),
			),
		);
		if (refused) return refused;
	}
	const response = await next();
	response.headers.set('Cache-Control', 'no-store');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	// Vite injects stylesheet modules as <style> elements during development.
	// Built pages load external CSS and retain the stricter production policy.
	const styleSource = import.meta.env.DEV ? "'self' 'unsafe-inline'" : "'self'";
	const connectSource = import.meta.env.DEV
		? `'self' ${context.url.protocol === 'https:' ? 'wss:' : 'ws:'}//${context.url.host}`
		: "'self'";
	response.headers.set(
		'Content-Security-Policy',
		`default-src 'self'; script-src 'self'; style-src ${styleSource}; img-src 'self' data:; connect-src ${connectSource}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
	);
	return response;
});
