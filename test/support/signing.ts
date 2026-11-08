import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SigningIdentity, TagSigner } from '@/automation/refs';

function gpg(home: string, args: string[], input?: string): string {
	const result = spawnSync('gpg', ['--batch', '--no-tty', ...args], {
		env: { ...process.env, GNUPGHOME: home },
		encoding: 'utf8',
		input,
	});
	if (result.status !== 0) throw new Error(`gpg ${args.join(' ')} failed\n${result.stderr}`);
	return result.stdout;
}

export interface SigningKey {
	readonly home: string;
	readonly uid: string;
	readonly fingerprint: string;
	readonly publicKey: string;
	sign(payload: string): string;
	verifies(dir: string, ref: string): boolean;
	dispose(): void;
}

export function signingKey(uid: string): SigningKey {
	const home = mkdtempSync(join(tmpdir(), 'beepboop-gpg-'));
	gpg(home, ['--passphrase', '', '--quick-gen-key', uid, 'ed25519', 'sign', 'never']);
	const fingerprint = gpg(home, ['--with-colons', '--list-secret-keys']).split('\n')
		.find(line => line.startsWith('fpr:'))?.split(':')[9];
	if (!fingerprint) throw new Error('Generated key has no fingerprint');
	return {
		home,
		uid,
		fingerprint,
		publicKey: gpg(home, ['--armor', '--export', fingerprint]),
		sign: payload => gpg(home, ['--armor', '--detach-sign', '--local-user', fingerprint], payload),
		verifies: (dir, ref) =>
			spawnSync('git', ['verify-tag', ref], { cwd: dir, env: { ...process.env, GNUPGHOME: home } }).status === 0,
		dispose: () => {
			spawnSync('gpgconf', ['--kill', 'all'], { env: { ...process.env, GNUPGHOME: home } });
			rmSync(home, { recursive: true, force: true });
		},
	};
}

export interface FakeSigner extends TagSigner {
	readonly calls: { data: string; caller: string }[];
}

export function fakeSigner(
	key: SigningKey,
	options: { signWith?: SigningKey; userId?: string } = {},
): FakeSigner {
	const calls: { data: string; caller: string }[] = [];
	return {
		calls,
		identity: async (): Promise<SigningIdentity> => ({ publicKey: key.publicKey, userId: options.userId ?? key.uid }),
		sign: async (data, caller) => {
			calls.push({ data, caller });
			return (options.signWith ?? key).sign(data);
		},
	};
}
