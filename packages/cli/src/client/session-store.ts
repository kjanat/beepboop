import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { local } from '@/cli/client/errors';
import { failure, signIn } from '@/cli/render/output';
import { cliTokenPattern, sha256Hex } from '@/kernel/schema/ids.ts';

export interface Session {
	token: string;
}

export interface SessionStore {
	readonly directory: string;
	readonly origin: string;
}

export function parseSession(value: unknown): Session | undefined {
	if (typeof value !== 'object' || value === null || !('token' in value)) return undefined;
	const { token } = value;
	if (typeof token !== 'string' || !cliTokenPattern.test(token)) return undefined;
	return { token };
}

function sessionFile(store: SessionStore): Effect.Effect<string, CLIError> {
	return local(() => sha256Hex(store.origin)).pipe(Effect.map(hash => join(store.directory, `${hash}.json`)));
}

export function saveSession(store: SessionStore, session: Session): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		yield* local(() => mkdir(store.directory, { recursive: true, mode: 0o700 }));
		yield* local(() => chmod(store.directory, 0o700));
		const path = yield* sessionFile(store);
		const temporary = `${path}.${crypto.randomUUID()}`;
		yield* local(async () => {
			await writeFile(temporary, JSON.stringify(session), { mode: 0o600, flag: 'wx' });
			await rename(temporary, path);
		}).pipe(Effect.uninterruptible, Effect.ensuring(local(() => rm(temporary, { force: true })).pipe(Effect.orDie)));
	});
}

export function readSession(store: SessionStore): Effect.Effect<Session, CLIError> {
	return Effect.gen(function*() {
		const path = yield* sessionFile(store);
		const saved = yield* Effect.tryPromise({
			try: async (): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')),
			catch: () => failure('Not signed in', 'NOT_SIGNED_IN', signIn),
		});
		const session = parseSession(saved);
		if (!session) return yield* Effect.fail(failure('Not signed in', 'NOT_SIGNED_IN', signIn));
		return session;
	});
}

export function removeSession(store: SessionStore): Effect.Effect<void, CLIError> {
	return sessionFile(store).pipe(Effect.flatMap(path => local(() => rm(path, { force: true }))));
}
