import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import type { Client } from '@/cli/client/api';
import type { SecurityKeyPrompts } from '@/cli/fido2/index';
import { securityKeyAssertion } from '@/cli/fido2/index';
import { failure } from '@/cli/render/output';
import { routes } from '@/contract/routes';

export function elevate(client: Client, prompts: SecurityKeyPrompts<CLIError>): Effect.Effect<string, CLIError> {
	return Effect.gen(function*() {
		const challenge = yield* client.call(routes.authenticatorsOptions, { register: false });
		const response = yield* securityKeyAssertion(challenge.options, client.origin, prompts).pipe(
			Effect.catchTag('SecurityKeyError', error => Effect.fail(failure(error.message, 'SECURITY_KEY'))),
		);
		const { proof } = yield* client.call(routes.authenticatorsVerify, { id: challenge.id, response });
		if (!proof) return yield* Effect.fail(failure('The server returned no security-key proof', 'NO_PROOF'));
		return proof;
	});
}
