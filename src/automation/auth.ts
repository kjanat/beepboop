import { createClient } from '@kjanat/openauth/client';
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { Clock, Context, Effect, Result, Schema, SchemaGetter } from 'effect';
import type { JWKSCacheInput, JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet, customFetch, errors, jwksCache, jwtVerify } from 'jose';
import { cliAuthRoute, cliSubject } from '@/automation/cli-auth';
import { logRecovered } from '@/automation/failure-log';
import type { Fetcher } from '@/automation/managers/registry';
import { documentRow } from '@/automation/schemas';
import { decodeError } from '@/automation/store';
import type { DomainError } from '@/contract/errors';
import { decodeRequest, forbidden, precondition, unauthenticated } from '@/contract/errors';
import { loginSecretPattern } from '@/contract/ids';
import { errorPage, fromJson, fromPromise, fromSync, recover, toDomainError } from '@/failure';
import { integer, record, sha, text } from '@/model';
import { CLISessionStore } from '@/persistence/d1/cli-sessions';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { replaceDocument } from '@/persistence/d1/database';
import { SessionStore } from '@/persistence/d1/sessions';
import type { Decoded } from '@/schema';
import { decodeSync, mapped, mutableArray, mutableStruct, safeDecode } from '@/schema';

const clientExtensionResults = Schema.Unknown.pipe(
	Schema.decodeTo(mutableStruct({}), {
		decode: SchemaGetter.transform(() => ({})),
		encode: SchemaGetter.transform(() => ({})),
	}),
);
const registrationResponse: Schema.Codec<RegistrationResponseJSON, unknown> = mutableStruct({
	id: Schema.String,
	rawId: Schema.String,
	type: Schema.Literal('public-key'),
	response: mutableStruct({
		clientDataJSON: Schema.String,
		attestationObject: Schema.String,
		authenticatorData: Schema.optional(Schema.String),
		transports: Schema.optional(mutableArray(Schema.String)),
		publicKeyAlgorithm: Schema.optional(Schema.Finite),
		publicKey: Schema.optional(Schema.String),
	}),
	clientExtensionResults,
});
const authenticationResponse: Schema.Codec<AuthenticationResponseJSON, unknown> = mutableStruct({
	id: Schema.String,
	rawId: Schema.String,
	type: Schema.Literal('public-key'),
	response: mutableStruct({
		clientDataJSON: Schema.String,
		authenticatorData: Schema.String,
		signature: Schema.String,
		userHandle: Schema.optional(mapped(
			Schema.NullOr(Schema.String),
			Schema.UndefinedOr(Schema.String),
			value => value ?? undefined,
			value => value ?? null,
		)),
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
export interface AuthenticationDependencies {
	readonly sessions: SessionStore;
	readonly cliSessions: CLISessionStore;
	readonly authenticators: Authenticators;
	readonly client: (signal: AbortSignal) => ReturnType<typeof createClient>;
	readonly administratorKeys: (signal: AbortSignal) => JWTVerifyGetKey;
	readonly workflowKeys: (signal: AbortSignal) => JWTVerifyGetKey;
}
export class Authentication
	extends Context.Service<Authentication, AuthenticationDependencies>()('beepboop/Authentication')
{}

const keyCaches = new WeakMap<Fetcher, Map<string, JWKSCacheInput>>();

export function authentication(env: AuthBindings, db: Sql, transport: Fetcher): AuthenticationDependencies {
	const sessions = new SessionStore(db);
	const http = (signal: AbortSignal): Fetcher => (input, init) => transport(input, {
		...init,
		signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
	});
	const caches = keyCaches.get(transport) ?? new Map<string, JWKSCacheInput>();
	keyCaches.set(transport, caches);
	const keys = (url: URL) => {
		let cache = caches.get(url.href);
		if (!cache) {
			cache = {};
			caches.set(url.href, cache);
		}
		return (signal: AbortSignal) => createRemoteJWKSet(url, { [customFetch]: http(signal), [jwksCache]: cache });
	};
	return {
		sessions,
		cliSessions: new CLISessionStore(db),
		authenticators: new Authenticators(env, db, sessions),
		client: signal =>
			createClient({ clientID: env.OPENAUTH_CLIENT_ID, issuer: env.OPENAUTH_ISSUER, fetch: http(signal) }),
		administratorKeys: keys(new URL('/.well-known/jwks.json', env.OPENAUTH_ISSUER)),
		workflowKeys: keys(new URL('https://token.actions.githubusercontent.com/.well-known/jwks')),
	};
}
export function base64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}
export function bytes(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function verified<T>(verification: (signal: AbortSignal) => Promise<T>): Effect.Effect<T, DomainError> {
	return Effect.tryPromise({
		try: verification,
		catch: error => error instanceof errors.JOSEError ? unauthenticated(error.message) : toDomainError(error),
	});
}
export function workflowIdentity(
	request: Request,
	audience: string,
	ownerId: number,
	issuerKeys: (signal: AbortSignal) => JWTVerifyGetKey,
): Effect.Effect<WorkflowIdentity, DomainError> {
	return Effect.gen(function*() {
		const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
		if (!token || token.length > 20000) return yield* unauthenticated('Workflow authentication required');
		const now = yield* Clock.currentTimeMillis;
		const { payload } = yield* verified(signal =>
			jwtVerify(token, issuerKeys(signal), {
				issuer: 'https://token.actions.githubusercontent.com',
				currentDate: new Date(now),
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
	dependencies: AuthenticationDependencies,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		if (request.headers.has('authorization')) return yield* cliSubject(request, env, dependencies.cliSessions);
		const token = cookie(request, '__Host-beepboop_access');
		if (!token || token.length > 20000) return yield* unauthenticated('Administrator login required');
		const now = yield* Clock.currentTimeMillis;
		const { payload } = yield* verified(signal =>
			jwtVerify(token, dependencies.administratorKeys(signal), {
				issuer: env.OPENAUTH_ISSUER,
				currentDate: new Date(now),
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
function loginFailed(reason: string): Response {
	return new Response(
		errorPage({
			title: 'Sign-in failed',
			heading: 'Sign-in failed',
			message: reason,
			link: { href: '/auth/login', text: 'Sign in again' },
		}),
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
export function authRoute(
	request: Request,
	env: AuthBindings,
	dependencies: AuthenticationDependencies,
): Effect.Effect<Response | undefined, DomainError> {
	return Effect.gen(function*() {
		const path = new URL(request.url).pathname;
		if (path.startsWith('/auth/cli/')) {
			return yield* cliAuthRoute(request, env, request => administrator(request, env, dependencies), dependencies);
		}
		const renew: Effect.Effect<SessionTokens | undefined> = Effect.gen(function*() {
			const refresh = cookie(request, refreshCookie);
			if (!refresh || refresh.length > 4096) return undefined;
			const result = yield* fromPromise(signal => dependencies.client(signal).refresh(refresh)).pipe(
				Effect.orElseSucceed(() => undefined),
			);
			if (!result || result.err || !result.tokens) return undefined;
			const tokens = result.tokens;
			const verified = yield* administrator(
				new Request(`${env.APPLICATION_ORIGIN}/`, { headers: { Cookie: `${accessCookie}=${tokens.access}` } }),
				env,
				dependencies,
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
			const { url, challenge } = yield* fromPromise(signal =>
				dependencies.client(signal).authorize(`${env.APPLICATION_ORIGIN}/auth/callback`, 'code', { pkce: true })
			);
			const id = crypto.randomUUID();
			yield* dependencies.sessions.open('login-flow', id, {
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
				consumeFlow: id => dependencies.sessions.take(id),
				exchange: (code, verifier) =>
					Effect.gen(function*() {
						const result = yield* fromPromise(signal =>
							dependencies.client(signal).exchange(code, `${env.APPLICATION_ORIGIN}/auth/callback`, verifier)
						).pipe(Effect.orElseSucceed(() => undefined));
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
						dependencies,
					),
			});
		}
		if (path === '/auth/logout' && request.method === 'POST') {
			return yield* signOut(
				request,
				env.APPLICATION_ORIGIN,
				refresh => fromPromise(signal => dependencies.client(signal).revoke(refresh)),
			);
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
			yield* revoke(refresh).pipe(logRecovered('auth.revoke_failed'));
		}
		return new Response(null, { status: 303, headers: sessionHeaders(undefined, '/auth/login') });
	});
}
export function enrollmentRefusal(register: boolean, enrolled: number): string | undefined {
	return !register && enrolled === 0 ? 'Enroll a security key first.' : undefined;
}

const challengeFields = { subject: Schema.String, challenge: Schema.String };
const registrationFields = { ...challengeFields, label: Schema.optional(Schema.String) };
const securityChallenge = Schema.Union([
	mutableStruct({ kind: Schema.Literal('authenticate'), ...challengeFields }),
	mutableStruct({ kind: Schema.Literal('register-initial'), ...registrationFields }),
	mutableStruct({ kind: Schema.Literal('register-additional'), ...registrationFields }),
]);
type SecurityChallenge = Decoded<typeof securityChallenge>;
type RegistrationChallenge = Exclude<SecurityChallenge, { kind: 'authenticate' }>;
type SecurityRequest = { kind: 'authenticate' } | {
	kind: 'register';
	label?: string | undefined;
	proof?: string | undefined;
};

interface SavedCredential {
	label?: string;
	id: string;
	publicKey: string;
	counter: number;
	transports?: WebAuthnCredential['transports'];
}
const savedCredential: Schema.Codec<SavedCredential, unknown> = mutableStruct({
	label: Schema.optional(Schema.String),
	id: Schema.String,
	publicKey: Schema.String,
	counter: Schema.Finite,
	transports: Schema.optional(mutableArray(Schema.String)),
});
export class Authenticators {
	private readonly sessions: SessionStore;
	private readonly sql: Sql;
	constructor(private env: AuthBindings, db: Sql, sessions: SessionStore) {
		this.sessions = sessions;
		this.sql = db;
	}
	private saved(subject: string): Effect.Effect<{ document: string; credential: SavedCredential }[], DomainError> {
		return this.sql.all('SELECT document FROM authenticators WHERE subject=?', subject).pipe(
			Effect.flatMap(rows =>
				fromSync(() =>
					rows.map(row => {
						const { document } = decodeSync(documentRow, row);
						return { document, credential: decodeSync(savedCredential, JSON.parse(document)) };
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
		request: SecurityRequest,
	): Effect.Effect<{ id: string; options: unknown }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const credentials = yield* this.credentials(subject);
			const register = request.kind === 'register';
			const kind = !register ? 'authenticate' : credentials.length === 0 ? 'register-initial' : 'register-additional';
			if (request.kind === 'register' && kind === 'register-additional') {
				yield* this.consume(subject, request.proof ?? '');
			}
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
			const challenge: SecurityChallenge = {
				kind,
				subject,
				...(request.kind === 'register' && request.label !== undefined ? { label: request.label.slice(0, 80) } : {}),
				challenge: options.challenge,
			};
			yield* this.sessions.open('security-challenge', id, challenge, 120000);
			return { id, options };
		});
	}
	private register(
		subject: string,
		challenge: RegistrationChallenge,
		response: unknown,
		rpID: string,
	): Effect.Effect<{ proof?: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const parsed = yield* decodeRequest(registrationResponse, response);
			const expectedChallenge = challenge.challenge;
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
			const insert = challenge.kind === 'register-initial'
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
			const parsedChallenge = safeDecode(securityChallenge, yield* fromJson(document));
			if (!parsedChallenge.success) return yield* forbidden('Challenge expired; request a new security-key challenge');
			const challenge = parsedChallenge.data;
			if (challenge.subject !== subject) return yield* forbidden('Challenge subject mismatch');
			const rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
			if (challenge.kind !== 'authenticate') return yield* this.register(subject, challenge, response, rpID);
			const responseId = (yield* Effect.fromResult(record(response))).id;
			const stored = (yield* this.saved(subject)).find((entry) => entry.credential.id === responseId);
			if (!stored) return yield* precondition('Unknown authenticator');
			const saved = stored.credential;
			const parsed = yield* decodeRequest(authenticationResponse, response);
			const expectedChallenge = challenge.challenge;
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
			const update = yield* replaceDocument(this.sql, 'authenticators', 'id', saved.id, stored.document, {
				...saved,
				counter: result.authenticationInfo.newCounter,
			});
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
