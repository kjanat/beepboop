import { afterEach, beforeEach, mock, setSystemTime, spyOn } from 'bun:test';
import { env as runtimeEnv } from '@root/test/support/cloudflare-workers.ts';
import { TestD1 } from '@root/test/support/d1.ts';
import { deferBackground, drainBackground } from '@root/test/support/do-storage.ts';
import type { Repository } from '@root/test/support/github.ts';
import { appId, FakeGitHub, ownerId } from '@root/test/support/github.ts';
import { Network } from '@root/test/support/network.ts';
import { FakeNpm } from '@root/test/support/registries.ts';
import { FakeNamespace } from '@root/test/support/rpc.ts';
import { FakeWorkflow } from '@root/test/support/workflows.ts';
import { Effect } from 'effect';
import type { JWK } from 'jose';
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from 'jose';
import type { CoordinatorBindings } from '@/automation/coordinator';
import { AutomationCoordinator } from '@/automation/coordinator';
import { PublishBudget } from '@/automation/publish-budget';
import type { ReleaseWorkflowParams } from '@/automation/release-workflow';
import type { Automation, AutomationBindings } from '@/automation/service';
import { applicationLayer } from '@/automation/service';
import { cliToken, sha256Hex } from '@/contract/ids';
import { serve } from '@/server/endpoint';

export const origin = 'https://beepboop.kjanat.dev';
export const issuer = 'https://auth.kjanat.com';
export const adminSubject = '57513d5461547c30a38d12deeed83320';
export const webhookSecret = 'webhook-secret';
export const epoch = Date.parse('2026-11-04T09:00:00.000Z');

interface SigningKey {
	privateKey: CryptoKey;
	jwk: JWK;
}

async function signingKey(alg: 'RS256' | 'ES256', kid: string): Promise<SigningKey> {
	const pair = await generateKeyPair(alg, { extractable: true });
	return { privateKey: pair.privateKey, jwk: { ...(await exportJWK(pair.publicKey)), kid, alg, use: 'sig' } };
}

const keys = Promise.all([
	signingKey('RS256', 'actions'),
	signingKey('ES256', 'openauth'),
	generateKeyPair('RS256', { extractable: true }).then(pair => exportPKCS8(pair.privateKey)),
]);

export interface RunIdentity {
	repository: Repository;
	runId: number;
	attempt?: number;
	sha: string;
	file: string;
	ref?: string;
	event?: string;
	actorId?: number;
}

export type Environment = Omit<Cloudflare.Env, 'DB' | 'SIGNER'> & AutomationBindings & CoordinatorBindings;

export class World {
	readonly network = new Network();
	readonly github = new FakeGitHub();
	readonly npm = new FakeNpm();
	readonly db = new TestD1();
	readonly releaseWorkflow = new FakeWorkflow<ReleaseWorkflowParams>();
	readonly coordinators: FakeNamespace<AutomationCoordinator>;
	readonly budgets: FakeNamespace<PublishBudget>;
	readonly env: Environment;
	readonly application: ReturnType<typeof applicationLayer>;
	private constructor(
		private readonly actions: SigningKey,
		private readonly openauth: SigningKey,
		appKey: string,
	) {
		this.budgets = new FakeNamespace('PublishBudget', state => new PublishBudget(state, this.env));
		this.coordinators = new FakeNamespace(
			'AutomationCoordinator',
			state => new AutomationCoordinator(state, this.env, this.application),
		);
		this.env = {
			DB: this.db,
			AUTOMATION: this.coordinators,
			PUBLISH_BUDGET: this.budgets,
			RELEASE_WORKFLOW: this.releaseWorkflow,
			OWNER_ID: '6353477',
			GITHUB_APP_ID: appId,
			GITHUB_APP_PRIVATE_KEY: appKey,
			GITHUB_WEBHOOK_SECRET: webhookSecret,
			VAULT_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
			VAULT_ACTIVE_KEY: 'v1',
			APPLICATION_ORIGIN: origin,
			OPENAUTH_ISSUER: issuer,
			OPENAUTH_CLIENT_ID: 'beepboop',
			ADMIN_SUBJECT: adminSubject,
		};
		this.application = applicationLayer(this.env, deferBackground, this.network.fetch);
		this.network.serve('api.github.com', request => this.github.handle(request));
		this.network.serve('registry.npmjs.org', request => this.npm.handle(request));
		this.network.serve(
			'token.actions.githubusercontent.com',
			() => Response.json({ keys: [this.actions.jwk] }),
		);
		this.network.serve(new URL(issuer).host, () => Response.json({ keys: [this.openauth.jwk] }));
		this.network.serve('www.githubstatus.com', () =>
			Response.json({
				status: { indicator: 'none', description: 'All Systems Operational' },
				components: [],
				incidents: [],
			}));
		this.network.serve(new URL(origin).host, request => this.handle(request));
	}

	static async create(): Promise<World> {
		setSystemTime(new Date(epoch));
		const [actions, openauth, appKey] = await keys;
		const world = new World(actions, openauth, appKey);
		for (const key of Object.keys(runtimeEnv)) delete runtimeEnv[key];
		Object.assign(runtimeEnv, world.env);
		spyOn(globalThis, 'fetch').mockImplementation(Object.assign(world.network.fetch, { preconnect: fetch.preconnect }));
		return world;
	}
	dispose(): void {
		mock.restore();
		setSystemTime();
	}

	run<A, E>(work: Effect.Effect<A, E, Automation>): Promise<A> {
		return Effect.runPromise(work.pipe(Effect.provide(this.application)));
	}
	async handle(request: Request): Promise<Response> {
		const response = await serve(request, deferBackground, this.application);
		await drainBackground();
		return response;
	}
	advance(milliseconds: number): void {
		setSystemTime(new Date(Date.now() + milliseconds));
	}
	coordinator(repository: Repository): AutomationCoordinator {
		return this.coordinators.instance(String(repository.id)).object;
	}

	async wait(milliseconds: number, limit = 200): Promise<number> {
		const target = Date.now() + milliseconds;
		let fired = 0;
		for (; fired < limit; fired++) {
			const next = [...this.coordinators.instances.values()]
				.filter(instance => instance.storage.alarm !== null && (instance.storage.alarm ?? 0) <= target)
				.sort((a, b) => (a.storage.alarm ?? 0) - (b.storage.alarm ?? 0))[0];
			if (!next) {
				setSystemTime(new Date(target));
				return fired;
			}
			setSystemTime(new Date(Math.max(Date.now(), next.storage.alarm ?? 0)));
			next.storage.alarm = null;
			await next.object.alarm();
			await drainBackground();
		}
		throw new Error(`More than ${limit} alarms fired within ${milliseconds} ms`);
	}

	async cliSession(): Promise<string> {
		const token = cliToken();
		await this.db.prepare('INSERT INTO cli_sessions(id,subject,created_at) VALUES(?,?,?)')
			.bind(await sha256Hex(token), adminSubject, Date.now()).run();
		return token;
	}
	async elevate(): Promise<void> {
		await this.db.prepare('INSERT INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)')
			.bind(
				'proof',
				'elevation',
				JSON.stringify({ subject: this.env.ADMIN_SUBJECT, elevated: true }),
				Date.now() + 60_000,
			)
			.run();
	}
	async sealCredential(alias: string): Promise<void> {
		await this.db.prepare(
			'INSERT INTO credentials(alias,version,key_id,ciphertext,iv,active,created_at) VALUES(?,?,?,?,?,1,?)',
		).bind(alias, 1, 'v1', 'sealed', 'iv', Date.now()).run();
	}
	async adminCookie(): Promise<string> {
		const access = await new SignJWT({ mode: 'access', type: 'user' })
			.setProtectedHeader({ alg: 'ES256', kid: 'openauth' })
			.setIssuer(issuer)
			.setAudience('beepboop')
			.setSubject(adminSubject)
			.setIssuedAt()
			.setExpirationTime('1h')
			.sign(this.openauth.privateKey);
		return `__Host-beepboop_access=${access}`;
	}
	async runToken(run: RunIdentity): Promise<string> {
		const ref = run.ref ?? `refs/heads/${run.repository.defaultBranch}`;
		const workflowRef = `${run.repository.name}/.github/workflows/${run.file}@${ref}`;
		return new SignJWT({
			repository_id: String(run.repository.id),
			repository: run.repository.name,
			repository_owner_id: String(ownerId),
			actor_id: String(run.actorId ?? ownerId),
			run_id: String(run.runId),
			run_attempt: String(run.attempt ?? 1),
			sha: run.sha,
			workflow_sha: run.sha,
			workflow_ref: workflowRef,
			job_workflow_ref: workflowRef,
			job_workflow_sha: run.sha,
			ref,
			event_name: run.event ?? 'workflow_dispatch',
		})
			.setProtectedHeader({ alg: 'RS256', kid: 'actions' })
			.setIssuer('https://token.actions.githubusercontent.com')
			.setAudience(origin)
			.setSubject(`repo:${run.repository.name}:ref:${ref}`)
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(this.actions.privateKey);
	}
	async webhook(event: string, payload: unknown, delivery = crypto.randomUUID()): Promise<Response> {
		const body = JSON.stringify(payload);
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(webhookSecret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign'],
		);
		const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString(
			'hex',
		);
		return this.handle(
			new Request(`${origin}/webhooks/github`, {
				method: 'POST',
				body,
				headers: {
					'x-github-event': event,
					'x-github-delivery': delivery,
					'x-hub-signature-256': `sha256=${signature}`,
				},
			}),
		);
	}
	push(repository: Repository, delivery?: ReturnType<typeof crypto.randomUUID>): Promise<Response> {
		return this.webhook('push', {
			ref: `refs/heads/${repository.defaultBranch}`,
			repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
		}, delivery);
	}
	workflowRun(
		repository: Repository,
		run: { id: number; path: string },
		conclusion: string | null,
		event: string,
		action = 'completed',
	): Promise<Response> {
		return this.webhook('workflow_run', {
			action,
			workflow_run: { id: run.id, conclusion, event, path: run.path, head_repository: { id: repository.id } },
			repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
		});
	}
}

export function eachWorld(bind: (world: World) => void): void {
	let current: World | undefined;
	beforeEach(async () => {
		current = await World.create();
		bind(current);
	});
	afterEach(async () => {
		try {
			await drainBackground();
		} finally {
			if (current) current.dispose();
		}
	});
}
