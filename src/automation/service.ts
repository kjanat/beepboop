import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import type { AuthBindings } from '@/automation/auth';
import { resolveConfiguration } from '@/automation/configuration';
import type { AutomationCoordinator } from '@/automation/coordinator';
import { createExecution, deriveExecution } from '@/automation/execution';
import { type Credentials, RepositoryGateway } from '@/automation/github';
import { type InboxEvent, inboxEvent, type SetupPullEdit } from '@/automation/inbox';
import { discover, planRelease, resolvePublished, versionsInFiles } from '@/automation/managers';
import { jsrTokenAlias, prepareJsrPackage } from '@/automation/managers/jsr';
import { Notifications } from '@/automation/notifications';
import { matchesPackage } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { pollPackages } from '@/automation/package-watch';
import { manifestProblems, unreleasedManifestVersion } from '@/automation/release-version';
import { setupOptionsSchema } from '@/automation/schemas';
import { bodyChoices } from '@/automation/setup';
import { maintainSetup } from '@/automation/setup-maintenance';
import { Store } from '@/automation/store';
import { matchesSubscription } from '@/automation/subscriptions';
import type { AutomationEvent, Execution, RepositoryRecord, SubscriptionDelivery } from '@/automation/types';
import { Vault } from '@/automation/vault';
import { type WinGetBindings, WinGetService } from '@/automation/winget';
import { notFound, precondition } from '@/contract/errors';
import { setupChoicesSchema } from '@/contract/setup';
import { configurationDiagnostics, configurationProblem } from '@/domain/configuration';
import { type Access, type ReadyRepository, readiness, requireReady } from '@/domain/repository';
import { validateAgainst } from '@/domain/validate';
import { array, integer, record } from '@/model';
import { ChangeLog } from '@/persistence/d1/changes';
import { CLISessionStore } from '@/persistence/d1/cli-sessions';
import { CredentialStore } from '@/persistence/d1/credentials';
import { OnboardingStore } from '@/persistence/d1/onboarding';
import { ScheduleStore } from '@/persistence/d1/schedules';
import { SessionStore } from '@/persistence/d1/sessions';
import { readBody, verifySignature } from '@/webhook';

const changeRetention = 7 * 24 * 60 * 60 * 1000;
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
	readonly credentials: CredentialStore;
	readonly sessions: SessionStore;
	readonly cliSessions: CLISessionStore;
	readonly schedules: ScheduleStore;
	readonly onboarding: OnboardingStore;
	readonly changes: ChangeLog;
	constructor(readonly env: AutomationBindings) {
		this.store = new Store(env.DB);
		this.gateway = new RepositoryGateway(env, Number(env.OWNER_ID));
		this.credentials = new CredentialStore(env.DB);
		this.sessions = new SessionStore(env.DB);
		this.cliSessions = new CLISessionStore(env.DB);
		this.schedules = new ScheduleStore(env.DB);
		this.onboarding = new OnboardingStore(env.DB);
		this.changes = new ChangeLog(env.DB);
	}
	coordinator(id: number) {
		return this.env.AUTOMATION.getByName(String(id));
	}
	async enqueue(repository: ReadyRepository, execution: Execution): Promise<Execution> {
		if (execution.repositoryId !== repository.id) throw new Error('Execution belongs to another repository');
		if (execution.managed) return this.coordinator(repository.id).enqueue(execution);
		const existing = await this.coordinator(repository.id).execution(execution.id);
		if (existing) return this.coordinator(repository.id).enqueue(existing);
		const stream = execution.configuration.streams[execution.stream];
		if (
			execution.operation === 'prepare'
			&& !execution.plan
			&& execution.version
			&& stream?.prepare.strategy !== 'workflow'
		) {
			const snapshot = await this.gateway.snapshot(
				repository.name,
				repository.id,
				execution.sourceSha,
				(stream?.versionFiles ?? []).map(rule => rule.path),
			);
			if (versionsInFiles(repository.inventory)) {
				execution.plan = planRelease(
					snapshot,
					repository.inventory,
					execution.version,
					stream?.packages,
					undefined,
					stream?.versionFiles,
				);
			}
		}
		for (const operation of execution.workflow?.needs ?? []) {
			const dependency = await deriveExecution(execution, repository, {
				stream: execution.stream,
				operation,
				eventId: execution.eventId,
				sourceSha: execution.sourceSha,
				version: execution.version,
				upstreamRelease: execution.upstreamRelease,
			});
			await this.enqueue(repository, dependency);
		}
		if (execution.workflow?.ref?.includes('*')) {
			throw precondition('Dispatch requires an exact workflow ref; wildcard bindings support observation only');
		}
		return this.coordinator(repository.id).enqueue(execution);
	}
	winget() {
		return new WinGetService(this.store, this.gateway, this.env);
	}
	notifications() {
		return new Notifications(this.store, () => this.vault());
	}
	vault() {
		return new Vault(
			this.store,
			this.credentials,
			z.record(z.string(), z.string()).parse(JSON.parse(this.env.VAULT_KEYS)),
			this.env.VAULT_ACTIVE_KEY,
		);
	}
	async setAccess(id: number, access: Access): Promise<void> {
		await this.store.setAccess(id, access);
		await this.coordinator(id).setAccess(access.kind === 'suspended');
	}
	private async access(name: string): Promise<Access> {
		return await this.gateway.installation(name) === 'active'
			? { kind: 'active' }
			: { kind: 'suspended', since: Date.now() };
	}
	async discover(name: string, id: number | undefined): Promise<RepositoryRecord> {
		const installation = await this.gateway.installation(name);
		if (installation === 'active') {
			const repositoryId = id ?? await this.gateway.identify(name);
			await this.setAccess(repositoryId, { kind: 'active' });
			return this.refresh(name, repositoryId);
		}
		const enrolled = (await this.store.enrollments()).find(entry => entry.id === id || entry.name === name);
		const stored = enrolled && await this.store.repository(enrolled.id);
		if (!stored) {
			throw installation === 'suspended'
				? precondition(`GitHub App access to ${name} is suspended`)
				: notFound('repository', `The GitHub App is not installed on ${name}`, name);
		}
		const access: Access = stored.access.kind === 'suspended'
			? stored.access
			: { kind: 'suspended', since: Date.now() };
		await this.setAccess(stored.id, access);
		return { ...stored, access };
	}
	async refresh(name: string, id: number): Promise<RepositoryRecord> {
		const snapshot = await this.gateway.snapshot(name, id);
		const prior = await this.store.enrollment(id);
		const repository: RepositoryRecord = {
			...snapshot.repository,
			access: prior?.access ?? { kind: 'active' },
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
				repository.diagnostics.push(...resolved.drift);
				repository.inventory = discover(snapshot, resolved.configuration.managers);
				repository.diagnostics.push(...validateAgainst(resolved.configuration, repository.inventory, snapshot));
			} catch (error) {
				repository.diagnostics.push(
					...(error instanceof z.ZodError
						? configurationDiagnostics(error)
						: [configurationProblem(error instanceof Error ? error.message : 'Configuration invalid')]),
				);
			}
		} else {
			repository.diagnostics.push({
				code: 'unconfigured',
				severity: 'blocking',
				message: await this.gateway.openSetupPull(name, id)
					? 'The setup pull request is open. Merge it to enable releases.'
					: 'Not configured yet. Configure releases opens a setup pull request.',
			});
		}
		repository.inventory = await resolvePublished(repository.inventory, fetch, this.gateway.verification(name, id));
		await this.store.putRepository(repository);
		await this.coordinator(id).setAccess(repository.access.kind === 'suspended');
		try {
			await this.releaseFromManifest(repository);
		} catch (error) {
			await this.store.audit(
				'beepboop',
				'release.push.failed',
				`${name}: ${error instanceof Error ? error.message : 'Release from push failed'}`,
			);
		}
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
	private async mergedPreparation(
		repository: RepositoryRecord,
		stream: string,
		version: string,
		target: string,
	): Promise<string | undefined> {
		for (const result of await this.coordinator(repository.id).preparationResults(stream, version)) {
			try {
				const merge = await this.gateway.preparationMerge(repository.name, repository.id, result, target);
				if (merge) return merge;
			} catch {}
		}
		return undefined;
	}
	async prepareJsr(execution: Execution): Promise<void> {
		const ids = new Set([
			...(execution.workflow?.publications ?? []),
			...(execution.releaseSet?.required ?? execution.configuration.streams[execution.stream]?.required ?? []),
		]);
		const names = [...ids].flatMap(id => id.startsWith('pkg:jsr/') ? [decodeURIComponent(id.slice(8))] : []);
		if (!names.length) return;
		const token = await this.vault().reveal(jsrTokenAlias, `setup:${execution.id}`).then(
			credential => credential.value,
			() => {
				throw precondition(`Store a JSR access token as ${jsrTokenAlias} so Beepboop can set up ${names.join(', ')}`);
			},
		);
		for (const name of names) await prepareJsrPackage(name, execution.repository, token, fetch);
	}
	private async releaseFromManifest(stored: RepositoryRecord): Promise<void> {
		const state = readiness(stored);
		if (state.kind !== 'ready') return;
		const repository = state.repository;
		for (const [name, stream] of Object.entries(repository.configuration.streams)) {
			if (!stream.promote.workflow || stream.versionSource?.kind === 'tags') continue;
			const packages = repository.inventory.packages.filter(pkg =>
				publishable(pkg) && (!stream.packages || stream.packages.some(reference => matchesPackage(reference, pkg)))
			);
			const version = unreleasedManifestVersion(packages);
			if (!version || manifestProblems(repository.inventory, packages).length) continue;
			const merge = stream.promote.approval === 'merge'
				? await this.mergedPreparation(repository, name, version, repository.sha)
				: undefined;
			const snapshot = await this.gateway.snapshot(
				repository.name,
				repository.id,
				merge ?? repository.sha,
				(stream.versionFiles ?? []).map(rule => rule.path),
			);
			const plan = planRelease(
				snapshot,
				repository.inventory,
				version,
				stream.packages,
				undefined,
				stream.versionFiles,
			);
			if (plan.edits.length || plan.requiresPreparation) continue;
			const promotion = await createExecution(repository, {
				stream: name,
				operation: 'promote',
				eventId: `release:${version}:${plan.sourceSha}`,
				sourceSha: plan.sourceSha,
				version,
			});
			if (await this.coordinator(repository.id).execution(promotion.id)) continue;
			if (merge) promotion.approvedBy = 'merge';
			await this.store.audit('beepboop', 'release.push', promotion.id);
			await this.enqueue(repository, promotion);
		}
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
			const ids = (items: unknown) => new Set(array(items ?? []).map((item) => integer(record(item).id)));
			const removed = ids(payload.repositories_removed);
			const added = ids(payload.action === 'created' ? payload.repositories : payload.repositories_added);
			const all = payload.action === 'created' && payload.repository_selection === 'all';
			for (const repository of await this.store.enrollments()) {
				const access: Access | undefined =
					payload.action === 'deleted' || payload.action === 'suspend' || removed.has(repository.id)
						? { kind: 'suspended', since: Date.now() }
						: all || added.has(repository.id)
						? { kind: 'active' }
						: payload.action === 'unsuspend' && repository.access.kind === 'suspended'
						? await this.access(repository.name)
						: undefined;
				if (access) await this.setAccess(repository.id, access);
				else await this.coordinator(repository.id).wake();
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
		const delivery = request.headers.get('x-github-delivery');
		if (!delivery) return new Response('Missing delivery', { status: 400 });
		const received = inboxEvent.safeParse(this.inbound(event, payload));
		if (received.success) await this.coordinator(repository.id).receive(delivery, repository.id, received.data);
		return new Response(null, { status: 202 });
	}
	private inbound(event: string | null, payload: Record<string, unknown>): unknown {
		if (event === 'pull_request') return { kind: event, edit: payload };
		if (event === 'push') return { kind: event, ref: payload.ref };
		if (event === 'release') return { kind: event, action: payload.action };
		const run = record(payload.workflow_run);
		return {
			kind: event,
			action: payload.action,
			run: {
				id: run.id,
				conclusion: run.conclusion ?? null,
				event: run.event,
				path: run.path,
				headRepositoryId: record(run.head_repository ?? {}).id ?? null,
			},
		};
	}
	async receive(delivery: string, repositoryId: number, event: InboxEvent): Promise<void> {
		const repository = await this.store.repository(repositoryId);
		if (!repository) return;
		if (event.kind === 'pull_request') return this.setupEdited(repository, event.edit);
		if (event.kind === 'release') {
			if (event.action === 'published') await this.winget().automatic(repository);
			return;
		}
		if (event.kind === 'push') {
			if (event.ref === `refs/heads/${repository.defaultBranch}`) await this.refresh(repository.name, repository.id);
			return;
		}
		const { action, run } = event;
		if (action !== 'completed') return this.coordinator(repository.id).wake();
		await this.coordinator(repository.id).observeRun(repository.id, run.id);
		if (
			run.conclusion === 'success' && ['push', 'release', 'workflow_dispatch', 'schedule'].includes(run.event)
			&& run.headRepositoryId === repository.id
		) {
			await this.event({
				id: delivery,
				source: repository.name,
				event: 'workflow_run',
				workflow: run.path.replace(/^\.github\/workflows\//, ''),
			});
		}
	}
	private async setupEdited(repository: RepositoryRecord, edit: SetupPullEdit): Promise<void> {
		const { pull_request: pull, sender } = edit;
		if (pull.head.repo.id !== repository.id || pull.base.repo.id !== repository.id) return;
		const bot = await this.gateway.botIdentity();
		if (sender.id === bot.id || pull.user.id !== bot.id) return;
		const document = await this.onboarding.document(repository.id);
		if (document === undefined) return;
		const saved = record(JSON.parse(document));
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
		for (const stored of await this.store.readableRepositories()) {
			const state = readiness(stored);
			if (state.kind !== 'ready') continue;
			const repository = state.repository;
			for (const subscription of repository.configuration.subscriptions) {
				if (!matchesSubscription(subscription, event)) continue;
				const execution = await createExecution(repository, {
					stream: subscription.stream,
					operation: subscription.operation,
					eventId: `${subscription.id}:${event.id}`,
					sourceSha: repository.sha,
					version: event.version,
					upstreamRelease: event.release,
				});
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
				if (!repository) throw new Error('Destination unavailable');
				await this.enqueue(requireReady(repository), delivery.execution);
				await this.store.deliveryResult(delivery.id, true);
			} catch {
				await this.store.deliveryResult(delivery.id, false);
			}
		}
	}
	async scheduled(): Promise<void> {
		await this.sessions.sweep();
		await this.changes.prune(Date.now() - changeRetention);
		await this.deliverEvents();
		await this.winget().reconcile();
		for (const repository of await this.store.enrollments()) {
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
				const state = readiness(refreshed);
				if (state.kind !== 'ready') continue;
				const ready = state.repository;
				const now = Date.now();
				for (const [streamName, stream] of Object.entries(ready.configuration.streams)) {
					for (const [operation, binding] of Object.entries(stream.workflows)) {
						if (!binding.schedule) continue;
						const key = `${repository.id}:${streamName}:${operation}:${binding.schedule}`;
						const cursor = await this.schedules.cursor(key);
						if (cursor === undefined) {
							await this.schedules.start(key, now);
							continue;
						}
						const schedule = CronExpressionParser.parse(binding.schedule, {
							currentDate: cursor,
							tz: 'UTC',
						});
						for (let n = 0; n < 100; n++) {
							const tick = schedule.next().getTime();
							if (tick > now) break;
							await this.enqueue(
								ready,
								await createExecution(ready, {
									stream: streamName,
									operation,
									eventId: `schedule:${tick}`,
									sourceSha: ready.sha,
								}),
							);
							await this.schedules.advance(key, tick);
						}
					}
				}
			} catch {
				/* Next scheduled pass retries; preserve the last known configuration. */
			}
		}
		const notifications = this.notifications();
		await pollPackages(
			this.store,
			await this.store.readableRepositories(),
			fetch,
			event => this.event(event),
			notifications,
		);
		await notifications.deliver();
	}
}
