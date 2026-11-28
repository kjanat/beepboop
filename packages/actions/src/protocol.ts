import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Data, Effect, Result } from 'effect';
import { isJson } from '@/contract/http.ts';
import { validDistributionArtifact, validDistributionPath } from '@/domain/distribution-validation.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { attemptWith, awaitWith, errorMessage, failWith, rejectWith } from '@/kernel/errors/refusal.ts';
import { responseJson } from '@/kernel/http/body.ts';
import { parseRetryAfter } from '@/kernel/http/http-date.ts';
import { retryTransient } from '@/kernel/http/retry.ts';
import { array, record, text } from '@/kernel/schema/result.ts';

export const modes = [
	'start',
	'begin',
	'prepared',
	'report',
	'credentials',
	'triage',
	'refs-plan',
	'refs-complete',
	'release',
	'token',
] as const;
export type Mode = (typeof modes)[number];

export const endpoints = {
	start: { path: '/api/workflow/start', idempotent: true },
	begin: { path: '/api/workflow/begin', idempotent: true },
	prepared: { path: '/api/workflow/prepared', idempotent: true },
	report: { path: '/api/workflow/report', idempotent: true },
	credentials: { path: '/api/workflow/credentials', idempotent: true },
	triage: { path: '/api/workflow/triage', idempotent: true },
	'refs-plan': { path: '/api/workflow/refs-plan', idempotent: true },
	'refs-complete': { path: '/api/workflow/refs-complete', idempotent: true },
	release: { path: '/api/workflow/release', idempotent: true },
	token: { path: '/api/workflow/token', idempotent: false },
} as const satisfies Record<Mode, { path: `/api/workflow/${string}`; idempotent: boolean }>;

export class ActionFailure extends Data.TaggedError('ActionFailure')<{
	readonly message: string;
	readonly retryable?: boolean;
}> {}
export type Invalid = ActionFailure | DomainError;

function actionFailure(message: string): ActionFailure {
	return new ActionFailure({ message });
}

export const fail = failWith(actionFailure);
export const refuse = rejectWith(actionFailure);
export const attempt = attemptWith(actionFailure);
export const attemptAsync = awaitWith(actionFailure);

export function parseMode(value: string | undefined): Result.Result<Mode, ActionFailure> {
	const mode = modes.find(candidate => candidate === value);
	return mode ? Result.succeed(mode) : refuse('Unknown integration action');
}

export type Environment = Readonly<Record<string, string | undefined>>;

export function required(environment: Environment, name: string): Result.Result<string, ActionFailure> {
	const value = environment[name];
	return value ? Result.succeed(value) : refuse(`${name} is required`);
}

function json(source: string): Result.Result<unknown, ActionFailure> {
	return attempt((): unknown => JSON.parse(source));
}

const permissionInput = /^permission-([a-z]+(?:-[a-z]+)*)$/;

function tokenPermissions(environment: Environment): Result.Result<Record<string, unknown>, Invalid> {
	return Result.gen(function*() {
		const inputs = yield* record(yield* json(environment.INPUTS || '{}'));
		const separate = Object.entries(inputs).flatMap(([input, level]) => {
			const name = permissionInput.exec(input)?.[1];
			return name && level ? [[name.replaceAll('-', '_'), level] as const] : [];
		});
		if (separate.length && environment.PERMISSIONS) {
			return yield* refuse('Set either permissions or the permission-* inputs');
		}
		if (separate.length) return Object.fromEntries(separate);
		return yield* record(yield* json(environment.PERMISSIONS || '{"contents":"write","pull_requests":"write"}'));
	});
}

function publication(value: unknown, now: number): Result.Result<unknown, Invalid> {
	return Result.gen(function*() {
		const entry = yield* record(value);
		if (entry.outcome !== 'rate-limited') return value;
		const field = yield* text(entry.retryAfter);
		const retryAfter = parseRetryAfter(field, now) ?? (/^\d+$/.test(field.trim()) ? Number.NaN : Date.parse(field));
		if (Number.isNaN(retryAfter)) return yield* refuse('A rate-limited publication needs a Retry-After value');
		return { ...entry, retryAfter: new Date(retryAfter).toISOString() };
	});
}

export function requestBody(mode: Mode, environment: Environment, now: number): Result.Result<unknown, Invalid> {
	const executionId = environment.EXECUTION_ID || environment.BEEPBOOP_EXECUTION_ID;
	return Result.gen(function*() {
		switch (mode) {
			case 'start':
				return {
					stream: yield* required(environment, 'STREAM'),
					version: yield* required(environment, 'RELEASE_VERSION'),
				};
			case 'begin':
				return {
					executionId,
					stream: environment.STREAM,
					operation: environment.OPERATION,
					version: environment.RELEASE_VERSION || undefined,
				};
			case 'prepared': {
				const path = yield* required(environment, 'PREPARED_FILE');
				return yield* json(yield* attempt(() => readFileSync(path, 'utf8')));
			}
			case 'report': {
				const publications = yield* array(yield* json(environment.PUBLICATIONS || '[]'));
				return {
					executionId,
					publications: yield* Result.all(publications.map(entry => publication(entry, now))),
					artifacts: yield* array(yield* json(environment.ARTIFACTS || '[]')),
				};
			}
			case 'credentials':
				return { executionId, aliases: yield* array(yield* json(environment.ALIASES || '[]')) };
			case 'triage':
				return {};
			case 'refs-plan': {
				if (environment.DISTRIBUTION_ARTIFACT_ID || environment.DISTRIBUTION_ARTIFACT_DIGEST) {
					const id = Number(yield* required(environment, 'DISTRIBUTION_ARTIFACT_ID'));
					const digest = yield* required(environment, 'DISTRIBUTION_ARTIFACT_DIGEST');
					if (!validDistributionArtifact(id, digest)) {
						return yield* refuse('Invalid distribution artifact ID or SHA-256 digest');
					}
					return { executionId, artifact: { id, digest } };
				}
				const paths = yield* Result.all((yield* array(yield* json(environment.DISTRIBUTION_PATHS || '[]'))).map(text));
				if (paths.length === 0) return { executionId };
				const root = yield* required(environment, 'GITHUB_WORKSPACE');
				const files = yield* Result.all(paths.map(path => Result.gen(function*() {
					if (!validDistributionPath(path)) return yield* refuse('Invalid distribution path');
					const parts = path.split('/');
					for (let index = 1; index < parts.length; index++) {
						const directory = yield* attempt(() => lstatSync(join(root, ...parts.slice(0, index))));
						if (!directory.isDirectory()) return yield* refuse('Distribution directories must not be symlinks');
					}
					const status = yield* attempt(() => lstatSync(join(root, path)));
					if (!status.isFile()) return yield* refuse('Distribution paths must be regular files');
					const listed = spawnSync('git', ['ls-tree', '--name-only', 'HEAD', '--', path], {
						cwd: root,
						encoding: 'utf8',
					});
					if (listed.status !== 0) return yield* refuse('Could not read the reviewed source tree');
					let before = '';
					if (listed.stdout.trim()) {
						const original = spawnSync('git', ['show', `HEAD:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
						if (original.status !== 0) return yield* refuse('Could not read the reviewed distribution file');
						before = original.stdout.toString('base64');
					}
					return {
						path,
						before,
						encoding: 'base64',
						mode: status.mode & 0o111 ? '100755' : '100644',
						after: yield* attempt(() => readFileSync(join(root, path)).toString('base64')),
					};
				})));
				return { executionId, files };
			}
			case 'refs-complete':
				return {
					executionId,
					...(environment.VERSION_TAG ? { versionTag: yield* json(environment.VERSION_TAG) } : {}),
				};
			case 'release':
				return { executionId };
			case 'token':
				return {
					permissions: yield* tokenPermissions(environment),
					...(environment.TOKEN_PURPOSE ? { purpose: environment.TOKEN_PURPOSE } : {}),
					...(environment.TOKEN_IDENTITY === 'true' ? { identity: true } : {}),
					...(executionId ? { executionId } : {}),
				};
		}
	});
}

export interface Failure {
	message: string;
	retryable: boolean;
}

export function failureOf(response: Response): Effect.Effect<Failure> {
	const prefix = `Beepboop request failed: HTTP ${response.status}`;
	if (!isJson(response)) return Effect.succeed({ message: prefix, retryable: false });
	return responseJson(response).pipe(
		Effect.orElseSucceed(() => undefined),
		Effect.map((body): Failure => {
			if (typeof body !== 'object' || body === null) return { message: prefix, retryable: false };
			const error = 'error' in body && typeof body.error === 'string' ? body.error : undefined;
			const problem = 'problem' in body && typeof body.problem === 'object' && body.problem !== null
				? body.problem
				: undefined;
			const code = problem && 'code' in problem && typeof problem.code === 'string' ? problem.code : undefined;
			return {
				message: `${prefix}${code ? ` ${code}` : ''}${error ? `: ${error}` : ''}`,
				retryable: code === 'upstream',
			};
		}),
	);
}

export function retried<E>(
	send: Effect.Effect<Response, E>,
	idempotent: boolean,
	attempts: number,
): Effect.Effect<unknown, E | ActionFailure> {
	const once: Effect.Effect<unknown, E | ActionFailure> = Effect.gen(function*() {
		const response = yield* send;
		if (response.ok) {
			if (!isJson(response)) return yield* fail(`Beepboop answered HTTP ${response.status} without JSON`);
			return yield* responseJson(response).pipe(Effect.mapError(({ cause }) =>
				cause instanceof SyntaxError
					? actionFailure(`Beepboop answered HTTP ${response.status} with invalid JSON`)
					: new ActionFailure({ message: errorMessage(cause), retryable: true })
			));
		}
		const failure = yield* failureOf(response);
		return yield* new ActionFailure(failure);
	});
	return once.pipe(
		retryTransient({
			attempts,
			delay: 1000,
			while: (error: E | ActionFailure) => error instanceof ActionFailure && error.retryable === true && idempotent,
		}),
	);
}

export function exchange<E>(
	mode: Mode,
	send: Effect.Effect<Response, E>,
	attempts = 3,
): Effect.Effect<Record<string, unknown>, E | Invalid> {
	return retried(send, endpoints[mode].idempotent, attempts).pipe(
		Effect.flatMap(body => Effect.fromResult(record(body))),
	);
}
