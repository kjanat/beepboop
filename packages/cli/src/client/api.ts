import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { elevate } from '@/cli/client/elevation';
import { localFailure, reached, refusal, rejected, unreachable, warnOutage } from '@/cli/client/errors';
import { login } from '@/cli/client/login';
import type { Session, SessionStore } from '@/cli/client/session-store';
import { readSession, removeSession, saveSession } from '@/cli/client/session-store';
import { stateDirectory } from '@/cli/config';
import type { SecurityKeyPrompts } from '@/cli/fido2/index';
import { failure, signIn } from '@/cli/render/output';
import type { Transport } from '@/contract/client';
import { call, elevatedCall, send } from '@/contract/client';
import { bearerHeaders } from '@/contract/http';
import type { Route } from '@/contract/routes';
import { responseJson } from '@/kernel/http/body.ts';
import type { Contract, Decoded, Encoded } from '@/kernel/schema/structs.ts';

function serverOrigin(value: string): Effect.Effect<string, CLIError> {
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

export class Client {
	private constructor(
		readonly origin: string,
		private directory: string,
	) {}
	static at(server: string, directory = stateDirectory()): Effect.Effect<Client, CLIError> {
		return serverOrigin(server).pipe(Effect.map(origin => new Client(origin, directory)));
	}
	private store(): SessionStore {
		return { directory: this.directory, origin: this.origin };
	}
	pause(millis: number): Effect.Effect<void> {
		return Effect.sleep(millis);
	}
	save(session: Session): Effect.Effect<void, CLIError> {
		return saveSession(this.store(), session);
	}
	session(): Effect.Effect<Session, CLIError> {
		return readSession(this.store());
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
			yield* removeSession(this.store());
		});
	}
	private transport(session: Session): Transport {
		return request =>
			send(signal =>
				fetch(`${this.origin}${request.path}`, {
					method: request.method,
					headers: bearerHeaders(session.token),
					...(request.body === undefined ? {} : { body: request.body }),
					redirect: 'error',
					signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
				})
			).pipe(Effect.tap(response => Effect.sync(() => warnOutage(response))));
	}
	call<Q extends Contract, S extends Contract>(
		route: Route<Q, S>,
		input: Encoded<Q>,
	): Effect.Effect<Decoded<S>, CLIError> {
		return Effect.gen({ self: this }, function*() {
			const transport = this.transport(yield* this.session());
			return yield* call(route, input, transport).pipe(
				Effect.catchTags({ Unreachable: unreachable, ApiFailure: error => Effect.fail(refusal(error)) }),
			);
		});
	}
	elevatedCall<Q extends Contract, S extends Contract>(
		route: Route<Q, S>,
		input: (proof: string | undefined) => Encoded<Q>,
		prompts: SecurityKeyPrompts<CLIError>,
	): Effect.Effect<Decoded<S>, CLIError> {
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
			return yield* responseJson(response).pipe(Effect.mapError(({ cause }) => localFailure(cause)));
		});
	}
	elevated(prompts: SecurityKeyPrompts<CLIError>): Effect.Effect<string, CLIError> {
		return elevate(this, prompts);
	}
	login(
		show: (url: string, code: string) => Effect.Effect<void>,
		pending: () => Effect.Effect<void> = () => Effect.void,
		signal = AbortSignal.timeout(300000),
	): Effect.Effect<void, CLIError> {
		return login(this, show, pending, signal);
	}
}
