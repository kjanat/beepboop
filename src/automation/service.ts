import { CronExpressionParser } from 'cron-parser';
import schema from '#$/schemas/v1.json' with { type: 'json' };
import { array, compareVersions, integer, record, semver, sha, text } from '#model';
import { readBody, verifySignature } from '#webhook';
import { type AuthBindings, Authenticators, administrator, authRoute, workflowIdentity } from './auth.ts';
import { resolveConfiguration } from './configuration.ts';
import type { AutomationCoordinator } from './coordinator.ts';
import { createExecution } from './execution.ts';
import { type Credentials, RepositoryGateway } from './github.ts';
import { discover, planRelease } from './managers.ts';
import { onboardingBody, onboardingConfiguration } from './onboarding.ts';
import { matchesRef } from './policy.ts';
import { planHookUpdates } from './precommit.ts';
import { Store } from './store.ts';
import type {
	Artifact,
	AutomationEvent,
	Execution,
	Publication,
	RepositoryRecord,
	SubscriptionDelivery,
} from './types.ts';
import { renderDashboard } from './ui.ts';
import { parseGrant, Vault } from './vault.ts';
import { nextVersion, parseVersionRequest } from './version.ts';

export interface AutomationBindings extends AuthBindings, Credentials {
	AUTOMATION: DurableObjectNamespace<AutomationCoordinator>;
	OWNER_ID: string;
	GITHUB_WEBHOOK_SECRET: string;
	VAULT_KEYS: string;
	VAULT_ACTIVE_KEY: string;
}
export class AutomationService {
	readonly store: Store;
	readonly gateway: RepositoryGateway;
	constructor(readonly env: AutomationBindings) {
		this.store = new Store(env.DB);
		this.gateway = new RepositoryGateway(env, Number(env.OWNER_ID));
	}
	private coordinator(id: number) {
		return this.env.AUTOMATION.getByName(String(id));
	}
	private async enqueue(repository: RepositoryRecord, execution: Execution): Promise<Execution> {
		const existing = await this.store.execution(execution.id);
		if (existing) return this.coordinator(repository.id).enqueue(existing);
		if (
			execution.operation === 'prepare'
			&& !execution.plan
			&& execution.version
			&& repository.configuration?.streams[execution.stream]?.prepare.strategy !== 'workflow'
		) {
			const snapshot = await this.gateway.snapshot(
				repository.name,
				repository.id,
				execution.sourceSha,
			);
			if (repository.inventory.packages.some((p) => p.publish)) {
				execution.plan = planRelease(
					snapshot,
					repository.inventory,
					execution.version,
					repository.configuration?.streams[execution.stream]?.packages,
				);
			}
		}
		for (const operation of execution.workflow.needs ?? []) {
			const dependency = await createExecution(
				repository,
				execution.stream,
				operation,
				execution.eventId,
				execution.version,
				false,
				execution.upstreamRelease,
			);
			dependency.sourceSha = execution.sourceSha;
			await this.enqueue(repository, dependency);
		}
		if (execution.workflow.ref?.includes('*')) {
			throw new Error(
				'Dispatch requires an exact workflow ref; wildcard bindings support observation only',
			);
		}
		return this.coordinator(repository.id).enqueue(execution);
	}
	private vault() {
		return new Vault(this.store, JSON.parse(this.env.VAULT_KEYS), this.env.VAULT_ACTIVE_KEY);
	}
	async refresh(name: string, id: number): Promise<RepositoryRecord> {
		const snapshot = await this.gateway.snapshot(name, id);
		const repository: RepositoryRecord = {
			...snapshot.repository,
			sha: snapshot.sha,
			inventory: discover(snapshot),
			presetShas: {},
			diagnostics: [],
			updatedAt: Date.now(),
		};
		if (snapshot.files['.github/beepboop.json']) {
			try {
				const resolved = await resolveConfiguration(
					JSON.parse(snapshot.files['.github/beepboop.json']),
					(ref) => this.gateway.preset(ref),
				);
				repository.configuration = resolved.configuration;
				repository.presetShas = resolved.presetShas;
				repository.inventory = discover(snapshot, resolved.configuration.managers);
			} catch (error) {
				repository.diagnostics.push(
					error instanceof Error ? error.message : 'Configuration invalid',
				);
			}
		} else repository.diagnostics.push('Onboarding configuration is not merged');
		await this.store.putRepository(repository);
		return repository;
	}
	async webhook(request: Request): Promise<Response> {
		const bytes = await readBody(request);
		if (
			!(await verifySignature(
				bytes,
				request.headers.get('x-hub-signature-256'),
				this.env.GITHUB_WEBHOOK_SECRET,
			))
		) {
			return new Response('Invalid signature', { status: 401 });
		}
		const event = request.headers.get('x-github-event');
		if (
			!['push', 'release', 'workflow_run', 'installation', 'installation_repositories'].includes(
				event ?? '',
			)
		) {
			return new Response(null, { status: 204 });
		}
		const payload = record(JSON.parse(new TextDecoder().decode(bytes)));
		if (event === 'installation' || event === 'installation_repositories') {
			const account = record(record(payload.installation).account);
			if (account.id !== Number(this.env.OWNER_ID)) return new Response(null, { status: 204 });
			// Enrollment is explicit. Lifecycle events reconcile only repositories already enrolled.
			const removed = new Set(
				array(payload.repositories_removed ?? []).map((item) => integer(record(item).id)),
			);
			for (const repository of await this.store.repositories()) {
				if (
					payload.action === 'deleted'
					|| payload.action === 'suspend'
					|| removed.has(repository.id)
				) {
					await this.store.putRepository({
						...repository,
						suspended: true,
						diagnostics: ['App access removed or suspended'],
						updatedAt: Date.now(),
					});
				} else await this.coordinator(repository.id).wake();
			}
			return new Response(null, { status: 202 });
		}
		const source = record(payload.repository);
		if (record(source.owner).id !== Number(this.env.OWNER_ID)) {
			return new Response(null, { status: 204 });
		}
		const repository = await this.store.repository(integer(source.id));
		if (!repository || repository.name !== source.full_name) {
			return new Response(null, { status: 204 });
		}
		if (event === 'push' && payload.ref === `refs/heads/${repository.defaultBranch}`) {
			await this.refresh(repository.name, repository.id);
		} else if (event === 'workflow_run') {
			if (payload.action === 'completed') {
				await this.coordinator(repository.id).observeRun(
					repository.id,
					integer(record(payload.workflow_run).id),
				);
			} else await this.coordinator(repository.id).wake();
		}
		if (
			event === 'workflow_run'
			&& payload.action === 'completed'
			&& record(payload.workflow_run).conclusion === 'success'
			&& ['push', 'release', 'workflow_dispatch', 'schedule'].includes(
				String(record(payload.workflow_run).event),
			)
			&& record(record(payload.workflow_run).head_repository).id === repository.id
		) {
			await this.event({
				id: text(request.headers.get('x-github-delivery')),
				source: repository.name,
				event: event as 'release' | 'workflow_run',

				workflow: event === 'workflow_run'
					? text(record(payload.workflow_run).path).replace(/^\.github\/workflows\//, '')
					: undefined,
			});
		}
		return new Response(null, { status: 202 });
	}
	async event(event: AutomationEvent): Promise<void> {
		if (
			event.event === 'release'
			&& (!event.release || event.release.repository.name !== event.source || event.release.version !== event.version)
		) {
			throw new Error('Release event requires its upstream identity');
		}
		const deliveries: SubscriptionDelivery[] = [];
		for (const repository of await this.store.repositories()) {
			if (!repository.configuration || repository.diagnostics.length || repository.suspended) continue;
			for (const subscription of repository.configuration.subscriptions) {
				if (subscription.source !== event.source || subscription.event !== event.event) continue;
				if (subscription.workflow && subscription.workflow !== event.workflow) continue;
				const execution = await createExecution(
					repository,
					subscription.stream,
					subscription.operation,
					`${subscription.id}:${event.id}`,
					event.version,
					false,
					event.release,
				);
				deliveries.push({ id: execution.id, eventId: event.id, repositoryId: repository.id, execution });
			}
		}
		await this.store.queueEvent(event, deliveries);
		await this.deliverEvents();
	}
	private async deliverEvents(): Promise<void> {
		for (const delivery of await this.store.pendingDeliveries()) {
			try {
				const repository = await this.store.repository(delivery.repositoryId);
				if (!repository || repository.suspended) throw new Error('Destination unavailable');
				await this.enqueue({
					...repository,
					configuration: delivery.execution.configuration,
					sha: delivery.execution.configurationSha,
				}, delivery.execution);
				await this.store.deliveryResult(delivery.id, true);
			} catch {
				await this.store.deliveryResult(delivery.id, false);
			}
		}
	}
	async scheduled(): Promise<void> {
		await this.deliverEvents();
		for (const repository of await this.store.repositories()) {
			try {
				const refreshed = await this.refresh(repository.name, repository.id);
				await this.coordinator(repository.id).wake();
				for (const event of await this.coordinator(repository.id).releaseEvents()) {
					await this.event(event);
					await this.coordinator(repository.id).acknowledgeReleaseEvent(event.id);
				}
				if (!refreshed.configuration || refreshed.diagnostics.length) continue;
				const now = Date.now();
				for (const [streamName, stream] of Object.entries(refreshed.configuration.streams)) {
					for (const [operation, binding] of Object.entries(stream.workflows)) {
						if (!binding.schedule) continue;
						const key = `${repository.id}:${streamName}:${operation}:${binding.schedule}`;
						const cursor = await this.store.db
							.prepare('SELECT last_tick FROM schedules WHERE id=?')
							.bind(key)
							.first<{ last_tick: number }>();
						if (!cursor) {
							await this.store.db
								.prepare('INSERT OR IGNORE INTO schedules VALUES(?,?)')
								.bind(key, now)
								.run();
							continue;
						}
						const schedule = CronExpressionParser.parse(binding.schedule, {
							currentDate: cursor.last_tick,
							tz: 'UTC',
						});
						for (let n = 0; n < 100; n++) {
							const tick = schedule.next().getTime();
							if (tick > now) break;
							await this.enqueue(
								refreshed,
								await createExecution(refreshed, streamName, operation, `schedule:${tick}`),
							);
							await this.store.db
								.prepare('UPDATE schedules SET last_tick=? WHERE id=?')
								.bind(tick, key)
								.run();
						}
					}
				}
			} catch {
				/* Next scheduled pass retries; preserve the last known configuration. */
			}
		}
	}
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url),
			path = url.pathname;
		if (path === '/health') return Response.json({ service: 'beepboop', mode: 'automation' });
		if (path === '/schema/v1.json') return Response.json(schema);
		if (path === '/webhooks/github' && request.method === 'POST') return this.webhook(request);
		const auth = await authRoute(request, this.env);
		if (auth) return auth;
		if (path.startsWith('/api/workflow/')) return this.workflow(request);
		let actor: string;
		try {
			actor = await administrator(request, this.env);
		} catch {
			return path === '/'
				? Response.redirect(`${this.env.APPLICATION_ORIGIN}/auth/login`, 302)
				: Response.json({ error: 'Administrator authentication required' }, { status: 401 });
		}
		if (path === '/' && request.method === 'GET') {
			return renderDashboard(await this.store.repositories(), await this.store.executions());
		}
		if (request.method === 'GET') {
			if (path === '/api/authenticators') {
				return Response.json(await new Authenticators(this.env).list(actor));
			}
			if (path === '/api/repositories') return Response.json(await this.store.repositories());
			if (path === '/api/executions') return Response.json(await this.store.executions());
			if (path === '/api/activity') {
				return Response.json(
					(
						await this.store.db
							.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 200')
							.all()
					).results,
				);
			}
			if (path === '/api/credentials') {
				return Response.json({
					credentials: (
						await this.store.db
							.prepare(
								'SELECT alias,version,key_id,active,created_at FROM credentials ORDER BY alias,version DESC',
							)
							.all()
					).results,
					grants: (
						await this.store.db.prepare('SELECT document FROM grants').all<{ document: string }>()
					).results.map((r) => JSON.parse(r.document)),
					deliveries: (await this.store.db.prepare('SELECT * FROM secret_deliveries').all())
						.results,
				});
			}
			return new Response('Not found', { status: 404 });
		}
		if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
		const body = record(JSON.parse(new TextDecoder().decode(await readBody(request))));
		if (path === '/api/repositories/discover') {
			return Response.json(
				await this.refresh(
					text(body.repository),
					body.repositoryId === undefined
						? await this.gateway.identify(text(body.repository))
						: integer(body.repositoryId),
				),
			);
		}
		if (path === '/api/repositories/onboard') {
			const repository = await this.refresh(
				text(body.repository),
				body.repositoryId === undefined
					? await this.gateway.identify(text(body.repository))
					: integer(body.repositoryId),
			);
			const snapshot = await this.gateway.snapshot(repository.name, repository.id, repository.sha);
			if (snapshot.files['.github/beepboop.json']) {
				throw new Error('Repository already has configuration');
			}
			const prior = await this.store.db
				.prepare('SELECT document FROM onboarding WHERE repository_id=?')
				.bind(repository.id)
				.first<{ document: string }>();
			const saved = prior ? record(JSON.parse(prior.document)) : undefined;
			const content = `${JSON.stringify(onboardingConfiguration(repository.inventory), null, 2)}\n`;
			if (saved?.content === content) return Response.json({ url: saved.url, unchanged: true });
			const result = await this.gateway.pullRequest(
				snapshot,
				'automation/onboarding',
				'chore: configure release automation',
				onboardingBody(snapshot, repository.inventory),
				[
					{
						path: '.github/beepboop.json',
						before: typeof saved?.content === 'string' ? saved.content : '',
						after: content,
					},
				],
				saved?.head as string | undefined,
			);
			await this.store.db
				.prepare(
					'INSERT INTO onboarding VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET document=excluded.document',
				)
				.bind(repository.id, JSON.stringify({ ...result, content }))
				.run();
			await this.store.audit(actor, 'repository.onboard', String(repository.id));
			return Response.json(result);
		}
		if (path === '/api/releases/update-references') {
			const repository = await this.store.repository(integer(body.repositoryId));
			if (
				!repository?.configuration || repository.suspended || !repository.configuration.managers.includes('pre-commit')
			) throw new Error('Hook manager is not enabled');
			const event = await this.store.event(text(body.releaseEventId));
			if (event?.event !== 'release' || !event.release) throw new Error('Verified upstream release event required');
			const snapshot = await this.gateway.snapshot(repository.name, repository.id);
			const edits = planHookUpdates(snapshot, event.release);
			if (body.preview !== false || !edits.length) {
				return Response.json({ sourceSha: snapshot.sha, upstreamRelease: event.release, edits });
			}
			const result = await this.gateway.pullRequest(
				snapshot,
				`release/hooks/${event.release.repository.id}/${event.release.commit}`,
				`chore: update hooks to ${event.release.version}`,
				`Upstream: ${event.source}\nCommit: ${event.release.commit}`,
				edits,
			);
			await this.store.audit(actor, 'hooks.prepare', result.url);
			return Response.json(result);
		}
		if (path === '/api/releases/plan' || path === '/api/releases/prepare') {
			const repository = await this.store.repository(integer(body.repositoryId));
			if (!repository?.configuration) throw new Error('Repository not configured');
			const stream = repository.configuration.streams[text(body.stream)];
			if (!stream) throw new Error('Unknown stream');
			const snapshot = await this.gateway.snapshot(repository.name, repository.id);
			if (snapshot.sha !== repository.sha) {
				throw new Error('Refresh discovery before preparing this revision');
			}
			if (
				stream.versioning === 'independent'
				&& !stream.packages
				&& !Array.isArray(body.packages)
			) {
				throw new Error('Select packages for an independent release');
			}
			const selected = body.packages === undefined ? stream.packages : array(body.packages).map(text);
			if (stream.packages && selected?.some((name) => !stream.packages?.includes(name))) {
				throw new Error('Package is outside this release stream');
			}
			let target: unknown = body.version;
			if (stream.versionSource?.kind === 'tags') {
				const prefix = stream.versionSource.prefix;
				const versions = (await this.gateway.tagRefs(repository.name, repository.id)).flatMap(ref => {
					if (!ref.name.startsWith(prefix)) return [];
					try {
						return [semver(ref.name.slice(prefix.length)).replace(/^v/, '')];
					} catch {
						return [];
					}
				}).sort(compareVersions);
				const request = parseVersionRequest(body.version);
				const current = versions.at(-1);
				if (!current && !('version' in request)) throw new Error('Select an explicit version for the first release');
				target = current ? nextVersion(current, request) : ('version' in request ? request.version : undefined);
			}
			const plan = stream.prepare.strategy !== 'workflow'
					&& repository.inventory.packages.some((p) => p.publish)
				? planRelease(snapshot, repository.inventory, target, selected)
				: {
					version: semver(target).replace(/^v/, ''),
					sourceSha: snapshot.sha,
					packages: [],
					edits: [],
					diagnostics: ['Preparation is delegated to the configured repository workflow'],
					requiresPreparation: true,
				};
			if (path.endsWith('/plan')) return Response.json(plan);
			if (stream.prepare.workflow) {
				const execution = await createExecution(
					repository,
					text(body.stream),
					'prepare',
					`release:${plan.version}`,
					plan.version,
				);
				if (stream.prepare.strategy !== 'workflow') execution.plan = plan;
				return Response.json(await this.enqueue(repository, execution));
			}
			if (plan.requiresPreparation) {
				throw new Error(
					'Bind a preparation workflow to regenerate lockfiles before opening a release PR',
				);
			}
			const result = await this.gateway.pullRequest(
				snapshot,
				`release/${text(body.stream)}/${plan.version}`,
				`chore(release): prepare ${plan.version}`,
				`Release ${plan.version}\n\nSource: ${snapshot.sha}\n\nRequired publications: ${
					stream.required.join(', ') || 'configure publication requirements before promotion'
				}\n\nPromotion requires approval.`,
				plan.edits,
			);
			await this.store.audit(actor, 'release.prepare', result.url);
			return Response.json(result);
		}
		if (path === '/api/executions/start') {
			const repository = await this.store.repository(integer(body.repositoryId));
			if (!repository) throw new Error('Unknown repository');
			const execution = await createExecution(
				repository,
				text(body.stream),
				text(body.operation),
				body.version === undefined
					? text(body.requestId)
					: `release:${semver(body.version).replace(/^v/, '')}`,
				body.version === undefined ? undefined : text(body.version),
			);
			if (body.sourceSha !== undefined) execution.sourceSha = sha(body.sourceSha);
			await this.store.audit(actor, 'execution.start', execution.id);
			return Response.json(await this.enqueue(repository, execution));
		}
		if (path === '/api/executions/approve' || path === '/api/executions/recover') {
			const execution = await this.store.execution(text(body.id));
			if (!execution) throw new Error('Unknown execution');
			if (path.endsWith('/approve')) {
				return Response.json(
					await this.coordinator(execution.repositoryId).approve(
						execution.id,
						sha(body.sourceSha),
						actor,
					),
				);
			}
			const action = text(body.action);
			if (!['retry', 'reconcile'].includes(action)) throw new Error('Unknown recovery');
			return Response.json(
				await this.coordinator(execution.repositoryId).recover(
					execution.id,
					action as 'retry' | 'reconcile',
					actor,
				),
			);
		}
		const authenticators = new Authenticators(this.env);
		if (path === '/api/authenticators/options') {
			const register = body.register === true;
			if (register && (await authenticators.enrolled(actor)) > 0) {
				await authenticators.consume(actor, text(body.proof));
			}
			return Response.json(
				await authenticators.options(
					actor,
					register,
					body.bootstrap as string | undefined,
					body.label === undefined ? undefined : text(body.label),
				),
			);
		}
		if (path === '/api/authenticators/verify') {
			return Response.json(await authenticators.verify(actor, text(body.id), body.response));
		}
		if (path === '/api/authenticators/remove') {
			await authenticators.consume(actor, text(body.proof));
			await authenticators.remove(actor, text(body.id));
			await this.store.audit(actor, 'authenticator.remove', text(body.id));
			return Response.json({ removed: true });
		}
		if (path.startsWith('/api/credentials/')) {
			await authenticators.consume(actor, text(body.proof));
			const vault = this.vault();
			if (path.endsWith('/replace')) {
				return Response.json({
					version: await vault.replace(text(body.alias), text(body.value), actor),
				});
			}
			if (path.endsWith('/reveal')) {
				return Response.json(await vault.reveal(text(body.alias), actor));
			}
			if (path.endsWith('/grant')) {
				await vault.grant(parseGrant(body.grant), actor);
				return Response.json({ granted: true });
			}
			if (path.endsWith('/revoke')) {
				await vault.revoke(text(body.grantId), actor);
				return Response.json({ revoked: true });
			}
			if (path.endsWith('/sync')) {
				return Response.json(await vault.synchronize(text(body.alias), this.gateway, actor));
			}
		}
		return new Response('Not found', { status: 404 });
	}
	private async workflow(request: Request): Promise<Response> {
		if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
		const identity = await workflowIdentity(
			request,
			this.env.APPLICATION_ORIGIN,
			Number(this.env.OWNER_ID),
		);
		const enrollment = await this.store.repository(identity.repositoryId);
		if (!enrollment || enrollment.suspended) {
			throw new Error('Repository is not enrolled or has been suspended');
		}
		const body = record(JSON.parse(new TextDecoder().decode(await readBody(request))));
		const path = new URL(request.url).pathname;
		let executionId = typeof body.executionId === 'string' ? body.executionId : undefined;
		if (path.endsWith('/refs-plan') || path.endsWith('/refs-complete')) {
			return Response.json(
				await this.coordinator(identity.repositoryId).refs(
					text(body.executionId),
					identity,
					path.endsWith('/refs-complete'),
				),
			);
		}
		if (path.endsWith('/begin') && !executionId) {
			const repository = await this.store.repository(identity.repositoryId);
			if (!repository) throw new Error('Repository not enrolled');
			const execution = await createExecution(
				repository,
				text(body.stream),
				text(body.operation),
				`observed:${identity.runId}`,
				body.version === undefined ? undefined : text(body.version),
				true,
			);
			execution.sourceSha = identity.sha;
			execution.state = 'pending';
			if (execution.operation === 'promote') {
				throw new Error('Promotion must be approved before registration');
			}
			const configuredRef = execution.workflow.ref as string;
			if (!matchesRef(configuredRef, identity.ref)) {
				throw new Error('Observed run does not match configured ref');
			}
			await this.coordinator(identity.repositoryId).enqueue(execution);
			executionId = execution.id;
		}
		if (!executionId) throw new Error('Execution ID required');
		const execution = await this.store.execution(executionId);
		if (!execution || execution.repositoryId !== identity.repositoryId) {
			throw new Error('Execution repository mismatch');
		}
		if (path.endsWith('/begin')) {
			return Response.json(
				await this.coordinator(identity.repositoryId).register(executionId, identity),
			);
		}
		if (
			execution.runId !== identity.runId
			|| execution.runAttempt !== identity.attempt
			|| execution.workflowSha !== identity.workflowSha
		) {
			throw new Error('Execution run mismatch');
		}
		if (path.endsWith('/prepared')) {
			if (execution.operation !== 'prepare' || !execution.plan) {
				throw new Error('Execution has no preparation plan');
			}
			const source = await this.gateway.snapshot(
				execution.repository,
				execution.repositoryId,
				execution.sourceSha,
			);
			const proposed = array(body.files).map((raw) => {
				const file = record(raw);
				return { path: text(file.path), after: text(file.content) };
			});
			if (new Set(proposed.map((f) => f.path)).size !== proposed.length) {
				throw new Error('Duplicate prepared path');
			}
			const allowedLocks = new Set(
				Object.keys(source.files).filter((path) =>
					/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path)
				),
			);
			const token = await this.gateway.token(execution.repository, execution.repositoryId);
			const edits = [];
			for (const file of proposed) {
				const planned = execution.plan.edits.find((edit) => edit.path === file.path);
				if (!planned && !allowedLocks.has(file.path)) {
					throw new Error('Prepared file is outside the release plan');
				}
				if (planned && file.after !== planned.after) {
					throw new Error('Prepared manifest differs from the approved plan');
				}
				const before = (await this.gateway.file(execution.repository, file.path, execution.sourceSha, token))
					?? '';
				if (before !== file.after) edits.push({ path: file.path, before, after: file.after });
			}
			if (execution.plan.edits.some((edit) => !proposed.some((file) => file.path === edit.path))) {
				throw new Error('Prepared release is missing a planned edit');
			}
			if (!edits.length) return Response.json({ unchanged: true });
			const key = `${execution.repositoryId}:${execution.stream}:${execution.version}`;
			const prior = await this.store.db
				.prepare('SELECT document FROM preparations WHERE id=?')
				.bind(key)
				.first<{ document: string }>();
			const saved = prior ? record(JSON.parse(prior.document)) : undefined;
			if (saved?.sourceSha && saved.sourceSha !== execution.sourceSha) {
				throw new Error('Preparation source changed; review the existing release branch');
			}
			if (saved?.edits && JSON.stringify(saved.edits) === JSON.stringify(edits)) {
				return Response.json({ url: saved.url, unchanged: true });
			}
			const branchEdits = edits.map((edit) => ({
				...edit,
				before: saved?.edits
					? ((array(saved.edits)
						.map(record)
						.find((old) => old.path === edit.path)?.after as string | undefined) ?? edit.before)
					: edit.before,
			}));
			const result = await this.gateway.pullRequest(
				source,
				`release/${execution.stream}/${execution.version}`,
				`chore(release): prepare ${execution.version}`,
				`Release ${execution.version}\n\nSource: ${execution.sourceSha}\n\nPreparation run: https://github.com/${execution.repository}/actions/runs/${identity.runId}\n\nPromotion requires approval.`,
				branchEdits,
				saved?.head as string | undefined,
			);
			await this.store.db
				.prepare(
					'INSERT INTO preparations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
				)
				.bind(key, JSON.stringify({ ...result, edits, sourceSha: execution.sourceSha }))
				.run();
			await this.store.audit(`run:${identity.runId}`, 'release.prepared', result.url);
			return Response.json(result);
		}
		if (path.endsWith('/report')) {
			const publications = array(body.publications ?? []).map((raw): Publication => {
				const p = record(raw),
					manager = text(p.manager),
					outcome = text(p.outcome);
				if (
					!['cargo', 'npm', 'github-release', 'oci', 'goreleaser', 'manifest', 'workflow'].includes(
						manager,
					)
					|| !['pending', 'succeeded', 'failed', 'uncertain', 'skipped'].includes(outcome)
				) {
					throw new Error('Invalid publication');
				}
				return {
					id: text(p.id),
					manager: manager as Publication['manager'],
					name: text(p.name),
					version: text(p.version),
					outcome: outcome as Publication['outcome'],
					required: p.required !== false,
					...(p.digest === undefined ? {} : { digest: text(p.digest) }),
					...(p.url === undefined ? {} : { url: text(p.url) }),
					...(p.channel === undefined ? {} : { channel: text(p.channel) }),
				};
			});
			const artifacts = array(body.artifacts ?? []).map((raw): Artifact => {
				const a = record(raw);
				return {
					id: integer(a.id),
					runId: integer(a.runId),
					name: text(a.name),
					digest: text(a.digest),
					expiresAt: text(a.expiresAt),
				};
			});
			return Response.json(
				await this.coordinator(identity.repositoryId).report(
					executionId,
					identity,
					publications,
					artifacts,
				),
			);
		}
		if (path.endsWith('/credentials')) {
			const aliases = array(body.aliases).map(text),
				allowed = execution.configuration.streams[execution.stream]?.credentials ?? [];
			const values: Record<string, string> = {};
			for (const alias of aliases) {
				if (!allowed.includes(alias)) throw new Error('Alias not requested by the stream');
				values[alias] = await this.vault().runtime(alias, execution.operation, identity);
			}
			return Response.json(values);
		}
		return new Response('Not found', { status: 404 });
	}
}
