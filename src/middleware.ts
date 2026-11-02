import { defineMiddleware } from 'astro:middleware';
import { administrator } from '@/automation/auth.ts';
import { bindings } from '@/server/bindings.ts';

const pages = new Set(['/', '/repositories', '/releases', '/runs', '/secrets', '/activity', '/security']);
export const onRequest = defineMiddleware(async (context, next) => {
	if (pages.has(context.url.pathname.replace(/\/$/, '') || '/')) {
		try {
			context.locals.actor = await administrator(context.request, bindings());
		} catch {
			return context.redirect('/auth/login', 302);
		}
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
