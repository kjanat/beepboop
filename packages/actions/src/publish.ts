import { existsSync } from 'node:fs';
import { Clock, Effect, Schema } from 'effect';
import type { Invalid } from '@/actions/protocol.ts';
import { attempt, required } from '@/actions/protocol.ts';
import { call, serviceOrigin } from '@/actions/session.ts';
import { runMain } from '@/host/main.ts';
import { githubSecretNamePattern } from '@/kernel/schema/ids.ts';
import { textSchema } from '@/kernel/schema/result.ts';
import { decodeSync, matchesPattern, mutableRecord } from '@/kernel/schema/structs.ts';
import type { RunnerFailure } from '@/publication/runner/publish.ts';
import { command, publicRepository, publishPackages, requireAll } from '@/publication/runner/publish.ts';

const credentials = mutableRecord(Schema.String.check(matchesPattern(githubSecretNamePattern)), textSchema);

export const main: Effect.Effect<void, Invalid | RunnerFailure> = Effect.gen(function*() {
	const clock = yield* Clock.Clock;
	const environment = process.env;
	const origin = yield* serviceOrigin;
	const executionId = yield* Effect.fromResult(
		required({ EXECUTION_ID: environment.EXECUTION_ID || environment.BEEPBOOP_EXECUTION_ID }, 'EXECUTION_ID'),
	);
	const mapping = yield* Effect.fromResult(
		attempt(() => decodeSync(credentials, JSON.parse(environment.CREDENTIALS || '{}'))),
	);
	const entries = yield* publishPackages({
		executionId,
		credentials: mapping,
		provenance: publicRepository(environment.REPOSITORY_PRIVATE),
		...(environment.NPM_TARBALLS ? { tarballs: environment.NPM_TARBALLS } : {}),
		call: (path, body) => call(origin, path, body),
		run: command,
		sleep: milliseconds => Effect.sleep(milliseconds),
		exists: path => existsSync(path),
		now: () => clock.currentTimeMillisUnsafe(),
		log: line => console.log(line),
	});
	yield* requireAll(entries);
});

if (import.meta.main) await runMain(main);
