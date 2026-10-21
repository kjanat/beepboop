import { createClient } from '@openauthjs/openauth/client';
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { integer, record, sha, text } from '#model';

export interface AuthBindings {
	DB: D1Database;
	APPLICATION_ORIGIN: string;
	OPENAUTH_ISSUER: string;
	OPENAUTH_CLIENT_ID: string;
	ADMIN_SUBJECT: string;
	AUTHENTICATOR_BOOTSTRAP_TOKEN?: string;
}
export interface WorkflowIdentity {
	helperSha?: string;
	repositoryId: number;
	repository: string;
	ownerId: number;
	runId: number;
	attempt: number;
	sha: string;
	workflowSha: string;
	workflowRef: string;
	ref: string;
	environment?: string;
	event: string;
}
const githubKeys = createRemoteJWKSet(
	new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),
);
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export function base64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}
export function bytes(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function workflowIdentity(
	request: Request,
	audience: string,
	ownerId: number,
): Promise<WorkflowIdentity> {
	const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
	if (!token || token.length > 20000) throw new Error('Workflow authentication required');
	const { payload } = await jwtVerify(token, githubKeys, {
		issuer: 'https://token.actions.githubusercontent.com',
		audience,
		algorithms: ['RS256'],
		requiredClaims: ['exp', 'iat', 'sub'],
	});
	const identity: WorkflowIdentity = {
		repositoryId: integer(Number(payload.repository_id)),
		repository: text(payload.repository),
		ownerId: integer(Number(payload.repository_owner_id)),
		runId: integer(Number(payload.run_id)),
		attempt: integer(Number(payload.run_attempt)),
		sha: sha(payload.sha),
		workflowSha: sha(payload.workflow_sha),
		...(payload.job_workflow_sha === undefined ? {} : { helperSha: sha(payload.job_workflow_sha) }),
		workflowRef: text(payload.workflow_ref),
		ref: text(payload.ref),
		event: text(payload.event_name),
		...(typeof payload.environment === 'string' ? { environment: payload.environment } : {}),
	};
	if (
		identity.ownerId !== ownerId
		|| ['pull_request', 'pull_request_target'].includes(identity.event)
	) {
		throw new Error('Workflow identity is not eligible');
	}
	return identity;
}
function cookie(request: Request, name: string): string | undefined {
	return request.headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1);
}
function cookieHeader(name: string, value: string, seconds: number): string {
	return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
export async function administrator(request: Request, env: AuthBindings): Promise<string> {
	const token = cookie(request, '__Host-beepboop_access');
	if (!token || token.length > 20000) throw new Error('Administrator login required');
	let key = keys.get(env.OPENAUTH_ISSUER);
	if (!key) {
		key = createRemoteJWKSet(new URL('/.well-known/jwks.json', env.OPENAUTH_ISSUER));
		keys.set(env.OPENAUTH_ISSUER, key);
	}
	const { payload } = await jwtVerify(token, key, {
		issuer: env.OPENAUTH_ISSUER,
		audience: env.OPENAUTH_CLIENT_ID,
		algorithms: ['ES256', 'RS256'],
		requiredClaims: ['exp', 'sub', 'iat'],
	});
	if (payload.mode !== 'access' || payload.type !== 'user') {
		throw new Error('Administrator access token required');
	}
	if (!env.ADMIN_SUBJECT || payload.sub !== env.ADMIN_SUBJECT) {
		throw new Error('Administrator access denied');
	}
	if (request.method !== 'GET' && request.headers.get('origin') !== env.APPLICATION_ORIGIN) {
		throw new Error('Invalid request origin');
	}
	return payload.sub;
}
export async function authRoute(
	request: Request,
	env: AuthBindings,
): Promise<Response | undefined> {
	const path = new URL(request.url).pathname;
	const client = createClient({ clientID: env.OPENAUTH_CLIENT_ID, issuer: env.OPENAUTH_ISSUER });
	if (path === '/auth/login') {
		const { url, challenge } = await client.authorize(
			`${env.APPLICATION_ORIGIN}/auth/callback`,
			'code',
			{ pkce: true },
		);
		const id = crypto.randomUUID();
		await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)')
			.bind(id, JSON.stringify(challenge), Date.now() + 600000)
			.run();
		return new Response(null, {
			status: 302,
			headers: { Location: url, 'Set-Cookie': cookieHeader('__Host-beepboop_flow', id, 600) },
		});
	}
	if (path === '/auth/callback') {
		const id = cookie(request, '__Host-beepboop_flow');
		const row = id
			? await env.DB.prepare('DELETE FROM sessions WHERE id=? AND expires_at>? RETURNING document')
				.bind(id, Date.now())
				.first<{ document: string }>()
			: null;
		if (!row) throw new Error('Login expired');
		const flow = record(JSON.parse(row.document)),
			url = new URL(request.url);
		if (url.searchParams.get('state') !== flow.state) throw new Error('Login state mismatch');
		const result = await client.exchange(
			text(url.searchParams.get('code')),
			`${env.APPLICATION_ORIGIN}/auth/callback`,
			text(flow.verifier),
		);
		if (result.err) throw new Error('Login exchange failed');
		// Validate the exchanged token before creating the browser session.
		const probe = new Request(`${env.APPLICATION_ORIGIN}/`, {
			headers: { Cookie: `__Host-beepboop_access=${result.tokens.access}` },
		});
		await administrator(probe, env);
		return new Response(null, {
			status: 302,
			headers: {
				Location: '/',
				'Set-Cookie': cookieHeader(
					'__Host-beepboop_access',
					result.tokens.access,
					result.tokens.expiresIn,
				),
			},
		});
	}
	if (path === '/auth/logout' && request.method === 'POST') {
		await administrator(request, env);
		return new Response(null, {
			status: 303,
			headers: {
				Location: '/auth/login',
				'Set-Cookie': cookieHeader('__Host-beepboop_access', '', 0),
			},
		});
	}
	return undefined;
}

interface SavedCredential {
	label?: string;
	id: string;
	publicKey: string;
	counter: number;
	transports?: WebAuthnCredential['transports'];
}
export class Authenticators {
	constructor(private env: AuthBindings) {}
	private async credentials(subject: string): Promise<SavedCredential[]> {
		return (
			await this.env.DB.prepare('SELECT document FROM authenticators WHERE subject=?')
				.bind(subject)
				.all<{ document: string }>()
		).results.map((row) => JSON.parse(row.document));
	}
	async options(
		subject: string,
		register: boolean,
		bootstrap?: string,
		label?: string,
	): Promise<unknown> {
		const credentials = await this.credentials(subject),
			rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
		if (
			register
			&& credentials.length === 0
			&& (!this.env.AUTHENTICATOR_BOOTSTRAP_TOKEN
				|| bootstrap !== this.env.AUTHENTICATOR_BOOTSTRAP_TOKEN)
		) {
			throw new Error('Initial key enrollment requires the deployment bootstrap token');
		}
		const options = register
			? await generateRegistrationOptions({
				rpID,
				rpName: 'Beepboop',
				userName: subject,
				userID: new TextEncoder().encode(subject),
				excludeCredentials: credentials.map((c) => ({ id: c.id })),
				authenticatorSelection: {
					authenticatorAttachment: 'cross-platform',
					userVerification: 'required',
					residentKey: 'discouraged',
				},
				preferredAuthenticatorType: 'securityKey',
				supportedAlgorithmIDs: [-7, -257],
			})
			: await generateAuthenticationOptions({
				rpID,
				userVerification: 'required',
				allowCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports })),
			});
		const id = crypto.randomUUID();
		await this.env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)')
			.bind(
				id,
				JSON.stringify({
					subject,
					register,
					bootstrap: register && credentials.length === 0,
					label: label?.slice(0, 80),
					challenge: options.challenge,
				}),
				Date.now() + 120000,
			)
			.run();
		return { id, options };
	}
	async verify(subject: string, id: string, response: unknown): Promise<{ proof?: string }> {
		const row = await this.env.DB.prepare(
			'DELETE FROM sessions WHERE id=? AND expires_at>? RETURNING document',
		)
			.bind(id, Date.now())
			.first<{ document: string }>();
		if (!row) throw new Error('Challenge expired');
		const challenge = record(JSON.parse(row.document));
		if (challenge.subject !== subject) throw new Error('Challenge subject mismatch');
		const rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
		if (challenge.register) {
			const result = await verifyRegistrationResponse({
				response: response as RegistrationResponseJSON,
				expectedChallenge: text(challenge.challenge),
				expectedOrigin: this.env.APPLICATION_ORIGIN,
				expectedRPID: rpID,
				requireUserVerification: true,
				supportedAlgorithmIDs: [-7, -257],
			});
			if (
				!result.verified
				|| result.registrationInfo.credentialBackedUp
				|| result.registrationInfo.credentialDeviceType !== 'singleDevice'
			) {
				throw new Error('A physical security key is required');
			}
			const c = result.registrationInfo.credential;
			const document = JSON.stringify({
				...c,
				label: challenge.label,
				publicKey: base64(c.publicKey),
			});
			const insert = challenge.bootstrap === true
				? this.env.DB.prepare(
					'INSERT INTO authenticators SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM authenticators WHERE subject=?)',
				).bind(c.id, subject, document, subject)
				: this.env.DB.prepare('INSERT INTO authenticators VALUES(?,?,?)').bind(
					c.id,
					subject,
					document,
				);
			if ((await insert.run()).meta.changes !== 1) {
				throw new Error('Initial key was already enrolled; authenticate with the existing key');
			}
			return {};
		}
		const saved = (await this.credentials(subject)).find((c) => c.id === record(response).id);
		if (!saved) throw new Error('Unknown authenticator');
		const result = await verifyAuthenticationResponse({
			response: response as AuthenticationResponseJSON,
			expectedChallenge: text(challenge.challenge),
			expectedOrigin: this.env.APPLICATION_ORIGIN,
			expectedRPID: rpID,
			credential: { ...saved, publicKey: bytes(saved.publicKey) },
			requireUserVerification: true,
		});
		if (!result.verified) throw new Error('Authentication failed');
		const update = await this.env.DB.prepare(
			'UPDATE authenticators SET document=? WHERE id=? AND document=?',
		)
			.bind(
				JSON.stringify({ ...saved, counter: result.authenticationInfo.newCounter }),
				saved.id,
				JSON.stringify(saved),
			)
			.run();
		if (update.meta.changes !== 1) throw new Error('Authenticator changed during verification');
		const proof = crypto.randomUUID();
		await this.env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)')
			.bind(proof, JSON.stringify({ subject, elevated: true }), Date.now() + 60000)
			.run();
		return { proof };
	}
	async consume(subject: string, proof: string): Promise<void> {
		const row = await this.env.DB.prepare(
			'DELETE FROM sessions WHERE id=? AND expires_at>? RETURNING document',
		)
			.bind(proof, Date.now())
			.first<{ document: string }>();
		if (!row) throw new Error('Fresh security-key authentication required');
		const data = record(JSON.parse(row.document));
		if (data.subject !== subject || data.elevated !== true) {
			throw new Error('Invalid authentication proof');
		}
	}
	async enrolled(subject: string): Promise<number> {
		return (await this.credentials(subject)).length;
	}
	async list(subject: string): Promise<{ id: string; label: string }[]> {
		return (await this.credentials(subject)).map((c) => ({
			id: c.id,
			label: c.label ?? 'Security key',
		}));
	}
	async remove(subject: string, id: string): Promise<void> {
		const result = await this.env.DB.prepare(
			'DELETE FROM authenticators WHERE subject=? AND id=? AND (SELECT count(*) FROM authenticators WHERE subject=?)>1',
		)
			.bind(subject, id, subject)
			.run();
		if (result.meta.changes !== 1) {
			throw new Error('Cannot remove the last enrolled key or an unknown key');
		}
	}
}
