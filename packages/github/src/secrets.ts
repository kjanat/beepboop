import { Effect } from 'effect';
import { seal } from 'tweetnacl-sealedbox-js';
import type { GitHubRequests } from '@/github/transport.ts';
import { base64, bytes } from '@/kernel/crypto/base64.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { textSchema } from '@/kernel/schema/result.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';

const secretPublicKey = mutableStruct({ key: textSchema, key_id: textSchema });

export type SecretTarget =
	| { readonly delivery: 'environment'; readonly repositoryId: number; readonly environment: string }
	| { readonly delivery: 'repository'; readonly repository: string };

function secretsPath(target: SecretTarget): string {
	return target.delivery === 'environment'
		? `/repositories/${target.repositoryId}/environments/${encodeURIComponent(target.environment)}/secrets`
		: `/repos/${target.repository}/actions/secrets`;
}

export function putSecret(
	github: GitHubRequests,
	target: SecretTarget,
	name: string,
	value: string,
	token: string,
): Effect.Effect<void, DomainError> {
	const path = secretsPath(target);
	return Effect.gen(function*() {
		const publicKey = yield* github.read(secretPublicKey, `${path}/public-key`, token);
		const encrypted = yield* fromSync(() => seal(new TextEncoder().encode(value), bytes(publicKey.key)));
		yield* github.call(`${path}/${name}`, token, 'PUT', {
			encrypted_value: base64(encrypted),
			key_id: publicKey.key_id,
		});
	});
}
