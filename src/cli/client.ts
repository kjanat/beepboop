import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import type { z } from 'zod';
import type { SecurityKeyPrompts } from '@/cli/fido2/index';
import { securityKeyAssertion } from '@/cli/fido2/index';
import { failure, signIn } from '@/cli/output';
import type { ApiFailure, Transport, Unreachable } from '@/contract/client';
import { call, elevatedCall, failureOf, send } from '@/contract/client';
import type { ErrorCode } from '@/contract/errors';
import { bearerHeaders } from '@/contract/http';
import { cliTokenPattern, confirmationCode, loginSecret, sha256Hex } from '@/contract/ids';
import type { Route } from '@/contract/routes';
import { routes } from '@/contract/routes';

const codes = {
	unauthenticated: 'SESSION_REVOKED',
	forbidden: 'FORBIDDEN',
	'not-found': 'NOT_FOUND',
	'method-not-allowed': 'UNSUPPORTED',
	invalid: 'INVALID_REQUEST',
	conflict: 'CONFLICT',
	precondition: 'PRECONDITION',
	upstream: 'UPSTREAM_UNAVAILABLE',
	internal: 'SERVER_ERROR',
} as const satisfies Record<ErrorCode, string>;

export interface Session {
	token: string;
}
function parseSession(value: unknown): Session | undefined {
	if (typeof value !== 'object' || value === null || !('token' in value)) return undefined;
	const { token } = value;
	if (typeof token !== 'string' || !cliTokenPattern.test(token)) return undefined;
	return { token };
}
let warned = false;
function warnOutage(response: Response): void {
	const notice = response.headers.get('beepboop-github-status');
	if (!notice || warned) return;
	warned = true;
	process.stderr.write(`warning: ${notice}\n`);
}
export function serverOrigin(value: string): Effect.Effect<string, CLIError> {
	return Effect.gen(function*() {
		const url = yield* Effect.try({
			try: () => new URL(value),
			catch: () => failure('Server must be a URL', 'INVALID_SERVER'),
		});
		if (
			url.protocol !== 'https:'
			&& !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
		) {
			return yield* Effect.fail(failure('Use HTTPS, or HTTP on localhost for development', 'INVALID_SERVER'));
		}
		if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
			return yield* Effect.fail(failure('Server must be an origin, without credentials or a path', 'INVALID_SERVER'));
		}
		return url.origin;
	});
}
function local<A>(run: () => Promise<A>): Effect.Effect<A> {
	return Effect.promise(run);
}
function refusal(error: ApiFailure): CLIError {
	return error.status === 401
		? failure('Session revoked', 'SESSION_REVOKED', signIn)
		: failure(error.message, error.problem ? codes[error.problem.code] : `HTTP_${error.status}`);
}
function unreachable(error: Unreachable): Effect.Effect<never> {
	return Effect.die(error.cause);
}
function reached<A>(effect: Effect.Effect<A, Unreachable>): Effect.Effect<A> {
	return Effect.catch(effect, unreachable);
}
function rejected(response: Response): Effect.Effect<never, CLIError> {
	return failureOf(response).pipe(
		Effect.flatMap(problem => Effect.fail(failure(problem.message, `HTTP_${response.status}`))),
	);
}

export class Client {
	private constructor(
		readonly origin: string,
		private directory: string,
	) {}
	static at(
		server: string,
		directory = join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'beepboop'),
	): Effect.Effect<Client, CLIError> {
		return serverOrigin(server).pipe(Effect.map(origin => new Client(origin, directory)));
	}
	pause(millis: number): Effect.Effect<void> {
		return Effect.sleep(millis);
	}
	private file(): Effect.Effect<string> {
		return local(() => sha256Hex(this.origin)).pipe(Effect.map(hash => join(this.directory, `${hash}.json`)));
	}
	save(session: Session): Effect.Effect<void> {
		return Effect.gen({ self: this }, function*() {
			yield* local(() => mkdir(this.directory, { recursive: true, mode: 0o700 }));
			yield* local(() => chmod(this.directory, 0o700));
			const path = yield* this.file();
			const temporary = `${path}.${crypto.randomUUID()}`;
			yield* local(async () => {
				await writeFile(temporary, JSON.stringify(session), { mode: 0o600, flag: 'wx' });
				await rename(temporary, path);
			}).pipe(Effect.ensuring(local(() => rm(temporary, { force: true }))));
		});
	}
	session(): Effect.Effect<Session, CLIError> {
		return Effect.gen({ self: this }, function*() {
			const path = yield* this.file();
			const saved = yield* Effect.tryPromise({
				try: async (): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')),
				catch: () => failure('Not signed in', 'NOT_SIGNED_IN', signIn),
			});
			const session = parseSession(saved);
			if (!session) return yield* Effect.fail(failure('Not signed in', 'NOT_SIGNED_IN', signIn));
			return session;
		});
	}
	logout(): Effect.Effect<void, CLIError> {
		return Effect.gen({ self: this }, function*() {
			yield* Effect.gen({ self: this }, function*() {
				const session = yield* this.session();
				const response = yield* reached(
					this.transport(session)({ method: 'POST', path: '/auth/cli/logout', body: '{}' }),
				);
				if (response.status !== 401 && !response.ok) return yield* rejected(response);
			}).pipe(Effect.catchIf(error => error.code === 'NOT_SIGNED_IN', () => Effect.void));
			const path = yield* this.file();
			yield* local(() => rm(path, { force: true }));
		});
	}
	private transport(session: Session): Transport {
		return request =>
			send(() =>
				fetch(`${this.origin}${request.path}`, {
					method: request.method,
					headers: bearerHeaders(session.token),
					...(request.body === undefined ? {} : { body: request.body }),
					redirect: 'error',
					signal: AbortSignal.timeout(30000),
				})
			).pipe(Effect.tap(response => Effect.sync(() => warnOutage(response))));
	}
	call<Q extends z.ZodType, S extends z.ZodType>(
		route: Route<Q, S>,
		input: z.input<Q>,
	): Effect.Effect<z.output<S>, CLIError> {
		return Effect.gen({ self: this }, function*() {
			const transport = this.transport(yield* this.session());
			return yield* call(route, input, transport).pipe(
				Effect.catchTag('Unreachable', unreachable),
				Effect.mapError(refusal),
			);
		});
	}
	elevatedCall<Q extends z.ZodType, S extends z.ZodType>(
		route: Route<Q, S>,
		input: (proof: string | undefined) => z.input<Q>,
		prompts: SecurityKeyPrompts<CLIError>,
	): Effect.Effect<z.output<S>, CLIError> {
		return Effect.gen({ self: this }, function*() {
			const transport = this.transport(yield* this.session());
			return yield* elevatedCall(route, input, transport, Effect.suspend(() => this.elevated(prompts))).pipe(
				Effect.catchTags({ Unreachable: unreachable, ApiFailure: error => Effect.fail(refusal(error)) }),
			);
		});
	}
	status(): Effect.Effect<unknown, CLIError> {
		return Effect.gen({ self: this }, function*() {
			const session = yield* this.session();
			const response = yield* reached(
				this.transport(session)({ method: 'GET', path: '/auth/cli/status', body: undefined }),
			);
			if (response.status === 401) return yield* Effect.fail(failure('Session revoked', 'SESSION_REVOKED', signIn));
			if (!response.ok) return yield* rejected(response);
			return yield* local((): Promise<unknown> => response.json());
		});
	}
	elevated(prompts: SecurityKeyPrompts<CLIError>): Effect.Effect<string, CLIError> {
		return Effect.gen({ self: this }, function*() {
			const challenge = yield* this.call(routes.authenticatorsOptions, { register: false });
			const response = yield* securityKeyAssertion(challenge.options, this.origin, prompts).pipe(
				Effect.catchTag('SecurityKeyError', error => Effect.fail(failure(error.message, 'SECURITY_KEY'))),
			);
			const { proof } = yield* this.call(routes.authenticatorsVerify, { id: challenge.id, response });
			if (!proof) return yield* Effect.fail(failure('The server returned no security-key proof', 'NO_PROOF'));
			return proof;
		});
	}
	login(
		show: (url: string, code: string) => Effect.Effect<void>,
		signal = AbortSignal.timeout(300000),
	): Effect.Effect<void, CLIError> {
		return Effect.gen({ self: this }, function*() {
			const verifier = loginSecret();
			const challenge = yield* local(() => sha256Hex(verifier));
			yield* show(`${this.origin}/auth/cli/authorize?challenge=${challenge}`, confirmationCode(challenge));
			while (!signal.aborted) {
				const response = yield* reached(
					send(() =>
						fetch(`${this.origin}/auth/cli/token`, { method: 'POST', body: verifier, redirect: 'error', signal })
					),
				);
				warnOutage(response);
				if (response.status === 202) {
					yield* Effect.sleep('1500 millis');
					continue;
				}
				if (response.status === 401 || response.status === 404) {
					return yield* Effect.fail(failure(
						'This server does not provide CLI login',
						'LOGIN_UNAVAILABLE',
						'Deploy the matching Beepboop server or choose another --server',
					));
				}
				if (!response.ok) {
					const problem = yield* failureOf(response);
					return yield* Effect.fail(failure(`Login failed (${response.status}): ${problem.message}`, 'LOGIN_FAILED'));
				}
				const session = parseSession(yield* local((): Promise<unknown> => response.json()));
				if (!session) return yield* Effect.die(new Error('Invalid login response'));
				yield* this.save(session);
				return;
			}
			return yield* Effect.fail(failure('Login timed out', 'LOGIN_TIMEOUT', signIn));
		});
	}
}
