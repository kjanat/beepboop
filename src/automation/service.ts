import schema from '@root/schemas/v1.json' with { type: 'json' };
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { configuredGrant } from '@/automation/access';
import { type AuthBindings, Authenticators, administrator, authRoute, workflowIdentity } from '@/automation/auth';
import { resolveConfiguration } from '@/automation/configuration';
import type { AutomationCoordinator } from '@/automation/coordinator';
import { planVersionFiles } from '@/automation/editors';
import { createExecution } from '@/automation/execution';
import { type Credentials, RepositoryGateway } from '@/automation/github';
import { createReleasePreparation, planIdentity } from '@/automation/managed';
import { discover, planRelease, resolvePublished, versionsInFiles } from '@/automation/managers';
import { destinationInput, Notifications, subscriptionInput } from '@/automation/notifications';
import { matchesPackage } from '@/automation/package-identity';
import { addWatch, pollPackages, removeManualWatch, watchInput } from '@/automation/package-watch';
import { planReleaseSet } from '@/automation/planning';
import { matchesRef } from '@/automation/policy';
import { planHookUpdates } from '@/automation/precommit';
import { repositoryName } from '@/automation/repository-name';
import { documentRow, rowDocument, setupOptionsSchema } from '@/automation/schemas';
import { bodyChoices, previewSetup, setupBody, setupOptions, withRegistryStatus } from '@/automation/setup';
import { maintainSetup, sameEdits, setupEdits } from '@/automation/setup-maintenance';
import { setupChoicesSchema } from '@/automation/setup-types';
import { Store } from '@/automation/store';
import { matchesSubscription } from '@/automation/subscriptions';
import { workflowToken } from '@/automation/token';
import type {
	Artifact,
	AutomationEvent,
	Execution,
	Publication,
	RepositoryRecord,
	SubscriptionDelivery,
} from '@/automation/types';
import { parseGrant, Vault } from '@/automation/vault';
import { nextVersion, parseVersionRequest } from '@/automation/version';
import { type WinGetBindings, WinGetService } from '@/automation/winget';
import { array, compareVersions, integer, oneOf, record, semver, sha, text } from '@/model';
import { renderActivityRows } from '@/ui/templates/activity';
import { readBody, verifySignature } from '@/webhook';

const setupPullEdit = z.object({
	action: z.literal('edited'),
	changes: z.object({ body: z.object({ from: z.string().nullable() }) }),
	sender: z.object({ id: z.number() }),
	pull_request: z.object({
		number: z.number().int().positive(),
		state: z.literal('open'),
		body: z.string().nullable(),
		user: z.object({ id: z.number() }),
		head: z.object({
			ref: z.literal('automation/onboarding'),
			sha: z.string().regex(/^[a-f0-9]{40}$/),
			repo: z.object({ id: z.number() }),
		}),
		base: z.object({ repo: z.object({ id: z.number() }) }),
	}),
});
export interface AutomationBindings extends AuthBindings, Credentials, WinGetBindings {
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
		if (execution.managed) return this.coordinator(repository.id).enqueue(execution);
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
				(repository.configuration?.streams[execution.stream]?.versionFiles ?? []).map(rule => rule.path),
			);
			if (versionsInFiles(repository.inventory)) {
				execution.plan = planRelease(
					snapshot,
					repository.inventory,
					execution.version,
					repository.configuration?.streams[execution.stream]?.packages,
					undefined,
					repository.configuration?.streams[execution.stream]?.versionFiles,
				);
			}
		}
		for (const operation of execution.workflow?.needs ?? []) {
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
		if (execution.workflow?.ref?.includes('*')) {
			throw new Error(
				'Dispatch requires an exact workflow ref; wildcard bindings support observation only',
			);
		}
		return this.coordinator(repository.id).enqueue(execution);
	}
	winget() {
		return new WinGetService(this.store, this.gateway, this.env);
	}
	notifications() {
		return new Notifications(this.store, () => this.vault());
	}
	private vault() {
		return new Vault(
			this.store,
			z.record(z.string(), z.string()).parse(JSON.parse(this.env.VAULT_KEYS)),
			this.env.VAULT_ACTIVE_KEY,
		);
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
		} else {
			repository.diagnostics.push(
				await this.gateway.openSetupPull(name, id)
					? 'The setup pull request is open. Merge it to enable releases.'
					: 'Not configured yet. Configure releases opens a setup pull request.',
			);
		}
		repository.inventory = await resolvePublished(repository.inventory, fetch, this.gateway.verification(name, id));
		await this.store.putRepository(repository);
		try {
			await maintainSetup(this.store, this.gateway, snapshot);
		} catch (error) {
			await this.store.audit(
				'beepboop',
				'repository.setup.failed',
				`${name}: ${error instanceof Error ? error.message : 'Setup maintenance failed'}`,
			);
		}
		await this.winget().watch(repository);
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
			!['push', 'release', 'workflow_run', 'pull_request', 'installation', 'installation_repositories']
				.includes(event ?? '')
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
		if (event === 'pull_request') {
			await this.setupEdited(repository, payload);
			return new Response(null, { status: 202 });
		}
		if (event === 'release' && payload.action === 'published') await this.winget().automatic(repository);
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
				event,

				workflow: event === 'workflow_run'
					? text(record(payload.workflow_run).path).replace(/^\.github\/workflows\//, '')
					: undefined,
			});
		}
		return new Response(null, { status: 202 });
	}
	private async setupEdited(repository: RepositoryRecord, payload: unknown): Promise<void> {
		const parsed = setupPullEdit.safeParse(payload);
		if (!parsed.success) return;
		const { pull_request: pull, sender } = parsed.data;
		if (pull.head.repo.id !== repository.id || pull.base.repo.id !== repository.id) return;
		const bot = await this.gateway.botIdentity();
		if (sender.id === bot.id || pull.user.id !== bot.id) return;
		const row = documentRow.nullable().parse(
			await this.store.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(repository.id).first(),
		);
		if (!row) return;
		const saved = record(JSON.parse(row.document));
		if (saved.url !== `https://github.com/${repository.name}/pull/${pull.number}`) return;
		const options = setupOptionsSchema.optional().parse(saved.options);
		const base = setupChoicesSchema.optional().parse(saved.choices);
		if (!options || !base) return;
		const body = pull.body ?? '';
		const choices = setupChoicesSchema.parse(bodyChoices(body, options, base));
		await this.coordinator(repository.id).setupEdited(
			{ repositoryId: repository.id, number: pull.number, head: pull.head.sha, body, choices },
			JSON.stringify(choices) !== JSON.stringify(base),
		);
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
				if (!matchesSubscription(subscription, event)) continue;
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
		await this.winget().reconcile();
		for (const repository of await this.store.repositories()) {
			try {
				const refreshed = await this.refresh(repository.name, repository.id);
				try {
					await this.winget().automatic(refreshed);
				} catch (error) {
					await this.store.audit(
						'winget',
						'winget.failed',
						`${repository.name}: ${error instanceof Error ? error.message : 'Polling failed'}`,
					);
				}
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
						const cursor = z.object({ last_tick: z.number() }).nullable().parse(
							await this.store.db
								.prepare('SELECT last_tick FROM schedules WHERE id=?')
								.bind(key)
								.first(),
						);
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
		const notifications = this.notifications();
		await pollPackages(this.store, await this.store.repositories(), fetch, event => this.event(event), notifications);
		await notifications.deliver();
	}
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url),
			path = url.pathname;
		if (path === '/health') return Response.json({ service: 'beepboop', mode: 'automation' });
		if (path === '/schema/v1.json') return Response.json(schema);
		if (path === '/webhooks/github' && request.method === 'POST') return this.webhook(request);
		const auth = await authRoute(request, this.env);
		if (auth) return auth;
		if (path === '/api/workflow/token') {
			return workflowToken(request, this.env.APPLICATION_ORIGIN, Number(this.env.OWNER_ID), this.gateway, this.store);
		}
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
			return Response.redirect(`${this.env.APPLICATION_ORIGIN}/repositories`, 302);
		}
		if (request.method === 'GET') {
			if (path === '/api/authenticators') {
				return Response.json(await new Authenticators(this.env).list(actor));
			}
			if (path === '/api/winget') return Response.json(await this.winget().list());
			if (path === '/api/repositories') return Response.json(await this.store.repositories());
			if (path === '/api/executions') return Response.json(await this.store.executions());
			if (path === '/api/activity') {
				return Response.json({
					html: renderActivityRows(await this.store.activity(), await this.store.repositories()),
				});
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
						await this.store.db.prepare('SELECT document FROM grants').all()
					).results.map((r) => parseGrant(rowDocument(r))),
					deliveries: (await this.store.db.prepare('SELECT * FROM secret_deliveries').all())
						.results,
				});
			}
			return new Response('Not found', { status: 404 });
		}
		if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
		const body = record(JSON.parse(new TextDecoder().decode(await readBody(request))));
		if (path.startsWith('/api/winget/')) {
			if (path === '/api/winget/refresh') {
				await this.winget().reconcile();
				return Response.json({ ok: true });
			}
			const repository = await this.store.repository(integer(body.repositoryId));
			if (!repository) throw new Error('Repository not enrolled');
			if (path === '/api/winget/releases') return Response.json(await this.winget().releases(repository));
			const releaseId = integer(body.releaseId);
			if (path === '/api/winget/preview') return Response.json(await this.winget().plan(repository, releaseId));
			if (path === '/api/winget/submit') {
				const result = await this.winget().submit(repository, releaseId, text(body.digest));
				await this.store.audit(actor, 'winget.request', result.plan.id);
				return Response.json(result);
			}
			return new Response('Not found', { status: 404 });
		}
		if (path === '/api/repositories/discover') {
			const name = await repositoryName(text(body.repository), () => this.gateway.ownerLogin());
			return Response.json(
				await this.refresh(
					name,
					body.repositoryId === undefined ? await this.gateway.identify(name) : integer(body.repositoryId),
				),
			);
		}
		if (path === '/api/repositories/onboard') {
			throw new Error('Preview release setup before applying it: /api/repositories/setup/preview');
		}
		if (path === '/api/repositories/setup/preview' || path === '/api/repositories/setup/apply') {
			const name = await repositoryName(text(body.repository), () => this.gateway.ownerLogin());
			const id = await this.gateway.identify(name);
			const snapshot = await this.gateway.snapshot(name, id);
			const raw = JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}');
			const resolved = await resolveConfiguration(raw, ref => this.gateway.preset(ref));
			const inventory = withRegistryStatus(discover(snapshot), (await this.store.repository(id))?.inventory);
			const row = documentRow.nullable().parse(
				await this.store.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(id).first(),
			);
			const saved = row ? record(JSON.parse(row.document)) : undefined;
			const head = await this.gateway.setupHead(name, id);
			const branchFiles = head ? await this.gateway.generatedFiles(name, id, head) : undefined;
			const branchConflict = !!head && saved?.head !== head && !branchFiles;
			const previous = branchFiles ?? setupEdits(saved);
			const priorConfiguration = previous.find(edit => edit.path === '.github/beepboop.json')?.before ?? '';
			const choices = body.choices
				?? ((snapshot.files['.github/beepboop.json'] ?? '') === priorConfiguration ? saved?.choices : undefined);
			const plan = await previewSetup(snapshot, inventory, choices, {
				head,
				workflowPermission: await this.gateway.canEditWorkflows(name, id),
				branchConflict,
				presetShas: resolved.presetShas,
				...(typeof saved?.url === 'string'
					? { prior: { url: saved.url, content: typeof saved.content === 'string' ? saved.content : undefined } }
					: {}),
			}, resolved.configuration);
			if (path.endsWith('/preview')) return Response.json(plan);
			if (body.planId !== plan.planId || body.sourceSha !== plan.sourceSha || body.setupHead !== head) {
				throw new Error('Setup source, choices or branch changed; preview again');
			}
			if (plan.blockers.length) throw new Error(plan.blockers.join('\n'));
			if (!plan.edits.length) throw new Error('Release setup already matches the reviewed configuration');
			if (branchConflict) {
				throw new Error('Setup branch changed; preserve human edits and review the conflict');
			}
			const result = head && saved?.sourceSha === snapshot.sha
					&& sameEdits(previous, plan.edits)
				? await this.gateway.refreshPullRequest(
					snapshot,
					'automation/onboarding',
					'chore: configure release automation',
					setupBody(plan),
					head,
				)
				: await this.gateway.pullRequest(
					snapshot,
					'automation/onboarding',
					'chore: configure release automation',
					setupBody(plan),
					plan.edits,
					head ?? undefined,
					undefined,
					previous,
				);
			const content = plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after
				?? snapshot.files['.github/beepboop.json'];
			// Keep the complete set of generated files for safe later refreshes, including unchanged ones.
			const generated = new Map(
				previous.flatMap(edit => {
					const after = snapshot.files[edit.path];
					return after === undefined ? [] : [[edit.path, { ...edit, after }] as const];
				}),
			);
			for (const edit of plan.edits) generated.set(edit.path, edit);
			await this.store.db.prepare(
				'INSERT INTO onboarding VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET document=excluded.document',
			)
				.bind(
					id,
					JSON.stringify({
						...result,
						content,
						sourceSha: snapshot.sha,
						choices: plan.choices,
						options: setupOptions(plan),
						edits: [...generated.values()],
					}),
				).run();
			await this.store.audit(actor, 'repository.setup', String(id));
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
		if (path === '/api/releases/start-set') {
			const preparation = await this.store.execution(text(body.preparationId));
			if (!preparation) throw new Error('Unknown preparation');
			const executions = await this.coordinator(preparation.repositoryId).startReleaseSet(
				preparation.id,
				sha(body.sourceSha),
			);
			await this.store.audit(actor, 'release.start-set', preparation.id);
			return Response.json(executions);
		}
		if (path === '/api/releases/plan-set' || path === '/api/releases/prepare-set') {
			const repository = await this.store.repository(integer(body.repositoryId));
			if (!repository?.configuration || repository.diagnostics.length) throw new Error('Repository not configured');
			const stream = repository.configuration.streams[text(body.stream)];
			if (stream?.versioning !== 'independent') throw new Error('Select an independent release stream');
			const snapshot = await this.gateway.snapshot(
				repository.name,
				repository.id,
				undefined,
				(stream.versionFiles ?? []).map(rule => rule.path),
			);
			if (snapshot.sha !== repository.sha) throw new Error('Refresh discovery before planning this revision');
			const plan = planReleaseSet(snapshot, repository.inventory, body.plan, stream.packages, stream.versionFiles);
			const planId = await planIdentity(plan, repository);
			if (path.endsWith('/plan-set')) return Response.json({ ...plan, planId });
			if (sha(body.sourceSha) !== plan.sourceSha) throw new Error('Preview source revision changed');
			if (body.planId !== planId) throw new Error('Release plan changed; preview it again');
			const execution = await createReleasePreparation(repository, text(body.stream), plan);
			await this.store.audit(actor, 'release.prepare-set', execution.id);
			return Response.json(await this.enqueue(repository, execution));
		}
		if (path === '/api/releases/plan' || path === '/api/releases/prepare') {
			const repository = await this.store.repository(integer(body.repositoryId));
			if (!repository?.configuration) throw new Error('Repository not configured');
			const stream = repository.configuration.streams[text(body.stream)];
			if (!stream) throw new Error('Unknown stream');
			const snapshot = await this.gateway.snapshot(
				repository.name,
				repository.id,
				undefined,
				(stream.versionFiles ?? []).map(rule => rule.path),
			);
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
			if (
				stream.packages
				&& selected?.some((name) =>
					!repository.inventory.packages.some(pkg =>
						matchesPackage(name, pkg) && stream.packages?.some(reference => matchesPackage(reference, pkg))
					)
				)
			) {
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
					&& versionsInFiles(repository.inventory)
				? planRelease(snapshot, repository.inventory, target, selected, undefined, stream.versionFiles)
				: stream.prepare.strategy !== 'workflow' && stream.versionFiles?.length
				? planVersionFiles(snapshot, target, stream.versionFiles)
				: {
					version: semver(target).replace(/^v/, ''),
					sourceSha: snapshot.sha,
					packages: [],
					edits: [],
					diagnostics: ['Preparation is delegated to the configured repository workflow'],
					requiresPreparation: true,
				};
			const planId = await planIdentity(plan, repository);
			if (path.endsWith('/plan')) return Response.json({ ...plan, planId });
			if (sha(body.sourceSha) !== plan.sourceSha || body.planId !== planId) {
				throw new Error('Release plan changed; preview it again');
			}
			if (stream.prepare.workflow) {
				if (stream.prepare.strategy !== 'workflow') {
					return Response.json(
						await this.enqueue(repository, await createReleasePreparation(repository, text(body.stream), plan)),
					);
				}
				const execution = await createExecution(
					repository,
					text(body.stream),
					'prepare',
					`plan:${planId}`,
					plan.version,
				);
				return Response.json(await this.enqueue(repository, execution));
			}
			const execution = await createReleasePreparation(repository, text(body.stream), plan);
			await this.store.audit(actor, 'release.prepare', execution.id);
			return Response.json(await this.enqueue(repository, execution));
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
			const action = oneOf(text(body.action), ['retry', 'reconcile'], 'Unknown recovery');
			return Response.json(
				await this.coordinator(execution.repositoryId).recover(
					execution.id,
					action,
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
		if (path === '/api/packages/add' || path === '/api/packages/remove') {
			const input = watchInput.parse(body);
			if (path.endsWith('/add')) await addWatch(this.store, this.notifications(), input.registry, input.name, true);
			else await removeManualWatch(this.store, input.registry, input.name);
			await this.store.audit(
				actor,
				path.endsWith('/add') ? 'package.watch' : 'package.unwatch',
				`${input.registry}:${input.name}`,
			);
			return Response.json({ ok: true });
		}
		if (path === '/api/packages/subscription') {
			const input = subscriptionInput.parse(body);
			await this.notifications().setSubscription(input, input.subscribed, actor);
			return Response.json({ ok: true });
		}
		if (path === '/api/notifications/save') {
			await authenticators.consume(actor, text(body.proof));
			return Response.json({
				id: await this.notifications().saveDestination(destinationInput.parse(body.destination), actor),
			});
		}
		if (path === '/api/notifications/remove') {
			await this.notifications().removeDestination(text(body.id), actor);
			return Response.json({ ok: true });
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
				if (body.selection !== undefined) {
					const selection = record(body.selection);
					const repository = await this.store.repository(integer(selection.repositoryId));
					if (!repository) throw new Error('Repository is not enrolled');
					const grant = configuredGrant(repository, selection);
					const saved = await this.store.db.prepare('SELECT alias FROM credentials WHERE alias=? AND active=1').bind(
						grant.alias,
					).first();
					if (!saved) throw new Error('Store a value under this name before granting access');
					await vault.grant(grant, actor);
				} else await vault.grant(parseGrant(body.grant), actor);
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
			if (!execution.workflow) throw new Error('Operation is not a workflow');
			if (!matchesRef(execution.workflow.ref, identity.ref)) {
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
				execution.plan.edits.map(edit => edit.path),
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
			if ([...allowedLocks].some(path => !proposed.some(file => file.path === path))) {
				throw new Error('Prepared release is missing a lockfile');
			}
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
				edits.push({ path: file.path, before, after: file.after });
			}
			if (execution.plan.edits.some((edit) => !proposed.some((file) => file.path === edit.path))) {
				throw new Error('Prepared release is missing a planned edit');
			}
			if (!edits.length) return Response.json({ unchanged: true });
			const result = await this.coordinator(execution.repositoryId).prepared(execution.id, identity, edits);
			await this.store.audit(`run:${identity.runId}`, 'release.prepared', result.url);
			return Response.json(result);
		}
		if (path.endsWith('/report')) {
			const publications = array(body.publications ?? []).map((raw): Publication => {
				const p = record(raw);
				const manager = oneOf(
					text(p.manager),
					['cargo', 'npm', 'jsr', 'github-release', 'oci', 'goreleaser', 'go', 'vscode', 'manifest', 'workflow'],
					'Invalid publication',
				);
				const outcome = oneOf(
					text(p.outcome),
					['pending', 'succeeded', 'failed', 'uncertain', 'skipped', 'rate-limited'],
					'Invalid publication',
				);
				const fields = {
					id: text(p.id),
					manager,
					name: text(p.name),
					version: text(p.version),
					required: p.required !== false,
					...(p.digest === undefined ? {} : { digest: text(p.digest) }),
					...(p.url === undefined ? {} : { url: text(p.url) }),
					...(p.channel === undefined ? {} : { channel: text(p.channel) }),
				};
				if (outcome !== 'rate-limited') return { ...fields, outcome };
				const retryAfter = z.iso.datetime({ offset: true }).parse(p.retryAfter);
				return { ...fields, outcome, retryAfter };
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
