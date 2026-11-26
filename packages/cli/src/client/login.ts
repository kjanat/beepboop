import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import type { Client } from '@/cli/client/api';
import { local, localFailure, reached, warnOutage } from '@/cli/client/errors';
import { parseSession } from '@/cli/client/session-store';
import { failure, signIn } from '@/cli/render/output';
import { failureOf, send } from '@/contract/client';
import { responseJson } from '@/kernel/http/body.ts';
import { confirmationCode, loginSecret, sha256Hex } from '@/kernel/schema/ids.ts';

export function login(
	client: Client,
	show: (url: string, code: string) => Effect.Effect<void>,
	pending: () => Effect.Effect<void>,
	signal: AbortSignal,
): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		const verifier = loginSecret();
		const challenge = yield* local(() => sha256Hex(verifier));
		yield* show(`${client.origin}/auth/cli/authorize?challenge=${challenge}`, confirmationCode(challenge));
		while (!signal.aborted) {
			const response = yield* reached(
				send(interruption =>
					fetch(`${client.origin}/auth/cli/token`, {
						method: 'POST',
						body: verifier,
						redirect: 'error',
						signal: AbortSignal.any([signal, interruption]),
					})
				),
			);
			yield* warnOutage(response);
			if (response.status === 202) {
				yield* pending();
				yield* client.pause(1500);
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
			const session = parseSession(
				yield* responseJson(response).pipe(Effect.mapError(({ cause }) => localFailure(cause))),
			);
			if (!session) return yield* Effect.fail(failure('Invalid login response', 'INVALID_RESPONSE'));
			yield* client.save(session);
			return;
		}
		return yield* Effect.fail(failure('Login timed out', 'LOGIN_TIMEOUT', signIn));
	});
}
