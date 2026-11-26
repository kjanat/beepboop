import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Effect, Schema } from 'effect';
import type { Environment, Mode } from '@/actions/protocol.ts';
import { attempt, endpoints, exchange, fail, parseMode, requestBody, required } from '@/actions/protocol.ts';
import { identityToken, postJson, readServiceOrigin } from '@/actions/session.ts';
import { writeOutputTo } from '@/host/github-output.ts';
import { runMain } from '@/host/main.ts';
import { mask } from '@/host/workflow-commands.ts';
import { record, text } from '@/kernel/schema/result.ts';

function writeResult(mode: Mode, data: Record<string, unknown>, environment: Environment) {
	const writeOutput = (name: string, value: string) => writeOutputTo(environment.GITHUB_OUTPUT, name, value);
	return Effect.gen(function*() {
		if (mode === 'begin') {
			const id = yield* Effect.fromResult(text(data.id));
			const publicationUrl = data.publicationUrl === undefined
				? ''
				: yield* Effect.fromResult(text(data.publicationUrl));
			const publicationUrls = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.NonEmptyString))(
				data.publicationUrls ?? {},
			);
			yield* writeOutput('publication-url', publicationUrl);
			yield* writeOutput('publication-urls', JSON.stringify(publicationUrls));
			yield* writeOutput('execution-id', id);
			const directory = yield* Effect.fromResult(required(environment, 'RUNNER_TEMP'));
			const contextFile = join(directory, `release-context-${crypto.randomUUID()}.json`);
			yield* Effect.fromResult(attempt(() => writeFileSync(contextFile, JSON.stringify(data), { mode: 0o600 })));
			const {
				repositoryId,
				repository,
				stream,
				operation,
				state,
				version,
				sourceSha,
				updatedAt,
				draftRelease,
				upstreamRelease,
			} = data;
			const force = data.force === true;
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
					upstreamRelease,
					force,
					contextFile,
				}),
			);
			const environmentFile = yield* Effect.fromResult(required(environment, 'GITHUB_ENV'));
			yield* Effect.fromResult(attempt(() => appendFileSync(environmentFile, `BEEPBOOP_EXECUTION_ID=${id}\n`)));
		} else if (mode === 'credentials') {
			for (const [alias, value] of Object.entries(data)) {
				if (typeof value !== 'string') return yield* fail('Invalid credential response');
				yield* mask(value);
				yield* writeOutput(alias, value);
			}
			yield* writeOutput('values', JSON.stringify(data));
		} else if (mode === 'triage') {
			const key = yield* Effect.fromResult(text(data.key));
			yield* mask(key);
			yield* writeOutput('typesafe-api-key', key);
		} else if (mode === 'token') {
			if (typeof data.token !== 'string') return yield* fail('Invalid token response');
			if (environment.TOKEN_IDENTITY === 'true') {
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

function action(input: string | undefined, environment: Environment) {
	return Effect.gen(function*() {
		const mode = yield* Effect.fromResult(parseMode(input));
		const origin = yield* readServiceOrigin(environment);
		const token = yield* identityToken(origin, environment);
		const body = JSON.stringify(
			yield* Effect.fromResult(requestBody(mode, environment, yield* Clock.currentTimeMillis)),
		);
		const result = yield* exchange(mode, Effect.suspend(() => postJson(origin, endpoints[mode].path, token, body)));
		yield* writeResult(mode, result, environment);
	});
}

export function run(input: string | undefined, environment: Environment): Promise<void> {
	return Effect.runPromise(action(input, environment));
}

if (import.meta.main) await runMain(action(process.argv[2], process.env));
