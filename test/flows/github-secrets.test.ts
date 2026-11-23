import { expect, test } from 'bun:test';
import { Effect, Schema } from 'effect';
import { open } from 'tweetnacl-sealedbox-js';
import type { SecretTarget } from '@/github/secrets.ts';
import { putSecret } from '@/github/secrets.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import { base64, bytes } from '@/kernel/crypto/base64.ts';
import { decode } from '@/kernel/schema/result.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';

interface Exchange {
	method: string;
	path: string;
	token: string;
	body: unknown;
}

const sealedSecret = mutableStruct({ encrypted_value: Schema.String, key_id: Schema.String });
const jwk = mutableStruct({ x: Schema.String, d: Schema.String });

async function keyPair() {
	const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
	if (!('privateKey' in pair)) throw new Error('X25519 returned a single key');
	const { x, d } = Schema.decodeUnknownSync(jwk)(await crypto.subtle.exportKey('jwk', pair.privateKey));
	return { publicKey: Buffer.from(x, 'base64url'), secretKey: Buffer.from(d, 'base64url') };
}

function fakeGitHub(publicKey: Uint8Array) {
	const exchanges: Exchange[] = [];
	const github: GitHubRequests = {
		call: (path, token, method = 'GET', body) =>
			Effect.sync(() => {
				exchanges.push({ method, path, token, body });
				return null;
			}),
		read: (schema, path, token, method = 'GET', body) =>
			Effect.suspend(() => {
				exchanges.push({ method, path, token, body });
				return Effect.fromResult(decode(schema, { key: base64(publicKey), key_id: 'key-7' }));
			}),
	};
	return { exchanges, github };
}

for (
	const [name, target, path] of [
		[
			'a repository secret',
			{ delivery: 'repository', repository: 'octo/widget' },
			'/repos/octo/widget/actions/secrets',
		],
		[
			'an environment secret',
			{ delivery: 'environment', repositoryId: 42, environment: 'release/npm' },
			'/repositories/42/environments/release%2Fnpm/secrets',
		],
	] satisfies [string, SecretTarget, string][]
) {
	test(`${name} is sealed to the public key and written under its path`, async () => {
		const keys = await keyPair();
		const fake = fakeGitHub(keys.publicKey);
		await Effect.runPromise(putSecret(fake.github, target, 'NPM_TOKEN', 'hunter2', 'token-1'));
		expect(fake.exchanges.map(({ method, path, token }) => [method, path, token])).toEqual([
			['GET', `${path}/public-key`, 'token-1'],
			['PUT', `${path}/NPM_TOKEN`, 'token-1'],
		]);
		const put = Schema.decodeUnknownSync(sealedSecret)(fake.exchanges[1]?.body);
		expect(put.key_id).toBe('key-7');
		const opened = open(bytes(put.encrypted_value), keys.publicKey, keys.secretKey);
		expect(opened && new TextDecoder().decode(opened)).toBe('hunter2');
	});
}
