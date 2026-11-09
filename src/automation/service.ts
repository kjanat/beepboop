import { CronExpressionParser } from 'cron-parser';
import { Cause, Effect, Layer, Result } from 'effect';
import { z } from 'zod';
import { configuredGrant } from '@/automation/access';
import type { AuthBindings } from '@/automation/auth';
import { resolveConfiguration } from '@/automation/configuration';
import type { AutomationCoordinator } from '@/automation/coordinator';
import { createExecution, deriveExecution } from '@/automation/execution';
import { logFailure } from '@/automation/failure-log';
import type { Credentials } from '@/automation/github';
import { RepositoryGateway } from '@/automation/github';
import { workflowRunsSchema } from '@/automation/github-resources';
import type { InboxEvent, SetupPullEdit, SetupPullMerge } from '@/automation/inbox';
import { inboxEvent } from '@/automation/inbox';
import { discover, planRelease, resolvePublished, versionsInFiles } from '@/automation/managers';
import { jsrTokenAlias, jsrTokenRefused, setUpJsrPackage } from '@/automation/managers/jsr';
import { registryLayer } from '@/automation/managers/registry';
import { Notifications } from '@/automation/notifications';
import { matchesPackage, packageId, publishablePackages } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { pollPackages } from '@/automation/package-watch';
import { matchesRef } from '@/automation/policy';
import type { RefState } from '@/automation/refs';
import { conflictMessage, moduleTagPrefixes, tagConflict } from '@/automation/refs';
import { manifestProblems, releasedVersion, unreleasedManifestVersion } from '@/automation/release-version';
import { bodyChoices, releaseAfterMerge } from '@/automation/setup';
import { currentOptions, maintainSetup, rebuildingStatus, setupEdits } from '@/automation/setup-maintenance';
import { decodeError, Store } from '@/automation/store';
import { matchesSubscription } from '@/automation/subscriptions';
import type {
	AutomationEvent,
	Execution,
	Package,
	ReleaseStarted,
	RepositoryRecord,
	SubscriptionDelivery,
} from '@/automation/types';
import { parseGrant, Secrets, secretsLayer, Vault } from '@/automation/vault';
import type { WinGetBindings } from '@/automation/winget';
import { WinGetService } from '@/automation/winget';
import type { Diagnostic } from '@/contract/diagnostics';
import type { DomainError } from '@/contract/errors';
import { notFound, precondition } from '@/contract/errors';
import { setupChoicesSchema } from '@/contract/setup';
import { semVer } from '@/contract/version';
import { configurationDiagnostics, configurationProblem } from '@/domain/configuration';
import type { Access, ReadyRepository } from '@/domain/repository';
import { readiness, requireReady } from '@/domain/repository';
import { validateAgainst } from '@/domain/validate';
import { fromJson, fromPromise, fromSync, recover } from '@/failure';
import type { Parsed } from '@/model';
import { countSchema, decode, integer, looseSchema, record } from '@/model';
import { ChangeLog } from '@/persistence/d1/changes';
import { CLISessionStore } from '@/persistence/d1/cli-sessions';
import { CredentialStore } from '@/persistence/d1/credentials';
import { OnboardingStore } from '@/persistence/d1/onboarding';
import { ScheduleStore } from '@/persistence/d1/schedules';
import { SessionStore } from '@/persistence/d1/sessions';
import { executionId } from '@/persistence/identity-keys';
import { readBody, verifySignature } from '@/webhook';

const webhookInstallation = z.object({ account: z.object({ id: looseSchema }) });
const webhookRepositoryIds = z.array(z.object({ id: countSchema })).nullish();
const webhookRepository = z.object({
	id: looseSchema,
	full_name: looseSchema,
	owner: z.object({ id: looseSchema }),
});

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
	enqueue(repository: ReadyRepository, execution: Execution): Effect.Effect<Execution, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (execution.repositoryId !== repository.id) {
				return yield* precondition('Execution belongs to another repository');
			}
			const coordinator = this.coordinator(repository.id);
			if (execution.managed) return yield* fromPromise(() => coordinator.enqueue(execution));
			const existing = yield* fromPromise(() => coordinator.execution(execution.id));
			if (existing) return yield* fromPromise(() => coordinator.enqueue(existing));
			const stream = execution.configuration.streams[execution.stream];
			if (
				execution.operation === 'prepare'
				&& !execution.plan
				&& execution.version
				&& stream?.prepare.strategy !== 'workflow'
			) {
				const snapshot = yield* this.gateway.snapshot(
					repository.name,
					repository.id,
					execution.sourceSha,
					(stream?.versionFiles ?? []).map(rule => rule.path),
				);
				if (versionsInFiles(repository.inventory)) {
					execution.plan = yield* planRelease(
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
				const dependency = yield* (
					deriveExecution(execution, repository, {
						stream: execution.stream,
						operation,
						eventId: execution.eventId,
						sourceSha: execution.sourceSha,
						version: execution.version,
						upstreamRelease: execution.upstreamRelease,
					})
				);
				yield* this.enqueue(repository, dependency);
			}
			if (execution.workflow?.ref?.includes('*')) {
				return yield* precondition(
					'Dispatch requires an exact workflow ref; wildcard bindings support observation only',
				);
			}
			return yield* fromPromise(() => coordinator.enqueue(execution));
		});
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
	setAccess(id: number, access: Access): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* this.store.setAccess(id, access);
			yield* fromPromise(() => this.coordinator(id).setAccess(access.kind === 'suspended'));
		});
	}
	private access(name: string): Effect.Effect<Access, DomainError> {
		return this.gateway.installation(name).pipe(
			Effect.map((installation): Access =>
				installation === 'active' ? { kind: 'active' } : { kind: 'suspended', since: Date.now() }
			),
		);
	}
	discover(name: string, id: number | undefined): Effect.Effect<RepositoryRecord, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const installation = yield* this.gateway.installation(name);
			if (installation === 'active') {
				const repositoryId = id ?? (yield* this.gateway.identify(name));
				yield* this.setAccess(repositoryId, { kind: 'active' });
				return yield* this.refresh(name, repositoryId);
			}
			const enrolled = (yield* this.store.enrollments())
				.find(entry => entry.id === id || entry.name === name);
			const stored = enrolled && (yield* this.store.repository(enrolled.id));
			if (!stored) {
				return yield* installation === 'suspended'
					? precondition(`GitHub App access to ${name} is suspended`)
					: notFound('repository', `The GitHub App is not installed on ${name}`, name);
			}
			const access: Access = stored.access.kind === 'suspended'
				? stored.access
				: { kind: 'suspended', since: Date.now() };
			yield* this.setAccess(stored.id, access);
			return { ...stored, access };
		});
	}
	refresh(name: string, id: number): Effect.Effect<RepositoryRecord, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const snapshot = yield* this.gateway.snapshot(name, id);
			const prior = yield* this.store.enrollment(id);
			const repository: RepositoryRecord = {
				...snapshot.repository,
				access: prior?.access ?? { kind: 'active' },
				sha: snapshot.sha,
				inventory: discover(snapshot),
				presetShas: {},
				diagnostics: [],
				updatedAt: Date.now(),
			};
			const document = snapshot.files['.github/beepboop.json'];
			if (document) {
				yield* Effect.gen({ self: this }, function*() {
					const raw = yield* fromSync((): unknown => JSON.parse(document));
					const resolved = yield* resolveConfiguration(raw, ref => this.gateway.preset(ref));
					repository.configuration = resolved.configuration;
					repository.presetShas = resolved.presetShas;
					repository.diagnostics.push(...resolved.drift);
					repository.inventory = discover(snapshot, resolved.configuration.managers);
					repository.diagnostics.push(...validateAgainst(resolved.configuration, repository.inventory, snapshot));
				}).pipe(
					Effect.catchCause(cause =>
						Effect.sync(() => {
							const error = Cause.squash(cause);
							repository.diagnostics.push(
								...(error instanceof z.ZodError
									? configurationDiagnostics(error)
									: [configurationProblem(decodeError(error))]),
							);
						})
					),
				);
			} else {
				repository.diagnostics.push({
					code: 'unconfigured',
					severity: 'blocking',
					message: (yield* this.gateway.openSetupPull(name, id))
						? 'The setup pull request is open. Merge it to enable releases.'
						: 'Not configured yet. Configure releases opens a setup pull request.',
				});
			}
			const verification = this.gateway.verification(name, id);
			repository.inventory = yield* resolvePublished(repository.inventory, fetch, verification);
			yield* this.store.putRepository(repository);
			yield* fromPromise(() => this.coordinator(id).setAccess(repository.access.kind === 'suspended'));
			yield* this.releaseFromManifest(repository).pipe(
				this.store.auditFailure('beepboop', 'release.push.failed', name),
			);
			yield* maintainSetup(this.store, this.gateway, snapshot).pipe(
				this.store.auditFailure('beepboop', 'repository.setup.failed', name),
			);
			yield* this.winget().watch(repository);
			return repository;
		});
	}
	private startedPreparation(
		repository: RepositoryRecord,
		stream: string,
		version: string,
		target: string,
	): Effect.Effect<{ sha: string; started: ReleaseStarted } | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const results = yield* fromPromise(() => this.coordinator(repository.id).preparationResults(stream, version));
			for (const { started, ...result } of results) {
				if (!started) continue;
				const sha = result.kind === 'commit'
					? (yield* this.gateway.contains(repository.name, repository.id, result.head, target))
						? result.head
						: undefined
					: yield* this.gateway.preparationMerge(repository.name, repository.id, result, target);
				if (sha) return { sha, started };
			}
			return undefined;
		}).pipe(
			recover(error =>
				logFailure('started-preparation.failed', error, { repository: repository.name, stream }).pipe(
					Effect.as(undefined),
				)
			),
		);
	}
	private mergedPreparation(
		repository: RepositoryRecord,
		stream: string,
		version: string,
		target: string,
	): Effect.Effect<string | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const results = yield* fromPromise(() => this.coordinator(repository.id).preparationResults(stream, version));
			for (const result of results) {
				if (result.kind === 'commit') continue;
				const merge = yield* this.gateway.preparationMerge(repository.name, repository.id, result, target).pipe(
					recover(error =>
						logFailure('preparation-merge.failed', error, { repository: repository.name, pull: result.url }).pipe(
							Effect.as(undefined),
						)
					),
				);
				if (merge) return merge;
			}
			return undefined;
		});
	}
	prepareJsr(execution: Execution): Effect.Effect<void, DomainError> {
		const ids = new Set([
			...(execution.workflow?.publications ?? []),
			...(execution.releaseSet?.required ?? execution.configuration.streams[execution.stream]?.required ?? []),
		]);
		const names = [...ids].flatMap(id => id.startsWith('pkg:jsr/') ? [decodeURIComponent(id.slice(8))] : []);
		if (!names.length) return Effect.void;
		const repository = execution.repository;
		return Effect.gen(function*() {
			const secrets = yield* Secrets;
			const token = yield* secrets.reveal(jsrTokenAlias, `setup:${execution.id}`).pipe(
				Effect.catchIf(error => error.problem.code !== 'upstream', () => Effect.fail(jsrTokenRefused(names))),
			);
			for (const name of names) yield* setUpJsrPackage(name, repository, token);
		}).pipe(Effect.provide(Layer.mergeAll(registryLayer(fetch), secretsLayer(this.vault()))));
	}
	private releaseFromManifest(stored: RepositoryRecord): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const state = readiness(stored);
			if (state.kind !== 'ready') return;
			const repository = state.repository;
			let tags: RefState[] | undefined;
			let setupMerge: { sha: string; body: string } | null | undefined;
			const tagged: Diagnostic[] = [];
			for (const [name, stream] of Object.entries(repository.configuration.streams)) {
				if (!stream.promote.workflow || stream.versionSource?.kind === 'tags') continue;
				const packages = publishablePackages(repository.inventory.packages, stream.packages);
				const version = unreleasedManifestVersion(packages);
				if (!version || manifestProblems(repository.inventory, packages).length) continue;
				const started = yield* this.startedPreparation(repository, name, version, repository.sha);
				const merge = !started && stream.promote.approval === 'merge'
					? yield* this.mergedPreparation(repository, name, version, repository.sha)
					: undefined;
				const snapshot = yield* this.gateway.snapshot(
					repository.name,
					repository.id,
					started?.sha ?? merge ?? repository.sha,
					(stream.versionFiles ?? []).map(rule => rule.path),
				);
				const plan = yield* planRelease(
					snapshot,
					repository.inventory,
					version,
					stream.packages,
					undefined,
					stream.versionFiles,
				);
				if (plan.edits.length || plan.requiresPreparation) continue;
				const policy = stream.promote.workflow.refs;
				const parsed = semVer.safeParse(version);
				if (policy && parsed.success) {
					tags ??= yield* this.gateway.tagRefs(repository.name, repository.id);
					const conflict = tagConflict(
						policy,
						parsed.data,
						plan.sourceSha,
						tags,
						moduleTagPrefixes(repository.inventory.packages, stream.packages ?? []),
					);
					if (conflict) {
						const missing = packages.filter(pkg => releasedVersion(pkg) !== version);
						const backfill = yield* this.backfill(repository, name, conflict, version, missing);
						const stranded = missing.filter(pkg => !backfill?.covered.includes(pkg)).map(packageId);
						const message = [
							...(backfill
								? [
									`${
										backfill.covered.map(packageId).join(', ')
									} ${version} publish from ${conflict.name} after ${backfill.file} run ${backfill.run}.`,
								]
								: []),
							...(stranded.length
								? [
									`${conflictMessage(conflict)}, so ${
										stranded.join(', ')
									} cannot publish ${version}. Release a new version.`,
								]
								: []),
						].join(' ');
						tagged.push({
							code: 'version-tagged',
							severity: 'warning',
							subject: { kind: 'stream', name },
							message,
						});
						continue;
					}
				}
				const promotion = yield* (
					createExecution(repository, {
						stream: name,
						operation: 'promote',
						eventId: `release:${version}:${plan.sourceSha}`,
						sourceSha: plan.sourceSha,
						version,
					})
				);
				if (yield* fromPromise(() => this.coordinator(repository.id).execution(promotion.id))) continue;
				setupMerge ??= (yield* this.setupMerge(repository)) ?? null;
				if (setupMerge?.sha === plan.sourceSha && !releaseAfterMerge(setupMerge.body)) continue;
				if (started) {
					promotion.approvedBy = 'start';
					promotion.started = started.started;
				} else if (merge) promotion.approvedBy = 'merge';
				yield* this.store.audit('beepboop', 'release.push', promotion.id);
				yield* this.enqueue(repository, promotion);
			}
			if (tagged.length) {
				stored.diagnostics.push(...tagged);
				yield* this.store.putRepository(stored);
			}
		});
	}
	private setupMerge(
		repository: ReadyRepository,
	): Effect.Effect<{ sha: string; body: string } | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const document = yield* this.onboarding.document(repository.id);
			if (document === undefined) return undefined;
			const saved = yield* Effect.fromResult(record(yield* fromJson(document)));
			if (typeof saved.url !== 'string') return undefined;
			return yield* this.gateway.setupMerge(repository.name, repository.id, saved.url);
		});
	}
	private backfill(
		repository: ReadyRepository,
		streamName: string,
		tag: RefState,
		version: string,
		missing: Package[],
	): Effect.Effect<{ run: number; file: string; covered: Package[] } | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const workflows = repository.configuration.streams[streamName]?.workflows ?? {};
			let tagged: Package[] | undefined;
			for (const [operation, binding] of Object.entries(workflows)) {
				if (
					binding.mode !== 'observe'
					|| !matchesRef(binding.ref ?? repository.defaultBranch, `refs/tags/${tag.name}`)
				) continue;
				const dependents = Object.values(workflows).filter(next =>
					next.needs?.includes(operation)
					&& next.publications?.some(reference => missing.some(pkg => matchesPackage(reference, pkg)))
				);
				if (!dependents.length) continue;
				tagged ??= discover(
					yield* this.gateway.snapshot(repository.name, repository.id, tag.commit),
					repository.configuration.managers,
				).packages;
				const released = tagged.filter(pkg => publishable(pkg) && pkg.version === version);
				if (
					!dependents.every(next =>
						next.publications?.every(reference => released.some(pkg => matchesPackage(reference, pkg)))
					)
				) continue;
				const covered = missing.filter(pkg =>
					dependents.some(next => next.publications?.some(reference => matchesPackage(reference, pkg)))
				);
				const token = yield* this.gateway.token(repository.name, repository.id);
				const { workflow_runs: runs } = yield* this.gateway.read(
					workflowRunsSchema,
					`/repos/${repository.name}/actions/runs?head_sha=${tag.commit}&per_page=100`,
					token,
				);
				const run = runs
					.filter(run =>
						run.path === `.github/workflows/${binding.file}` && run.head_branch === tag.name
						&& run.status === 'completed'
					)
					.sort((left, right) => right.id - left.id)[0];
				if (!run) continue;
				const coordinator = this.coordinator(repository.id);
				const observed = yield* executionId(repository.id, streamName, operation, `observed:${run.id}`);
				if (!(yield* fromPromise(() => coordinator.execution(observed)))) {
					yield* fromPromise(() => coordinator.observeRun(repository.id, run.id));
					yield* this.store.audit('beepboop', 'release.backfill', `${repository.name}:${tag.name}:${run.id}`);
				}
				return { run: run.id, file: binding.file, covered };
			}
			return undefined;
		});
	}
	webhook(request: Request): Effect.Effect<Response, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const bytes = yield* readBody(request);
			const verified = yield* verifySignature(
				bytes,
				request.headers.get('x-hub-signature-256'),
				this.env.GITHUB_WEBHOOK_SECRET,
			);
			if (!verified) return new Response('Invalid signature', { status: 401 });
			const event = request.headers.get('x-github-event');
			if (
				!['push', 'release', 'workflow_run', 'pull_request', 'installation', 'installation_repositories']
					.includes(event ?? '')
			) {
				return new Response(null, { status: 204 });
			}
			const payload = yield* Effect.fromResult(record(yield* fromJson(new TextDecoder().decode(bytes))));
			if (event === 'installation' || event === 'installation_repositories') {
				const { account } = yield* Effect.fromResult(decode(webhookInstallation, payload.installation));
				if (account.id !== Number(this.env.OWNER_ID)) return new Response(null, { status: 204 });
				// Enrollment is explicit. Lifecycle events reconcile only repositories already enrolled.
				const ids = (items: unknown) =>
					Effect.fromResult(decode(webhookRepositoryIds, items)).pipe(
						Effect.map(rows => new Set((rows ?? []).map(row => row.id))),
					);
				const removed = yield* ids(payload.repositories_removed);
				const added = yield* ids(payload.action === 'created' ? payload.repositories : payload.repositories_added);
				const all = payload.action === 'created' && payload.repository_selection === 'all';
				for (const repository of yield* this.store.enrollments()) {
					const access: Access | undefined =
						payload.action === 'deleted' || payload.action === 'suspend' || removed.has(repository.id)
							? { kind: 'suspended', since: Date.now() }
							: all || added.has(repository.id)
							? { kind: 'active' }
							: payload.action === 'unsuspend' && repository.access.kind === 'suspended'
							? yield* this.access(repository.name)
							: undefined;
					if (access) yield* this.setAccess(repository.id, access);
					else yield* fromPromise(() => this.coordinator(repository.id).wake());
				}
				return new Response(null, { status: 202 });
			}
			const source = yield* Effect.fromResult(decode(webhookRepository, payload.repository));
			if (source.owner.id !== Number(this.env.OWNER_ID)) {
				return new Response(null, { status: 204 });
			}
			const sourceId = yield* Effect.fromResult(integer(source.id));
			const repository = yield* this.store.repository(sourceId);
			if (!repository || repository.name !== source.full_name) {
				return new Response(null, { status: 204 });
			}
			const delivery = request.headers.get('x-github-delivery');
			if (!delivery) return new Response('Missing delivery', { status: 400 });
			const received = inboxEvent.safeParse(yield* Effect.fromResult(this.inbound(event, payload)));
			if (received.success) {
				const data = received.data;
				yield* fromPromise(() => this.coordinator(repository.id).receive(delivery, repository.id, data));
			}
			return new Response(null, { status: 202 });
		});
	}
	private inbound(event: string | null, payload: Record<string, unknown>): Parsed<unknown> {
		if (event === 'pull_request') {
			return Result.succeed(
				payload.action === 'closed' ? { kind: 'setup_merged', merge: payload } : { kind: event, edit: payload },
			);
		}
		if (event === 'push') return Result.succeed({ kind: event, ref: payload.ref });
		if (event === 'release') return Result.succeed({ kind: event, action: payload.action });
		return Result.gen(function*() {
			const run = yield* record(payload.workflow_run);
			const headRepository = yield* record(run.head_repository ?? {});
			return {
				kind: event,
				action: payload.action,
				run: {
					id: run.id,
					conclusion: run.conclusion ?? null,
					event: run.event,
					path: run.path,
					headRepositoryId: headRepository.id ?? null,
				},
			};
		});
	}
	receive(delivery: string, repositoryId: number, event: InboxEvent): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const repository = yield* this.store.repository(repositoryId);
			if (!repository) return;
			if (event.kind === 'pull_request') return yield* this.setupEdited(repository, event.edit);
			if (event.kind === 'setup_merged') return yield* this.setupMerged(repository, event.merge);
			if (event.kind === 'release') {
				if (event.action === 'published') yield* this.winget().automatic(repository);
				return;
			}
			if (event.kind === 'push') {
				if (event.ref === `refs/heads/${repository.defaultBranch}`) yield* this.refresh(repository.name, repository.id);
				return;
			}
			const { action, run } = event;
			const coordinator = this.coordinator(repository.id);
			if (action !== 'completed') return yield* fromPromise(() => coordinator.trackRun(repository.id, run.id));
			yield* fromPromise(() => coordinator.observeRun(repository.id, run.id));
			if (
				run.conclusion === 'success' && ['push', 'release', 'workflow_dispatch', 'schedule'].includes(run.event)
				&& run.headRepositoryId === repository.id
			) {
				yield* this.event({
					id: delivery,
					source: repository.name,
					event: 'workflow_run',
					workflow: run.path.replace(/^\.github\/workflows\//, ''),
				});
			}
		});
	}
	private setupMerged(repository: RepositoryRecord, merge: SetupPullMerge): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const { pull_request: pull } = merge;
			if (pull.head.repo.id !== repository.id || pull.base.repo.id !== repository.id) return;
			const bot = yield* this.gateway.botIdentity;
			if (pull.user.id !== bot.id || pull.merged_by.login !== (yield* this.gateway.ownerLogin())) return;
			const document = yield* this.onboarding.document(repository.id);
			if (document === undefined) return;
			const saved = yield* Effect.fromResult(record(yield* fromJson(document)));
			if (saved.url !== `https://github.com/${repository.name}/pull/${pull.number}`) return;
			const choices = yield* fromSync(() => setupChoicesSchema.optional().parse(saved.choices));
			if (!choices) return;
			const generated = setupEdits(saved);
			const merged = yield* this.gateway.snapshot(
				repository.name,
				repository.id,
				pull.merge_commit_sha,
				generated.map(edit => edit.path),
			);
			if (!generated.length || generated.some(edit => merged.files[edit.path] !== edit.after)) return;
			yield* this.refresh(repository.name, repository.id);
			const current = yield* this.store.repository(repository.id);
			if (!current) return;
			const ready = yield* requireReady(current);
			const existing = yield* Effect.forEach(
				yield* this.credentials.grantDocuments({ repositoryId: repository.id }),
				parseGrant,
			);
			for (const stream of choices.streams) {
				const requested = [
					...(['prepare', 'promote'] as const).flatMap(operation =>
						Object.values(stream[operation]?.credentials ?? {}).map(alias => ({ operation, alias }))
					),
					...(stream.operations ?? []).flatMap(entry =>
						Object.values(entry.credentials ?? {}).map(alias => ({ operation: entry.name, alias }))
					),
				];
				for (const { operation, alias } of requested) {
					if ((yield* this.credentials.activeVersion(alias)) === undefined) continue;
					const grant = yield* configuredGrant(ready, { stream: stream.name, operation, alias, delivery: 'runtime' });
					if (
						existing.some(other =>
							other.alias === grant.alias && other.operation === grant.operation
							&& other.workflow === grant.workflow && other.ref === grant.ref && other.delivery === 'runtime'
						)
					) continue;
					yield* this.vault().grant(grant, `merge:${pull.merged_by.login}`);
				}
			}
			yield* fromPromise(() => this.coordinator(repository.id).wake());
		});
	}
	private setupEdited(repository: RepositoryRecord, edit: SetupPullEdit): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const { pull_request: pull, sender } = edit;
			if (pull.head.repo.id !== repository.id || pull.base.repo.id !== repository.id) return;
			const bot = yield* this.gateway.botIdentity;
			if (sender.id === bot.id || pull.user.id !== bot.id) return;
			const document = yield* this.onboarding.document(repository.id);
			if (document === undefined) return;
			const saved = yield* Effect.fromResult(record(yield* fromJson(document)));
			if (saved.url !== `https://github.com/${repository.name}/pull/${pull.number}`) return;
			const base = yield* fromSync(() => setupChoicesSchema.optional().parse(saved.choices));
			if (!base) return;
			const options = yield* currentOptions(this.store, this.gateway, repository, base);
			const body = pull.body ?? '';
			const choices = yield* fromSync(() => setupChoicesSchema.parse(bodyChoices(body, options, base)));
			const scheduled = yield* fromPromise(() =>
				this.coordinator(repository.id).setupEdited(
					{ repositoryId: repository.id, number: pull.number, head: pull.head.sha, body, choices },
					JSON.stringify(choices) !== JSON.stringify(base),
				)
			);
			if (scheduled) {
				yield* this.gateway.setupStatus(repository.name, repository.id, pull.number, rebuildingStatus(body));
			}
		});
	}
	event(event: AutomationEvent): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (
				event.event === 'release'
				&& (!event.release || event.release.repository.name !== event.source
					|| event.release.version !== event.version)
			) {
				return yield* precondition('Release event requires its upstream identity');
			}
			const deliveries: SubscriptionDelivery[] = [];
			for (const stored of yield* this.store.readableRepositories()) {
				const state = readiness(stored);
				if (state.kind !== 'ready') continue;
				const repository = state.repository;
				for (const subscription of repository.configuration.subscriptions) {
					if (!matchesSubscription(subscription, event)) continue;
					const execution = yield* (
						createExecution(repository, {
							stream: subscription.stream,
							operation: subscription.operation,
							eventId: `${subscription.id}:${event.id}`,
							sourceSha: repository.sha,
							version: event.version,
							upstreamRelease: event.release,
						})
					);
					deliveries.push({ id: execution.id, eventId: event.id, repositoryId: repository.id, execution });
				}
			}
			yield* this.store.queueEvent(event, deliveries);
			yield* this.deliverEvents();
		});
	}
	private deliverEvents(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const delivery of yield* this.store.pendingDeliveries()) {
				const delivered = yield* Effect.gen({ self: this }, function*() {
					const repository = yield* this.store.repository(delivery.repositoryId);
					if (!repository) return yield* precondition('Destination unavailable');
					const ready = yield* requireReady(repository);
					yield* this.enqueue(ready, delivery.execution);
				}).pipe(Effect.as(true), Effect.catchCause(() => Effect.succeed(false)));
				yield* this.store.deliveryResult(delivery.id, delivered);
			}
		});
	}
	private scheduleStreams(ready: ReadyRepository, now: number): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const [streamName, stream] of Object.entries(ready.configuration.streams)) {
				for (const [operation, binding] of Object.entries(stream.workflows)) {
					if (!binding.schedule) continue;
					const expression = binding.schedule;
					const key = `${ready.id}:${streamName}:${operation}:${expression}`;
					const cursor = yield* this.schedules.cursor(key);
					if (cursor === undefined) {
						yield* this.schedules.start(key, now);
						continue;
					}
					const schedule = yield* fromSync(() =>
						CronExpressionParser.parse(expression, { currentDate: cursor, tz: 'UTC' })
					);
					for (let n = 0; n < 100; n++) {
						const tick = schedule.next().getTime();
						if (tick > now) break;
						const execution = yield* (
							createExecution(ready, {
								stream: streamName,
								operation,
								eventId: `schedule:${tick}`,
								sourceSha: ready.sha,
							})
						);
						yield* this.enqueue(ready, execution);
						yield* this.schedules.advance(key, tick);
					}
				}
			}
		});
	}
	private scheduledRepository(repository: { name: string; id: number }): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const refreshed = yield* this.refresh(repository.name, repository.id);
			yield* this.winget().automatic(refreshed).pipe(
				this.store.auditFailure('winget', 'winget.failed', repository.name),
			);
			const coordinator = this.coordinator(repository.id);
			yield* fromPromise(() => coordinator.wake());
			for (const event of yield* fromPromise(() => coordinator.releaseEvents())) {
				yield* this.event(event);
				yield* fromPromise(() => coordinator.acknowledgeReleaseEvent(event.id));
			}
			const state = readiness(refreshed);
			if (state.kind !== 'ready') return;
			yield* this.scheduleStreams(state.repository, Date.now());
		});
	}
	scheduled(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* this.sessions.sweep();
			yield* this.changes.prune(Date.now() - changeRetention);
			yield* this.deliverEvents();
			yield* this.winget().reconcile();
			for (const repository of yield* this.store.enrollments()) {
				// Next scheduled pass retries; preserve the last known configuration.
				yield* this.scheduledRepository(repository).pipe(Effect.ignoreCause);
			}
			const notifications = this.notifications();
			const readable = yield* this.store.readableRepositories();
			yield* pollPackages(this.store, readable, fetch, event => this.event(event), notifications);
			yield* notifications.deliver();
		});
	}
}
