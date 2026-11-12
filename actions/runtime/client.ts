import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mode } from '@root/actions/runtime/protocol.ts';
import {
	attempt,
	endpoints,
	exchange,
	fail,
	parseMode,
	requestBody,
	required,
} from '@root/actions/runtime/protocol.ts';
import { identityToken, mask, postJson, serviceOrigin } from '@root/actions/runtime/session.ts';
import { Effect } from 'effect';
import { record, text } from '@/model.ts';
import { writeOutput } from '@/tooling/github-output.ts';

function writeResult(mode: Mode, data: Record<string, unknown>) {
	return Effect.gen(function*() {
		if (mode === 'begin') {
			const id = yield* Effect.fromResult(text(data.id));
			yield* writeOutput('execution-id', id);
			const directory = yield* Effect.fromResult(required(process.env, 'RUNNER_TEMP'));
			const contextFile = join(directory, `release-context-${crypto.randomUUID()}.json`);
			yield* Effect.fromResult(attempt(() => writeFileSync(contextFile, JSON.stringify(data), { mode: 0o600 })));
			const { repositoryId, repository, stream, operation, state, version, sourceSha, updatedAt, draftRelease } = data;
			yield* writeOutput(
				'context',
				JSON.stringify({
					id,
					repositoryId,
					repository,
					stream,
					operation,
					state,
					version,
					sourceSha,
					updatedAt,
					draftRelease,
					contextFile,
				}),
			);
			const environment = yield* Effect.fromResult(required(process.env, 'GITHUB_ENV'));
			yield* Effect.fromResult(attempt(() => appendFileSync(environment, `BEEPBOOP_EXECUTION_ID=${id}\n`)));
		} else if (mode === 'credentials') {
			for (const [alias, value] of Object.entries(data)) {
				if (typeof value !== 'string') return yield* fail('Invalid credential response');
				yield* mask(value);
				yield* writeOutput(alias, value);
			}
			yield* writeOutput('values', JSON.stringify(data));
		} else if (mode === 'token') {
			if (typeof data.token !== 'string') return yield* fail('Invalid token response');
			if (process.env.TOKEN_IDENTITY === 'true') {
				const bot = yield* Effect.fromResult(record(data.bot));
				const login = bot.login, id = bot.id, email = bot.email;
				if (
					typeof login !== 'string' || !/^[a-z0-9-]+\[bot\]$/.test(login)
					|| typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0
					|| email !== `${id}+${login}@users.noreply.github.com`
				) return yield* fail('Invalid bot identity response');
				yield* writeOutput('bot-login', login);
				yield* writeOutput('bot-id', String(id));
				yield* writeOutput('bot-email', email);
				yield* writeOutput(
					'gitId',
					JSON.stringify({
						GIT_AUTHOR_NAME: login,
						GIT_AUTHOR_EMAIL: email,
						GIT_COMMITTER_NAME: login,
						GIT_COMMITTER_EMAIL: email,
					}),
				);
			}
			yield* mask(data.token);
			yield* writeOutput('token', data.token);
		} else yield* writeOutput('result', JSON.stringify(data));
	});
}

await Effect.runPromise(Effect.gen(function*() {
	const mode = yield* Effect.fromResult(parseMode(process.argv[2]));
	const origin = yield* serviceOrigin;
	const token = yield* identityToken(origin);
	const body = JSON.stringify(yield* Effect.fromResult(requestBody(mode, process.env)));
	const result = yield* exchange(mode, Effect.suspend(() => postJson(origin, endpoints[mode].path, token, body)));
	yield* writeResult(mode, result);
}));
