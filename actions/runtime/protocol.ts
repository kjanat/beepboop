import { readFileSync } from 'node:fs';
import { parseRetryAfter } from '../../src/domain/http-date.ts';
import { array, record, text } from '../../src/model.ts';

export const modes = [
	'begin',
	'prepared',
	'report',
	'credentials',
	'refs-plan',
	'refs-complete',
	'release',
	'token',
] as const;
export type Mode = (typeof modes)[number];

export const endpoints = {
	begin: { path: '/api/workflow/begin', idempotent: true },
	prepared: { path: '/api/workflow/prepared', idempotent: true },
	report: { path: '/api/workflow/report', idempotent: true },
	credentials: { path: '/api/workflow/credentials', idempotent: true },
	'refs-plan': { path: '/api/workflow/refs-plan', idempotent: true },
	'refs-complete': { path: '/api/workflow/refs-complete', idempotent: true },
	release: { path: '/api/workflow/release', idempotent: true },
	token: { path: '/api/workflow/token', idempotent: false },
} as const satisfies Record<Mode, { path: `/api/workflow/${string}`; idempotent: boolean }>;

export function parseMode(value: string | undefined): Mode {
	const mode = modes.find(candidate => candidate === value);
	if (!mode) throw Error('Unknown integration action');
	return mode;
}

export type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
	const value = environment[name];
	if (!value) throw Error(`${name} is required`);
	return value;
}

function publication(value: unknown, now: number): unknown {
	const entry = record(value);
	if (entry.outcome !== 'rate-limited') return value;
	const field = text(entry.retryAfter);
	const retryAfter = parseRetryAfter(field, now) ?? (/^\d+$/.test(field.trim()) ? Number.NaN : Date.parse(field));
	if (Number.isNaN(retryAfter)) throw Error('A rate-limited publication needs a Retry-After value');
	return { ...entry, retryAfter: new Date(retryAfter).toISOString() };
}

export function requestBody(mode: Mode, environment: Environment, now = Date.now()): unknown {
	const executionId = environment.EXECUTION_ID || environment.BEEPBOOP_EXECUTION_ID;
	switch (mode) {
		case 'begin':
			return {
				executionId,
				stream: environment.STREAM,
				operation: environment.OPERATION,
				version: environment.RELEASE_VERSION || undefined,
			};
		case 'prepared':
			return JSON.parse(readFileSync(required(environment, 'PREPARED_FILE'), 'utf8'));
		case 'report':
			return {
				executionId,
				publications: array(JSON.parse(environment.PUBLICATIONS || '[]')).map(entry => publication(entry, now)),
				artifacts: array(JSON.parse(environment.ARTIFACTS || '[]')),
			};
		case 'credentials':
			return { executionId, aliases: array(JSON.parse(environment.ALIASES || '[]')) };
		case 'refs-plan':
		case 'refs-complete':
		case 'release':
			return { executionId };
		case 'token':
			return {
				permissions: record(JSON.parse(environment.PERMISSIONS || '{}')),
				...(environment.TOKEN_PURPOSE ? { purpose: environment.TOKEN_PURPOSE } : {}),
				...(environment.TOKEN_IDENTITY === 'true' ? { identity: true } : {}),
				...(executionId ? { executionId } : {}),
			};
	}
}

export interface Failure {
	message: string;
	retryable: boolean;
}

function isJson(response: Response): boolean {
	return (response.headers.get('content-type') ?? '').split(';')[0]?.trim() === 'application/json';
}

export async function failureOf(response: Response): Promise<Failure> {
	const prefix = `Beepboop request failed: HTTP ${response.status}`;
	if (!isJson(response)) return { message: prefix, retryable: false };
	const body: unknown = await response.json().catch(() => undefined);
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
}

export async function exchange(
	mode: Mode,
	send: () => Promise<Response>,
	wait: (milliseconds: number) => Promise<void>,
	attempts = 3,
): Promise<Record<string, unknown>> {
	for (let attempt = 1;; attempt++) {
		const response = await send();
		if (response.ok) {
			if (!isJson(response)) throw Error(`Beepboop answered HTTP ${response.status} without JSON`);
			return record(await response.json());
		}
		const failure = await failureOf(response);
		if (!failure.retryable || !endpoints[mode].idempotent || attempt >= attempts) throw Error(failure.message);
		await wait(1000 * 2 ** (attempt - 1));
	}
}
