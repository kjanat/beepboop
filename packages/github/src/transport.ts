import { Clock, Context, Data, Effect, Layer } from 'effect';
import { legacyDiagnostic } from '@/kernel/errors/diagnostics.ts';
import { DomainError, domainError, invalid, upstream } from '@/kernel/errors/domain-error.ts';
import { responseJson, responseText, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { parseRetryAfter } from '@/kernel/http/http-date.ts';
import { retryTransient } from '@/kernel/http/retry.ts';

export const githubApiVersion = '2026-03-10';

// GitHub signals a rate limit by GraphQL error type RATE_LIMITED with HTTP 200, or by HTTP 403 or 429 naming the limit.
export function rateLimited(message: string, type?: string): boolean {
	return type === 'RATE_LIMITED' || /rate limit|HTTP 429/i.test(message);
}
function detailOf(body: string): string {
	try {
		const parsed: unknown = JSON.parse(body);
		return typeof parsed === 'object' && parsed !== null && 'message' in parsed
			? String(parsed.message)
			: body.slice(0, 200);
	} catch {
		return body.slice(0, 200);
	}
}

class ServerError extends Data.TaggedError('ServerError')<{ readonly message: string }> {}

export class GitHubRejection extends DomainError {
	constructor(readonly status: number, message: string, readonly retryAt?: number) {
		super({ problem: { code: 'precondition', diagnostics: [legacyDiagnostic(message)] }, message });
	}
}

export const gitHubRequest = Effect.fn('GitHub.request')(function*(
	transport: Fetcher,
	path: string,
	token: string,
	method = 'GET',
	body?: unknown,
	readOnlyGraphql = false,
) {
	const clock = yield* Clock.Clock;

	if (!path.startsWith('/')) {
		return yield* invalid('Invalid API path');
	}
	if (
		readOnlyGraphql
		&& !(method === 'POST' && path === '/graphql' && typeof body === 'object' && body !== null && 'query' in body
			&& typeof body.query === 'string' && /^\s*query\b/.test(body.query))
	) {
		return yield* invalid('Read-only retries require a GraphQL query');
	}
	const route = `${method} ${path.split('?')[0]}`;
	const reach = Effect.tryPromise({
		try: signal =>
			transport(`https://api.github.com${path}`, {
				method,
				redirect: 'manual',
				signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': githubApiVersion,
					'User-Agent': 'beepboop',
					'Content-Type': 'application/json',
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}),
		catch: error =>
			upstream('github', `GitHub unreachable on ${route}: ${error instanceof Error ? error.message : String(error)}`),
	});
	const failed = (response: Response) =>
		responseText(response, { maxBytes: 8192 }).pipe(
			Effect.timeout('2 seconds'),
			Effect.map(detailOf),
			Effect.orElseSucceed(() => ''),
			Effect.map(detail => {
				const accepted = response.headers.get('x-accepted-github-permissions');
				return `GitHub HTTP ${response.status} on ${route}${detail ? `: ${detail}` : ''}${
					accepted ? ` (GitHub accepts ${accepted})` : ''
				}`;
			}),
		);
	const safeRead = method === 'GET' || readOnlyGraphql;
	const maxAttempts = 3;
	let attempt = 0;
	const answered = Effect.gen(function*() {
		attempt++;
		const response = yield* scopedResponse(reach);
		if (response.status === 404 && method === 'GET') return null;
		if (!response.ok) {
			if (safeRead && response.status >= 500 && attempt < maxAttempts) {
				return yield* new ServerError({ message: `GitHub HTTP ${response.status} on ${route}` });
			}
			const message = yield* failed(response);
			if (response.status >= 400 && response.status < 500 && response.status !== 408) {
				const retryAt = response.status === 429 || response.status === 403 && rateLimited(message)
					? parseRetryAfter(response.headers.get('retry-after') ?? '', clock.currentTimeMillisUnsafe())
						?? clock.currentTimeMillisUnsafe() + 60_000
					: undefined;
				return yield* new GitHubRejection(response.status, message, retryAt);
			}
			if (response.status >= 500 && safeRead) return yield* new ServerError({ message });
			return yield* response.status >= 500
				? upstream('github', message)
				: domainError({ code: 'precondition', diagnostics: [legacyDiagnostic(message)] }, message);
		}
		if (response.status === 204) return null;
		return yield* responseJson(response).pipe(
			Effect.mapError(() => upstream('github', `GitHub sent invalid JSON on ${route}`)),
		);
	}).pipe(Effect.scoped);
	return yield* answered.pipe(
		retryTransient<ServerError | DomainError>({
			attempts: maxAttempts,
			delay: 500,
			while: failure => failure._tag === 'ServerError',
		}),
		Effect.catchTag('ServerError', ({ message }) => upstream('github', message)),
	);
});

export class GitHubTransport extends Context.Service<GitHubTransport, {
	readonly call: (
		path: string,
		token: string,
		method?: string,
		body?: unknown,
		readOnlyGraphql?: boolean,
	) => Effect.Effect<unknown, DomainError>;
}>()('beepboopbot/github/GitHubTransport') {}

export function gitHubTransportLayer(transport: Fetcher): Layer.Layer<GitHubTransport> {
	return Layer.succeed(GitHubTransport, {
		call: (path, token, method, body, readOnlyGraphql) =>
			gitHubRequest(transport, path, token, method, body, readOnlyGraphql),
	});
}
