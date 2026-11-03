import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { credentialHash } from '@/automation/cli-auth';

export interface Session {
	token: string;
	expiresAt: number;
}
function parseSession(value: unknown): Session | undefined {
	if (typeof value !== 'object' || value === null || !('token' in value) || !('expiresAt' in value)) return undefined;
	const { token, expiresAt } = value;
	if (typeof token !== 'string' || !/^cli_[a-f0-9]{64}$/.test(token) || typeof expiresAt !== 'number') return undefined;
	return { token, expiresAt };
}
export function serverOrigin(value: string): string {
	const url = new URL(value);
	if (
		url.protocol !== 'https:'
		&& !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
	) {
		throw new Error('Use HTTPS, or HTTP on localhost for development');
	}
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('Server must be an origin, without credentials or a path');
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
		return join(this.directory, `${await credentialHash(this.origin)}.json`);
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
			throw new Error('Not signed in. Run beepboop auth login');
		}
		const session = parseSession(saved);
		if (!session || session.expiresAt <= Date.now()) throw new Error('Session expired. Run beepboop auth login');
		return session;
	}
	async logout(): Promise<void> {
		try {
			await this.request('/auth/cli/logout', {});
		} catch (error) {
			if (!(error instanceof Error) || !/^(Not signed in|Session expired)/.test(error.message)) throw error;
		}
		await rm(await this.file(), { force: true });
	}
	async request(path: string, body?: unknown): Promise<unknown> {
		const session = await this.session();
		const response = await fetch(`${this.origin}${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
		});
		if (response.status === 401) throw new Error('Session expired or revoked. Run beepboop auth login');
		if (!response.ok) throw new Error(`Beepboop request failed (${response.status}): ${await response.text()}`);
		return response.json();
	}
	async login(
		show: (url: string, code: string) => void | Promise<void>,
		signal = AbortSignal.timeout(300000),
	): Promise<void> {
		const verifier = `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
		const challenge = await credentialHash(verifier);
		await show(`${this.origin}/auth/cli/authorize?challenge=${challenge}`, challenge.slice(0, 8));
		while (!signal.aborted) {
			const response = await fetch(`${this.origin}/auth/cli/token`, {
				method: 'POST',
				body: verifier,
				redirect: 'error',
				signal,
			});
			if (response.status === 202) {
				await Bun.sleep(1500);
				continue;
			}
			if (response.status === 401 || response.status === 404) {
				throw new Error(
					'This server does not provide CLI login yet. Deploy the matching Beepboop server or choose another --server.',
				);
			}
			if (!response.ok) throw new Error(`Login failed (${response.status})`);
			const session = parseSession(await response.json());
			if (!session || !(session.expiresAt > Date.now())) throw new Error('Invalid login response');
			await this.save(session);
			return;
		}
		throw new Error('Login timed out. Run beepboop auth login again');
	}
}
