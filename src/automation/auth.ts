import { createClient } from '@kjanat/openauth/client';
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { z } from 'zod';
import { cliAuthRoute, cliSubject } from '@/automation/cli-auth';
import { documentRow } from '@/automation/schemas';
import { forbidden, unauthenticated } from '@/contract/errors';
import { loginSecretPattern } from '@/contract/ids';
import { integer, record, sha, text } from '@/model';
import { SessionStore } from '@/persistence/d1/sessions';

const clientExtensionResults = z.object({}).catch({});
const registrationResponse: z.ZodType<RegistrationResponseJSON> = z.object({
	id: z.string(),
	rawId: z.string(),
	type: z.literal('public-key'),
	response: z.object({
		clientDataJSON: z.string(),
		attestationObject: z.string(),
		authenticatorData: z.string().optional(),
		transports: z.array(z.string()).optional(),
		publicKeyAlgorithm: z.number().optional(),
		publicKey: z.string().optional(),
	}),
	clientExtensionResults,
});
const authenticationResponse: z.ZodType<AuthenticationResponseJSON> = z.object({
	id: z.string(),
	rawId: z.string(),
	type: z.literal('public-key'),
	response: z.object({
		clientDataJSON: z.string(),
		authenticatorData: z.string(),
		signature: z.string(),
		userHandle: z.string().nullish().transform(value => value ?? undefined),
	}),
	clientExtensionResults,
});

export interface AuthBindings {
	DB: D1Database;
	APPLICATION_ORIGIN: string;
	OPENAUTH_ISSUER: string;
	OPENAUTH_CLIENT_ID: string;
	ADMIN_SUBJECT: string;
}
export interface WorkflowIdentity {
	helperSha?: string;
	repositoryId: number;
	repository: string;
	ownerId: number;
	actorId: number;
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
async function verified<T>(verification: Promise<T>): Promise<T> {
	try {
		return await verification;
	} catch (error) {
		if (error instanceof errors.JOSEError) throw unauthenticated(error.message);
		throw error;
	}
}
export async function workflowIdentity(
	request: Request,
	audience: string,
	ownerId: number,
	issuerKeys: JWTVerifyGetKey = githubKeys,
): Promise<WorkflowIdentity> {
	const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
	if (!token || token.length > 20000) throw unauthenticated('Workflow authentication required');
	const { payload } = await verified(jwtVerify(token, issuerKeys, {
		issuer: 'https://token.actions.githubusercontent.com',
		audience,
		algorithms: ['RS256'],
		requiredClaims: ['exp', 'iat', 'sub'],
	}));
	const identity: WorkflowIdentity = {
		repositoryId: integer(Number(payload.repository_id)),
		repository: text(payload.repository),
		ownerId: integer(Number(payload.repository_owner_id)),
		actorId: integer(Number(payload.actor_id)),
		runId: integer(Number(payload.run_id)),
		attempt: integer(Number(payload.run_attempt)),
		sha: sha(payload.sha),
		workflowSha: sha(payload.workflow_sha),
		...(payload.job_workflow_sha === undefined || payload.job_workflow_ref === payload.workflow_ref
			? {}
			: { helperSha: sha(payload.job_workflow_sha) }),
		workflowRef: text(payload.workflow_ref),
		ref: text(payload.ref),
		event: text(payload.event_name),
		...(typeof payload.environment === 'string' ? { environment: payload.environment } : {}),
	};
	if (
		identity.ownerId !== ownerId
		|| identity.event === 'pull_request_target'
	) {
		throw forbidden('Workflow identity is not eligible');
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
const accessCookie = '__Host-beepboop_access';
const refreshCookie = '__Host-beepboop_refresh';
const refreshSeconds = 60 * 60 * 24 * 30;
export interface SessionTokens {
	access: string;
	refresh: string;
	expiresIn: number;
}
function sessionHeaders(tokens: SessionTokens | undefined, location?: string): Headers {
	const headers = new Headers(location === undefined ? {} : { Location: location });
	headers.append('Set-Cookie', cookieHeader(accessCookie, tokens?.access ?? '', tokens?.expiresIn ?? 0));
	headers.append('Set-Cookie', cookieHeader(refreshCookie, tokens?.refresh ?? '', tokens ? refreshSeconds : 0));
	return headers;
}
export async function administrator(
	request: Request,
	env:
		& Pick<AuthBindings, 'APPLICATION_ORIGIN' | 'OPENAUTH_ISSUER' | 'OPENAUTH_CLIENT_ID' | 'ADMIN_SUBJECT'>
		& Partial<Pick<AuthBindings, 'DB'>>,
): Promise<string> {
	if (request.headers.has('authorization')) return cliSubject(request, env);
	const token = cookie(request, '__Host-beepboop_access');
	if (!token || token.length > 20000) throw unauthenticated('Administrator login required');
	let key = keys.get(env.OPENAUTH_ISSUER);
	if (!key) {
		key = createRemoteJWKSet(new URL('/.well-known/jwks.json', env.OPENAUTH_ISSUER));
		keys.set(env.OPENAUTH_ISSUER, key);
	}
	const { payload } = await verified(jwtVerify(token, key, {
		issuer: env.OPENAUTH_ISSUER,
		audience: env.OPENAUTH_CLIENT_ID,
		algorithms: ['ES256', 'RS256'],
		requiredClaims: ['exp', 'sub'],
	}));
	if (payload.mode !== 'access' || payload.type !== 'user') {
		throw unauthenticated('Administrator access token required');
	}
	if (!env.ADMIN_SUBJECT || payload.sub !== env.ADMIN_SUBJECT) {
		throw forbidden('Administrator access denied');
	}
	if (request.method !== 'GET' && request.headers.get('origin') !== env.APPLICATION_ORIGIN) {
		throw forbidden('Invalid request origin');
	}
	return payload.sub;
}
export interface LoginCompletion {
	consumeFlow(id: string): Promise<string | null>;
	exchange(code: string, verifier: string): Promise<SessionTokens>;
	verify(access: string): Promise<string>;
}
function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
function loginFailed(reason: string): Response {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in failed · Beepboop</title></head><body><main><h1>Sign-in failed</h1><p>${
			escapeHtml(reason)
		}</p><p><a href="/auth/login">Sign in again</a></p></main></body></html>`,
		{
			status: 401,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store',
				'Set-Cookie': cookieHeader('__Host-beepboop_flow', '', 0),
			},
		},
	);
}
export function returnPath(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
	const url = new URL(value, 'https://beepboop.invalid');
	return url.origin === 'https://beepboop.invalid' && !url.pathname.startsWith('/auth/')
		? `${url.pathname}${url.search}`
		: '/';
}
function loginTarget(cli: unknown, target: unknown): string {
	return typeof cli === 'string' && loginSecretPattern.test(cli)
		? `/auth/cli/authorize?challenge=${cli}`
		: returnPath(target);
}
export async function completeLogin(request: Request, steps: LoginCompletion): Promise<Response> {
	const id = cookie(request, '__Host-beepboop_flow');
	if (!id) return loginFailed('This sign-in link has no login attempt behind it. Cookies may be blocked.');
	const document = await steps.consumeFlow(id);
	if (!document) return new Response(null, { status: 302, headers: { Location: '/auth/login' } });
	try {
		const flow = record(JSON.parse(document)),
			url = new URL(request.url);
		if (url.searchParams.get('state') !== flow.state) {
			return new Response(null, { status: 302, headers: { Location: '/auth/login' } });
		}
		const tokens = await steps.exchange(text(url.searchParams.get('code')), text(flow.verifier));
		await steps.verify(tokens.access);
		return new Response(null, { status: 302, headers: sessionHeaders(tokens, loginTarget(flow.cli, flow.return)) });
	} catch (error) {
		return loginFailed(error instanceof Error ? error.message : 'Login failed');
	}
}
export async function authRoute(
	request: Request,
	env: AuthBindings,
): Promise<Response | undefined> {
	const path = new URL(request.url).pathname;
	if (path.startsWith('/auth/cli/')) return cliAuthRoute(request, env, administrator);
	const client = createClient({ clientID: env.OPENAUTH_CLIENT_ID, issuer: env.OPENAUTH_ISSUER });
	const renew = async (): Promise<SessionTokens | undefined> => {
		const refresh = cookie(request, refreshCookie);
		if (!refresh || refresh.length > 4096) return undefined;
		const result = await client.refresh(refresh).catch(() => undefined);
		if (!result || result.err || !result.tokens) return undefined;
		const tokens = result.tokens;
		const verified = await administrator(
			new Request(`${env.APPLICATION_ORIGIN}/`, { headers: { Cookie: `${accessCookie}=${tokens.access}` } }),
			env,
		).catch(() => undefined);
		return verified ? { access: tokens.access, refresh: tokens.refresh, expiresIn: tokens.expiresIn } : undefined;
	};
	if (path === '/auth/renew' && request.method === 'POST') {
		if (request.headers.get('origin') !== env.APPLICATION_ORIGIN) {
			return Response.json({ error: 'Invalid request origin' }, { status: 403 });
		}
		const tokens = await renew();
		return new Response(null, { status: tokens ? 204 : 401, headers: sessionHeaders(tokens) });
	}
	if (path === '/auth/login') {
		const parameters = new URL(request.url).searchParams;
		const renewed = await renew();
		if (renewed) {
			return new Response(null, {
				status: 302,
				headers: sessionHeaders(renewed, loginTarget(parameters.get('cli'), parameters.get('return'))),
			});
		}
		const { url, challenge } = await client.authorize(
			`${env.APPLICATION_ORIGIN}/auth/callback`,
			'code',
			{ pkce: true },
		);
		const id = crypto.randomUUID();
		await new SessionStore(env.DB).open('login-flow', id, {
			...challenge,
			cli: new URL(request.url).searchParams.get('cli'),
			return: returnPath(new URL(request.url).searchParams.get('return')),
		}, 600000);
		return new Response(null, {
			status: 302,
			headers: { Location: url, 'Set-Cookie': cookieHeader('__Host-beepboop_flow', id, 600) },
		});
	}
	if (path === '/auth/callback') {
		return completeLogin(request, {
			consumeFlow: async (id) => (await new SessionStore(env.DB).take(id)) ?? null,
			exchange: async (code, verifier) => {
				const result = await client.exchange(code, `${env.APPLICATION_ORIGIN}/auth/callback`, verifier).catch(() =>
					null
				);
				if (!result || result.err) throw new Error('Login exchange failed');
				return {
					access: result.tokens.access,
					refresh: result.tokens.refresh,
					expiresIn: result.tokens.expiresIn,
				};
			},
			verify: (access) =>
				administrator(
					new Request(`${env.APPLICATION_ORIGIN}/`, { headers: { Cookie: `__Host-beepboop_access=${access}` } }),
					env,
				),
		});
	}
	if (path === '/auth/logout' && request.method === 'POST') {
		return signOut(request, env.APPLICATION_ORIGIN, refresh => client.revoke(refresh));
	}
	return undefined;
}
export async function signOut(
	request: Request,
	origin: string,
	revoke: (refresh: string) => Promise<void>,
): Promise<Response> {
	if (request.headers.get('origin') !== origin) {
		return Response.json({ error: 'Invalid request origin' }, { status: 403 });
	}
	const refresh = cookie(request, refreshCookie);
	if (refresh && refresh.length <= 4096) {
		await revoke(refresh).catch(error =>
			console.error(JSON.stringify({ event: 'auth.revoke_failed', error: String(error) }))
		);
	}
	return new Response(null, { status: 303, headers: sessionHeaders(undefined, '/auth/login') });
}
export function enrollmentRefusal(register: boolean, enrolled: number): string | undefined {
	return !register && enrolled === 0 ? 'Enroll a security key first.' : undefined;
}

interface SavedCredential {
	label?: string;
	id: string;
	publicKey: string;
	counter: number;
	transports?: WebAuthnCredential['transports'];
}
const savedCredential: z.ZodType<SavedCredential> = z.object({
	label: z.string().optional(),
	id: z.string(),
	publicKey: z.string(),
	counter: z.number(),
	transports: z.array(z.string()).optional(),
});
export class Authenticators {
	private readonly sessions: SessionStore;
	constructor(private env: AuthBindings) {
		this.sessions = new SessionStore(env.DB);
	}
	private async saved(subject: string): Promise<{ document: string; credential: SavedCredential }[]> {
		return (
			await this.env.DB.prepare('SELECT document FROM authenticators WHERE subject=?')
				.bind(subject)
				.all()
		).results.map((row) => {
			const { document } = documentRow.parse(row);
			return { document, credential: savedCredential.parse(JSON.parse(document)) };
		});
	}
	private async credentials(subject: string): Promise<SavedCredential[]> {
		return (await this.saved(subject)).map(entry => entry.credential);
	}
	async options(
		subject: string,
		register: boolean,
		label?: string,
	): Promise<{ id: string; options: unknown }> {
		const credentials = await this.credentials(subject),
			rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
		const refusal = enrollmentRefusal(register, credentials.length);
		if (refusal) throw new Error(refusal);
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
		await this.sessions.open('security-challenge', id, {
			subject,
			register,
			first: register && credentials.length === 0,
			label: label?.slice(0, 80),
			challenge: options.challenge,
		}, 120000);
		return { id, options };
	}
	async verify(subject: string, id: string, response: unknown): Promise<{ proof?: string }> {
		const document = await this.sessions.take(id);
		if (document === undefined) throw forbidden('Challenge expired');
		const challenge = record(JSON.parse(document));
		if (challenge.subject !== subject) throw forbidden('Challenge subject mismatch');
		const rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
		if (challenge.register) {
			const result = await verifyRegistrationResponse({
				response: registrationResponse.parse(response),
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
			const insert = challenge.first === true
				? this.env.DB.prepare(
					'INSERT INTO authenticators(id,subject,document) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM authenticators WHERE subject=?)',
				).bind(c.id, subject, document, subject)
				: this.env.DB.prepare('INSERT INTO authenticators(id,subject,document) VALUES(?,?,?)').bind(
					c.id,
					subject,
					document,
				);
			if ((await insert.run()).meta.changes !== 1) {
				throw new Error('Initial key was already enrolled; authenticate with the existing key');
			}
			return {};
		}
		const stored = (await this.saved(subject)).find((entry) => entry.credential.id === record(response).id);
		if (!stored) throw new Error('Unknown authenticator');
		const saved = stored.credential;
		const result = await verifyAuthenticationResponse({
			response: authenticationResponse.parse(response),
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
				stored.document,
			)
			.run();
		if (update.meta.changes !== 1) throw new Error('Authenticator changed during verification');
		const proof = crypto.randomUUID();
		await this.sessions.open('elevation', proof, { subject, elevated: true }, 60000);
		return { proof };
	}
	async consume(subject: string, proof: string): Promise<void> {
		const document = await this.sessions.take(proof);
		if (document === undefined) throw forbidden('Fresh security-key authentication required');
		const data = record(JSON.parse(document));
		if (data.subject !== subject || data.elevated !== true) {
			throw forbidden('Invalid authentication proof');
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
