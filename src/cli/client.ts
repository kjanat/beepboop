import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCLIError } from '@kjanat/dreamcli';
import type { z } from 'zod';
import { type SecurityKeyPrompts, securityKeyAssertion } from '@/cli/fido2/index';
import { failure, signIn } from '@/cli/output';
import { ApiFailure, call, failureOf, type Transport } from '@/contract/client';
import type { ErrorCode } from '@/contract/errors';
import { cliTokenPattern, confirmationCode, loginSecret, sha256Hex } from '@/contract/ids';
import { type Route, routes } from '@/contract/routes';

const codes = {
	unauthenticated: 'SESSION_REVOKED',
	forbidden: 'FORBIDDEN',
	'not-found': 'NOT_FOUND',
	'method-not-allowed': 'UNSUPPORTED',
	invalid: 'INVALID_REQUEST',
	conflict: 'CONFLICT',
	precondition: 'PRECONDITION',
	upstream: 'UPSTREAM_UNAVAILABLE',
	internal: 'SERVER_ERROR',
} as const satisfies Record<ErrorCode, string>;

export interface Session {
	token: string;
}
function parseSession(value: unknown): Session | undefined {
	if (typeof value !== 'object' || value === null || !('token' in value)) return undefined;
	const { token } = value;
	if (typeof token !== 'string' || !cliTokenPattern.test(token)) return undefined;
	return { token };
}
let warned = false;
function warnOutage(response: Response): void {
	const notice = response.headers.get('beepboop-github-status');
	if (!notice || warned) return;
	warned = true;
	process.stderr.write(`warning: ${notice}\n`);
}
export function serverOrigin(value: string): string {
	const url = new URL(value);
	if (
		url.protocol !== 'https:'
		&& !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
	) {
		throw failure('Use HTTPS, or HTTP on localhost for development', 'INVALID_SERVER');
	}
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw failure('Server must be an origin, without credentials or a path', 'INVALID_SERVER');
	}
	return url.origin;
}

export class Client {
	readonly origin: string;
	constructor(
		origin: string,
		private directory = join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'beepboop'),
	) {
		this.origin = serverOrigin(origin);
	}
	private async file(): Promise<string> {
		return join(this.directory, `${await sha256Hex(this.origin)}.json`);
	}
	async save(session: Session): Promise<void> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await chmod(this.directory, 0o700);
		const path = await this.file();
		const temporary = `${path}.${crypto.randomUUID()}`;
		try {
			await writeFile(temporary, JSON.stringify(session), { mode: 0o600, flag: 'wx' });
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	async session(): Promise<Session> {
		let saved: unknown;
		try {
			saved = JSON.parse(await readFile(await this.file(), 'utf8'));
		} catch {
			throw failure('Not signed in', 'NOT_SIGNED_IN', signIn);
		}
		const session = parseSession(saved);
		if (!session) throw failure('Not signed in', 'NOT_SIGNED_IN', signIn);
		return session;
	}
	async logout(): Promise<void> {
		try {
			const response = await this.transport(await this.session())({
				method: 'POST',
				path: '/auth/cli/logout',
				body: '{}',
			});
			if (response.status !== 401 && !response.ok) {
				throw failure((await failureOf(response)).message, `HTTP_${response.status}`);
			}
		} catch (error) {
			if (!isCLIError(error) || error.code !== 'NOT_SIGNED_IN') throw error;
		}
		await rm(await this.file(), { force: true });
	}
	private transport(session: Session): Transport {
		return async request => {
			const response = await fetch(`${this.origin}${request.path}`, {
				method: request.method,
				headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
				...(request.body === undefined ? {} : { body: request.body }),
				redirect: 'error',
				signal: AbortSignal.timeout(30000),
			});
			warnOutage(response);
			return response;
		};
	}
	async call<Q extends z.ZodType, S extends z.ZodType>(route: Route<Q, S>, input: z.input<Q>): Promise<z.output<S>> {
		const transport = this.transport(await this.session());
		try {
			return await call(route, input, transport);
		} catch (error) {
			if (!(error instanceof ApiFailure)) throw error;
			if (error.status === 401) throw failure('Session revoked', 'SESSION_REVOKED', signIn);
			throw failure(error.message, error.problem ? codes[error.problem.code] : `HTTP_${error.status}`);
		}
	}
	async status(): Promise<unknown> {
		const response = await this.transport(await this.session())({
			method: 'GET',
			path: '/auth/cli/status',
			body: undefined,
		});
		if (response.status === 401) throw failure('Session revoked', 'SESSION_REVOKED', signIn);
		if (!response.ok) throw failure((await failureOf(response)).message, `HTTP_${response.status}`);
		return response.json();
	}
	async elevated(prompts: SecurityKeyPrompts): Promise<string> {
		const challenge = await this.call(routes.authenticatorsOptions, { register: false });
		const response = await securityKeyAssertion(challenge.options, this.origin, prompts);
		const { proof } = await this.call(routes.authenticatorsVerify, { id: challenge.id, response });
		if (!proof) throw failure('The server returned no security-key proof', 'NO_PROOF');
		return proof;
	}
	async login(
		show: (url: string, code: string) => void | Promise<void>,
		signal = AbortSignal.timeout(300000),
	): Promise<void> {
		const verifier = loginSecret();
		const challenge = await sha256Hex(verifier);
		await show(`${this.origin}/auth/cli/authorize?challenge=${challenge}`, confirmationCode(challenge));
		while (!signal.aborted) {
			const response = await fetch(`${this.origin}/auth/cli/token`, {
				method: 'POST',
				body: verifier,
				redirect: 'error',
				signal,
			});
			warnOutage(response);
			if (response.status === 202) {
				await Bun.sleep(1500);
				continue;
			}
			if (response.status === 401 || response.status === 404) {
				throw failure(
					'This server does not provide CLI login',
					'LOGIN_UNAVAILABLE',
					'Deploy the matching Beepboop server or choose another --server',
				);
			}
			if (!response.ok) {
				throw failure(`Login failed (${response.status}): ${(await failureOf(response)).message}`, 'LOGIN_FAILED');
			}
			const session = parseSession(await response.json());
			if (!session) throw new Error('Invalid login response');
			await this.save(session);
			return;
		}
		throw failure('Login timed out', 'LOGIN_TIMEOUT', signIn);
	}
}
