import { createClient } from '@kjanat/openauth/client';
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { Effect, Result } from 'effect';
import type { JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import { cliAuthRoute, cliSubject } from '@/automation/cli-auth';
import { documentRow } from '@/automation/schemas';
import { decodeError } from '@/automation/store';
import type { DomainError } from '@/contract/errors';
import { decodeRequest, forbidden, precondition, unauthenticated } from '@/contract/errors';
import { loginSecretPattern } from '@/contract/ids';
import { fromJson, fromPromise, fromSync, recover, toDomainError } from '@/failure';
import { integer, record, sha, text } from '@/model';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { sql } from '@/persistence/d1/database';
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
	DB: SqlDatabase;
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
function verified<T>(verification: () => Promise<T>): Effect.Effect<T, DomainError> {
	return Effect.tryPromise({
		try: verification,
		catch: error => error instanceof errors.JOSEError ? unauthenticated(error.message) : toDomainError(error),
	});
}
export function workflowIdentity(
	request: Request,
	audience: string,
	ownerId: number,
	issuerKeys: JWTVerifyGetKey = githubKeys,
): Effect.Effect<WorkflowIdentity, DomainError> {
	return Effect.gen(function*() {
		const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
		if (!token || token.length > 20000) return yield* unauthenticated('Workflow authentication required');
		const { payload } = yield* verified(() =>
			jwtVerify(token, issuerKeys, {
				issuer: 'https://token.actions.githubusercontent.com',
				audience,
				algorithms: ['RS256'],
				requiredClaims: ['exp', 'iat', 'sub'],
			})
		);
		const identity: WorkflowIdentity = yield* Effect.fromResult(Result.gen(function*() {
			return {
				repositoryId: yield* integer(Number(payload.repository_id)),
				repository: yield* text(payload.repository),
				ownerId: yield* integer(Number(payload.repository_owner_id)),
				actorId: yield* integer(Number(payload.actor_id)),
				runId: yield* integer(Number(payload.run_id)),
				attempt: yield* integer(Number(payload.run_attempt)),
				sha: yield* sha(payload.sha),
				workflowSha: yield* sha(payload.workflow_sha),
				...(payload.job_workflow_sha === undefined || payload.job_workflow_ref === payload.workflow_ref
					? {}
					: { helperSha: yield* sha(payload.job_workflow_sha) }),
				workflowRef: yield* text(payload.workflow_ref),
				ref: yield* text(payload.ref),
				event: yield* text(payload.event_name),
				...(typeof payload.environment === 'string' ? { environment: payload.environment } : {}),
			};
		}));
		if (identity.ownerId !== ownerId || identity.event === 'pull_request_target') {
			return yield* forbidden('Workflow identity is not eligible');
		}
		return identity;
	});
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
export function administrator(
	request: Request,
	env:
		& Pick<AuthBindings, 'APPLICATION_ORIGIN' | 'OPENAUTH_ISSUER' | 'OPENAUTH_CLIENT_ID' | 'ADMIN_SUBJECT'>
		& Partial<Pick<AuthBindings, 'DB'>>,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		if (request.headers.has('authorization')) return yield* cliSubject(request, env);
		const token = cookie(request, '__Host-beepboop_access');
		if (!token || token.length > 20000) return yield* unauthenticated('Administrator login required');
		let key = keys.get(env.OPENAUTH_ISSUER);
		if (!key) {
			key = createRemoteJWKSet(new URL('/.well-known/jwks.json', env.OPENAUTH_ISSUER));
			keys.set(env.OPENAUTH_ISSUER, key);
		}
		const issuerKey = key;
		const { payload } = yield* verified(() =>
			jwtVerify(token, issuerKey, {
				issuer: env.OPENAUTH_ISSUER,
				audience: env.OPENAUTH_CLIENT_ID,
				algorithms: ['ES256', 'RS256'],
				requiredClaims: ['exp', 'sub'],
			})
		);
		if (payload.mode !== 'access' || payload.type !== 'user') {
			return yield* unauthenticated('Administrator access token required');
		}
		if (!env.ADMIN_SUBJECT || payload.sub !== env.ADMIN_SUBJECT) {
			return yield* forbidden('Administrator access denied');
		}
		if (request.method !== 'GET' && request.headers.get('origin') !== env.APPLICATION_ORIGIN) {
			return yield* forbidden('Invalid request origin');
		}
		return payload.sub;
	});
}
export interface LoginCompletion {
	consumeFlow(id: string): Effect.Effect<string | undefined, DomainError>;
	exchange(code: string, verifier: string): Effect.Effect<SessionTokens, DomainError>;
	verify(access: string): Effect.Effect<string, DomainError>;
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
export function completeLogin(request: Request, steps: LoginCompletion): Effect.Effect<Response, DomainError> {
	return Effect.gen(function*() {
		const id = cookie(request, '__Host-beepboop_flow');
		if (!id) return loginFailed('This sign-in link has no login attempt behind it. Cookies may be blocked.');
		const document = yield* steps.consumeFlow(id);
		if (!document) return new Response(null, { status: 302, headers: { Location: '/auth/login' } });
		return yield* Effect.gen(function*() {
			const flow = yield* Effect.fromResult(record(yield* fromJson(document)));
			const url = new URL(request.url);
			if (url.searchParams.get('state') !== flow.state) {
				return new Response(null, { status: 302, headers: { Location: '/auth/login' } });
			}
			const code = yield* Effect.fromResult(text(url.searchParams.get('code')));
			const verifier = yield* Effect.fromResult(text(flow.verifier));
			const tokens = yield* steps.exchange(code, verifier);
			yield* steps.verify(tokens.access);
			return new Response(null, { status: 302, headers: sessionHeaders(tokens, loginTarget(flow.cli, flow.return)) });
		}).pipe(recover(error => Effect.succeed(loginFailed(decodeError(error)))));
	});
}
export function authRoute(request: Request, env: AuthBindings): Effect.Effect<Response | undefined, DomainError> {
	return Effect.gen(function*() {
		const path = new URL(request.url).pathname;
		if (path.startsWith('/auth/cli/')) return yield* cliAuthRoute(request, env, administrator);
		const client = createClient({ clientID: env.OPENAUTH_CLIENT_ID, issuer: env.OPENAUTH_ISSUER });
		const renew: Effect.Effect<SessionTokens | undefined> = Effect.gen(function*() {
			const refresh = cookie(request, refreshCookie);
			if (!refresh || refresh.length > 4096) return undefined;
			const result = yield* Effect.promise(() => client.refresh(refresh).catch(() => undefined));
			if (!result || result.err || !result.tokens) return undefined;
			const tokens = result.tokens;
			const verified = yield* administrator(
				new Request(`${env.APPLICATION_ORIGIN}/`, { headers: { Cookie: `${accessCookie}=${tokens.access}` } }),
				env,
			).pipe(Effect.catch(() => Effect.undefined));
			return verified ? { access: tokens.access, refresh: tokens.refresh, expiresIn: tokens.expiresIn } : undefined;
		});
		if (path === '/auth/renew' && request.method === 'POST') {
			if (request.headers.get('origin') !== env.APPLICATION_ORIGIN) {
				return Response.json({ error: 'Invalid request origin' }, { status: 403 });
			}
			const tokens = yield* renew;
			return new Response(null, { status: tokens ? 204 : 401, headers: sessionHeaders(tokens) });
		}
		if (path === '/auth/login') {
			const parameters = new URL(request.url).searchParams;
			const renewed = yield* renew;
			if (renewed) {
				return new Response(null, {
					status: 302,
					headers: sessionHeaders(renewed, loginTarget(parameters.get('cli'), parameters.get('return'))),
				});
			}
			const { url, challenge } = yield* fromPromise(() =>
				client.authorize(`${env.APPLICATION_ORIGIN}/auth/callback`, 'code', { pkce: true })
			);
			const id = crypto.randomUUID();
			yield* new SessionStore(env.DB).open('login-flow', id, {
				...challenge,
				cli: parameters.get('cli'),
				return: returnPath(parameters.get('return')),
			}, 600000);
			return new Response(null, {
				status: 302,
				headers: { Location: url, 'Set-Cookie': cookieHeader('__Host-beepboop_flow', id, 600) },
			});
		}
		if (path === '/auth/callback') {
			return yield* completeLogin(request, {
				consumeFlow: id => new SessionStore(env.DB).take(id),
				exchange: (code, verifier) =>
					Effect.gen(function*() {
						const result = yield* Effect.promise(() =>
							client.exchange(code, `${env.APPLICATION_ORIGIN}/auth/callback`, verifier).catch(() => null)
						);
						if (!result || result.err) return yield* precondition('Login exchange failed');
						return {
							access: result.tokens.access,
							refresh: result.tokens.refresh,
							expiresIn: result.tokens.expiresIn,
						};
					}),
				verify: access =>
					administrator(
						new Request(`${env.APPLICATION_ORIGIN}/`, { headers: { Cookie: `__Host-beepboop_access=${access}` } }),
						env,
					),
			});
		}
		if (path === '/auth/logout' && request.method === 'POST') {
			return yield* signOut(request, env.APPLICATION_ORIGIN, refresh => fromPromise(() => client.revoke(refresh)));
		}
		return undefined;
	});
}
export function signOut(
	request: Request,
	origin: string,
	revoke: (refresh: string) => Effect.Effect<void, DomainError>,
): Effect.Effect<Response> {
	return Effect.gen(function*() {
		if (request.headers.get('origin') !== origin) {
			return Response.json({ error: 'Invalid request origin' }, { status: 403 });
		}
		const refresh = cookie(request, refreshCookie);
		if (refresh && refresh.length <= 4096) {
			yield* revoke(refresh).pipe(
				recover(error =>
					Effect.sync(() => console.error(JSON.stringify({ event: 'auth.revoke_failed', error: decodeError(error) })))
				),
			);
		}
		return new Response(null, { status: 303, headers: sessionHeaders(undefined, '/auth/login') });
	});
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
	private readonly sql: Sql;
	constructor(private env: AuthBindings) {
		this.sessions = new SessionStore(env.DB);
		this.sql = sql(env.DB);
	}
	private saved(subject: string): Effect.Effect<{ document: string; credential: SavedCredential }[], DomainError> {
		return this.sql.all('SELECT document FROM authenticators WHERE subject=?', subject).pipe(
			Effect.flatMap(rows =>
				fromSync(() =>
					rows.map(row => {
						const { document } = documentRow.parse(row);
						return { document, credential: savedCredential.parse(JSON.parse(document)) };
					})
				)
			),
		);
	}
	private credentials(subject: string): Effect.Effect<SavedCredential[], DomainError> {
		return this.saved(subject).pipe(Effect.map(entries => entries.map(entry => entry.credential)));
	}
	options(
		subject: string,
		register: boolean,
		label?: string,
	): Effect.Effect<{ id: string; options: unknown }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const credentials = yield* this.credentials(subject);
			const rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
			const refusal = enrollmentRefusal(register, credentials.length);
			if (refusal) return yield* precondition(refusal);
			const options = register
				? yield* fromPromise(() =>
					generateRegistrationOptions({
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
				)
				: yield* fromPromise(() =>
					generateAuthenticationOptions({
						rpID,
						userVerification: 'required',
						allowCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports })),
					})
				);
			const id = crypto.randomUUID();
			yield* this.sessions.open('security-challenge', id, {
				subject,
				register,
				first: register && credentials.length === 0,
				label: label?.slice(0, 80),
				challenge: options.challenge,
			}, 120000);
			return { id, options };
		});
	}
	private register(
		subject: string,
		challenge: Record<string, unknown>,
		response: unknown,
		rpID: string,
	): Effect.Effect<{ proof?: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const parsed = yield* decodeRequest(registrationResponse, response);
			const expectedChallenge = yield* Effect.fromResult(text(challenge.challenge));
			const result = yield* fromPromise(() =>
				verifyRegistrationResponse({
					response: parsed,
					expectedChallenge,
					expectedOrigin: this.env.APPLICATION_ORIGIN,
					expectedRPID: rpID,
					requireUserVerification: true,
					supportedAlgorithmIDs: [-7, -257],
				})
			);
			if (
				!result.verified
				|| result.registrationInfo.credentialBackedUp
				|| result.registrationInfo.credentialDeviceType !== 'singleDevice'
			) {
				return yield* precondition('A physical security key is required');
			}
			const c = result.registrationInfo.credential;
			const document = JSON.stringify({ ...c, label: challenge.label, publicKey: base64(c.publicKey) });
			const insert = challenge.first === true
				? this.sql.run(
					'INSERT INTO authenticators(id,subject,document) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM authenticators WHERE subject=?)',
					c.id,
					subject,
					document,
					subject,
				)
				: this.sql.run('INSERT INTO authenticators(id,subject,document) VALUES(?,?,?)', c.id, subject, document);
			if ((yield* insert).meta.changes !== 1) {
				return yield* precondition('Initial key was already enrolled; authenticate with the existing key');
			}
			return {};
		});
	}
	verify(subject: string, id: string, response: unknown): Effect.Effect<{ proof?: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const document = yield* this.sessions.take(id);
			if (document === undefined) return yield* forbidden('Challenge expired');
			const challenge = yield* Effect.fromResult(record(yield* fromJson(document)));
			if (challenge.subject !== subject) return yield* forbidden('Challenge subject mismatch');
			const rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
			if (challenge.register) return yield* this.register(subject, challenge, response, rpID);
			const responseId = (yield* Effect.fromResult(record(response))).id;
			const stored = (yield* this.saved(subject)).find((entry) => entry.credential.id === responseId);
			if (!stored) return yield* precondition('Unknown authenticator');
			const saved = stored.credential;
			const parsed = yield* decodeRequest(authenticationResponse, response);
			const expectedChallenge = yield* Effect.fromResult(text(challenge.challenge));
			const publicKey = yield* fromSync(() => bytes(saved.publicKey));
			const result = yield* fromPromise(() =>
				verifyAuthenticationResponse({
					response: parsed,
					expectedChallenge,
					expectedOrigin: this.env.APPLICATION_ORIGIN,
					expectedRPID: rpID,
					credential: { ...saved, publicKey },
					requireUserVerification: true,
				})
			);
			if (!result.verified) return yield* precondition('Authentication failed');
			const update = yield* this.sql.run(
				'UPDATE authenticators SET document=? WHERE id=? AND document=?',
				JSON.stringify({ ...saved, counter: result.authenticationInfo.newCounter }),
				saved.id,
				stored.document,
			);
			if (update.meta.changes !== 1) return yield* precondition('Authenticator changed during verification');
			const proof = crypto.randomUUID();
			yield* this.sessions.open('elevation', proof, { subject, elevated: true }, 60000);
			return { proof };
		});
	}
	consume(subject: string, proof: string): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const document = yield* this.sessions.take(proof);
			if (document === undefined) return yield* forbidden('Fresh security-key authentication required');
			const data = yield* Effect.fromResult(record(yield* fromJson(document)));
			if (data.subject !== subject || data.elevated !== true) {
				return yield* forbidden('Invalid authentication proof');
			}
		});
	}
	enrolled(subject: string): Effect.Effect<number, DomainError> {
		return this.credentials(subject).pipe(Effect.map(credentials => credentials.length));
	}
	list(subject: string): Effect.Effect<{ id: string; label: string }[], DomainError> {
		return this.credentials(subject).pipe(
			Effect.map(credentials => credentials.map((c) => ({ id: c.id, label: c.label ?? 'Security key' }))),
		);
	}
	remove(subject: string, id: string): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'DELETE FROM authenticators WHERE subject=? AND id=? AND (SELECT count(*) FROM authenticators WHERE subject=?)>1',
			subject,
			id,
			subject,
		).pipe(
			Effect.filterOrFail(
				result => result.meta.changes === 1,
				() => precondition('Cannot remove the last enrolled key or an unknown key'),
			),
			Effect.asVoid,
		);
	}
}
