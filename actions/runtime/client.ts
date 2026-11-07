import { appendFileSync } from 'node:fs';
import {
	ActionFailure,
	attempt,
	endpoints,
	exchange,
	type Mode,
	parseMode,
	requestBody,
	required,
} from '@root/actions/runtime/protocol.ts';
import { Effect } from 'effect';
import { record, text } from '@/model.ts';
import { writeOutput } from '@/tooling/github-output.ts';

function fail(message: string): Effect.Effect<never, ActionFailure> {
	return Effect.fail(new ActionFailure({ message }));
}

function mask(value: string): Effect.Effect<void> {
	return Effect.sync(() =>
		console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
	);
}

function writeResult(mode: Mode, data: Record<string, unknown>) {
	return Effect.gen(function*() {
		if (mode === 'begin') {
			const id = yield* Effect.fromResult(text(data.id));
			yield* writeOutput('execution-id', id);
			yield* writeOutput('context', JSON.stringify(data));
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

function post(url: URL | string, init: RequestInit): Effect.Effect<Response, ActionFailure> {
	return Effect.tryPromise({
		try: () => fetch(url, { ...init, redirect: 'error' }),
		catch: error => new ActionFailure({ message: error instanceof Error ? error.message : String(error) }),
	});
}

await Effect.runPromise(Effect.gen(function*() {
	const mode = yield* Effect.fromResult(parseMode(process.argv[2]));
	const origin = yield* Effect.fromResult(
		attempt(() => new URL(process.env.SERVICE_ORIGIN || 'https://beepboop.kjanat.dev')),
	);
	if (
		origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username
		|| origin.password
	) return yield* fail('Expected an HTTPS service origin');
	const requestUrl = yield* Effect.fromResult(required(process.env, 'ACTIONS_ID_TOKEN_REQUEST_URL'));
	const requestToken = yield* Effect.fromResult(required(process.env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'));
	const endpoint = yield* Effect.fromResult(attempt(() => new URL(requestUrl)));
	endpoint.searchParams.set('audience', origin.origin);
	const identity = yield* post(endpoint, {
		headers: { Authorization: `Bearer ${requestToken}` },
		signal: AbortSignal.timeout(20000),
	});
	if (!identity.ok) return yield* fail('Could not obtain workflow identity');
	const issued = yield* Effect.tryPromise({
		try: (): Promise<unknown> => identity.json(),
		catch: () => new ActionFailure({ message: 'Could not obtain workflow identity' }),
	});
	const token = (yield* Effect.fromResult(record(issued))).value;
	if (typeof token !== 'string') return yield* fail('Missing workflow identity');
	yield* mask(token);
	const body = JSON.stringify(yield* Effect.fromResult(requestBody(mode, process.env)));
	const result = yield* exchange(
		mode,
		Effect.suspend(() =>
			post(new URL(endpoints[mode].path, origin), {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body,
				signal: AbortSignal.timeout(30000),
			})
		),
	);
	yield* writeResult(mode, result);
}));
