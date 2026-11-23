import { Effect } from 'effect';
import { administrator } from '@/auth/admin.ts';
import { accessCookie, cookie, flowCookie, refreshCookie } from '@/auth/cookies.ts';
import { cliAuthRoute } from '@/auth/http/cli.ts';
import { AuthPages } from '@/auth/pages.ts';
import type { AuthBindings, AuthenticationDependencies } from '@/auth/service.ts';
import { fromJson, fromPromise, recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import { loginSecretPattern } from '@/kernel/schema/ids.ts';
import { record, text } from '@/kernel/schema/result.ts';

function cookieHeader(name: string, value: string, seconds: number): string {
	return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
const refreshSeconds = 60 * 60 * 24 * 30;
export interface SessionTokens {
	access: string;
	refresh: string;
	expiresIn: number;
}
function sessionHeaders(tokens: SessionTokens | undefined, location?: string): Headers {
	const headers = new Headers(location === undefined ? {} : { Location: location });
	headers.append('Set-Cookie', cookieHeader(accessCookie, tokens?.access ?? '', tokens?.expiresIn ?? 0));
	headers.append('Set-Cookie', cookieHeader(refreshCookie, tokens?.refresh ?? '', tokens ? refreshSeconds : 0));
	return headers;
}
export interface LoginCompletion {
	consumeFlow(id: string): Effect.Effect<string | undefined, DomainError>;
	exchange(code: string, verifier: string): Effect.Effect<SessionTokens, DomainError>;
	verify(access: string): Effect.Effect<string, DomainError>;
}
const loginFailed = Effect.fnUntraced(function*(reason: string) {
	const pages = yield* AuthPages;
	return new Response(pages.loginFailed(reason), {
		status: 401,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Set-Cookie': cookieHeader(flowCookie, '', 0),
		},
	});
});
export function returnPath(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
	const url = new URL(value, 'https://beepboop.invalid');
	return url.origin === 'https://beepboop.invalid' && !url.pathname.startsWith('/auth/')
		? `${url.pathname}${url.search}`
		: '/';
}
function loginTarget(cli: unknown, target: unknown): string {
	return typeof cli === 'string' && loginSecretPattern.test(cli)
		? `/auth/cli/authorize?challenge=${cli}`
		: returnPath(target);
}
export function completeLogin(
	request: Request,
	steps: LoginCompletion,
): Effect.Effect<Response, DomainError, AuthPages> {
	return Effect.gen(function*() {
		const id = cookie(request, flowCookie);
		if (!id) return yield* loginFailed('This sign-in link has no login attempt behind it. Cookies may be blocked.');
		const document = yield* steps.consumeFlow(id);
		if (!document) return new Response(null, { status: 302, headers: { Location: '/auth/login' } });
		return yield* Effect.gen(function*() {
			const flow = yield* Effect.fromResult(record(yield* fromJson(document)));
			const url = new URL(request.url);
			if (url.searchParams.get('state') !== flow.state) {
				return new Response(null, { status: 302, headers: { Location: '/auth/login' } });
			}
			const code = yield* Effect.fromResult(text(url.searchParams.get('code')));
			const verifier = yield* Effect.fromResult(text(flow.verifier));
			const tokens = yield* steps.exchange(code, verifier);
			yield* steps.verify(tokens.access);
			return new Response(null, { status: 302, headers: sessionHeaders(tokens, loginTarget(flow.cli, flow.return)) });
		}).pipe(recover(error => loginFailed(decodeError(error))));
	});
}
export function authRoute(
	request: Request,
	env: AuthBindings,
	dependencies: AuthenticationDependencies,
): Effect.Effect<Response | undefined, DomainError, AuthPages> {
	return Effect.gen(function*() {
		const path = new URL(request.url).pathname;
		if (path.startsWith('/auth/cli/')) {
			return yield* cliAuthRoute(request, env, request => administrator(request, env, dependencies), dependencies);
		}
		const renew: Effect.Effect<SessionTokens | undefined> = Effect.gen(function*() {
			const refresh = cookie(request, refreshCookie);
			if (!refresh || refresh.length > 4096) return undefined;
			const result = yield* fromPromise(signal => dependencies.client(signal).refresh(refresh)).pipe(
				Effect.orElseSucceed(() => undefined),
			);
			if (!result || result.err || !result.tokens) return undefined;
			const tokens = result.tokens;
			const verified = yield* administrator(
				new Request(`${env.APPLICATION_ORIGIN}/`, { headers: { Cookie: `${accessCookie}=${tokens.access}` } }),
				env,
				dependencies,
			).pipe(Effect.catch(() => Effect.undefined));
			return verified ? { access: tokens.access, refresh: tokens.refresh, expiresIn: tokens.expiresIn } : undefined;
		});
		if (path === '/auth/renew' && request.method === 'POST') {
			if (request.headers.get('origin') !== env.APPLICATION_ORIGIN) {
				return Response.json({ error: 'Invalid request origin' }, { status: 403 });
			}
			const tokens = yield* renew;
			return new Response(null, { status: tokens ? 204 : 401, headers: sessionHeaders(tokens) });
		}
		if (path === '/auth/login') {
			const parameters = new URL(request.url).searchParams;
			const renewed = yield* renew;
			if (renewed) {
				return new Response(null, {
					status: 302,
					headers: sessionHeaders(renewed, loginTarget(parameters.get('cli'), parameters.get('return'))),
				});
			}
			const { url, challenge } = yield* fromPromise(signal =>
				dependencies.client(signal).authorize(`${env.APPLICATION_ORIGIN}/auth/callback`, 'code', { pkce: true })
			);
			const id = crypto.randomUUID();
			yield* dependencies.sessions.open('login-flow', id, {
				...challenge,
				cli: parameters.get('cli'),
				return: returnPath(parameters.get('return')),
			}, 600000);
			return new Response(null, {
				status: 302,
				headers: { Location: url, 'Set-Cookie': cookieHeader(flowCookie, id, 600) },
			});
		}
		if (path === '/auth/callback') {
			return yield* completeLogin(request, {
				consumeFlow: id => dependencies.sessions.take(id),
				exchange: (code, verifier) =>
					Effect.gen(function*() {
						const result = yield* fromPromise(signal =>
							dependencies.client(signal).exchange(code, `${env.APPLICATION_ORIGIN}/auth/callback`, verifier)
						).pipe(Effect.orElseSucceed(() => undefined));
						if (!result || result.err) return yield* precondition('Login exchange failed');
						return {
							access: result.tokens.access,
							refresh: result.tokens.refresh,
							expiresIn: result.tokens.expiresIn,
						};
					}),
				verify: access =>
					administrator(
						new Request(`${env.APPLICATION_ORIGIN}/`, { headers: { Cookie: `${accessCookie}=${access}` } }),
						env,
						dependencies,
					),
			});
		}
		if (path === '/auth/logout' && request.method === 'POST') {
			return yield* signOut(
				request,
				env.APPLICATION_ORIGIN,
				refresh => fromPromise(signal => dependencies.client(signal).revoke(refresh)),
			);
		}
		return undefined;
	});
}
export function signOut(
	request: Request,
	origin: string,
	revoke: (refresh: string) => Effect.Effect<void, DomainError>,
): Effect.Effect<Response> {
	return Effect.gen(function*() {
		if (request.headers.get('origin') !== origin) {
			return Response.json({ error: 'Invalid request origin' }, { status: 403 });
		}
		const refresh = cookie(request, refreshCookie);
		if (refresh && refresh.length <= 4096) {
			yield* revoke(refresh).pipe(logRecovered('auth.revoke_failed'));
		}
		return new Response(null, { status: 303, headers: sessionHeaders(undefined, '/auth/login') });
	});
}
