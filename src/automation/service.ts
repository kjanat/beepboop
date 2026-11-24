import { CronExpressionParser } from 'cron-parser';
import { Clock, Context, Effect, Layer, Result, Schema } from 'effect';
import type { CLISessionStore } from '@/auth/adapters/d1/cli-sessions.ts';
import type { SessionStore } from '@/auth/adapters/d1/sessions.ts';
import type { AuthBindings, AuthenticationDependencies } from '@/auth/service.ts';
import { Authentication, authentication } from '@/auth/service.ts';
import type { AutomationCoordinator } from '@/automation/coordinator';
import type { Credentials } from '@/automation/gateway.ts';
import { RepositoryGateway } from '@/automation/gateway.ts';
import { preparationMerge } from '@/automation/preparation-pull-requests';
import { repositorySnapshot } from '@/automation/snapshot';
import { Store } from '@/automation/store';
import { unchangedSince } from '@/automation/unchanged-paths';
import { configuredGrant } from '@/credentials/access.ts';
import { CredentialStore } from '@/credentials/adapters/d1/credentials.ts';
import { GrantStore } from '@/credentials/adapters/d1/grants.ts';
import { SecretDeliveryStore } from '@/credentials/adapters/d1/secret-deliveries.ts';
import type { Grant } from '@/credentials/grant.ts';
import { isRuntimeGrant, secretAliases } from '@/credentials/grant.ts';
import { secretsLayer, Vault } from '@/credentials/vault.ts';
import { metadataProblems } from '@/discovery/analysis/package-metadata.ts';
import { discover } from '@/discovery/discover.ts';
import { RepositoryCatalog } from '@/discovery/repositories/catalog.ts';
import type { Package, RepositoryRecord, Snapshot } from '@/domain/inventory.ts';
import { matchesPackage, packageId, publishablePackages } from '@/domain/package-identity.ts';
import { publishable } from '@/domain/package-publication.ts';
import { matchesRef } from '@/domain/ref-policy.ts';
import type { RefState } from '@/domain/refs.ts';
import type { Access, ReadyRepository } from '@/domain/repository';
import { readiness, requireReady } from '@/domain/repository';
import { compareVersions } from '@/domain/semver.ts';
import { hasTagPromotion } from '@/domain/start-refusal.ts';
import { semVer } from '@/domain/version.ts';
import { latestTag, versionsInFiles } from '@/domain/version-tags.ts';
import { GitHubApp, isolateGitHubApp } from '@/github/app.ts';
import { workflowRunsSchema } from '@/github/resources.ts';
import { GitHubTransport, gitHubTransportLayer } from '@/github/transport.ts';
import type { InboxEvent, SetupPullEdit, SetupPullMerge } from '@/github/webhooks.ts';
import { inboxEvent, verifySignature } from '@/github/webhooks.ts';
import { fromJson, fromPromise, fromSync, recover } from '@/kernel/errors/classify.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { logFailure, logRecovered } from '@/kernel/logging/failure-log.ts';
import type { Parsed } from '@/kernel/schema/result.ts';
import { countSchema, decode, integer, looseSchema, record } from '@/kernel/schema/result.ts';
import {
	decodeSync,
	looseStruct,
	mutableArray,
	mutableRecord,
	mutableStruct,
	safeDecode,
} from '@/kernel/schema/structs.ts';
import { ReleaseEvents } from '@/notifications/adapters/d1/events.ts';
import { Notifications } from '@/notifications/delivery.ts';
import type { EventDelivery } from '@/notifications/event-delivery.ts';
import { deliverEvent, deliverPending } from '@/notifications/event-delivery.ts';
import { pollPackages } from '@/notifications/package-watch.ts';
import { AuditStore } from '@/persistence/d1/audit';
import { ChangeLog } from '@/persistence/d1/changes';
import { Database, databaseLayer, sql } from '@/persistence/d1/database';
import { OnboardingStore } from '@/persistence/d1/onboarding';
import { ScheduleStore } from '@/persistence/d1/schedules';
import { registryLayer } from '@/publication/registries/registry.ts';
import { resolvePublished } from '@/publication/registries/verify.ts';
import { setUpJsrPackages } from '@/publication/setup/jsr.ts';
import type { WinGetBindings } from '@/publication/winget/service.ts';
import { WinGetService } from '@/publication/winget/service.ts';
import { createExecution, deriveExecution } from '@/release/domain/execution/execution.ts';
import type { AutomationEvent, Execution, ReleaseStarted, Stream } from '@/release/domain/execution/types.ts';
import { executionId } from '@/release/domain/identity-keys.ts';
import { planVersionFiles } from '@/release/domain/planning/editors.ts';
import { planRelease } from '@/release/domain/planning/managers.ts';
import { conflictMessage, streamModuleTagPrefixes, tagConflicts } from '@/release/domain/refs.ts';
import {
	manifestProblems,
	releasedVersion,
	releasePaths,
	unreleasedManifestVersion,
} from '@/release/domain/version.ts';
import { releaseAfterMerge } from '@/setup/body.ts';
import { setupChoicesSchema } from '@/setup/contract.ts';
import { inferredConfiguration } from '@/setup/draft.ts';
import { bodyChoices } from '@/setup/options.ts';
import type { PublishingAccess } from '@/setup/publishing.ts';
import { currentOptions, maintainSetup, rebuildingStatus, setupEdits } from '@/setup/server/maintenance.ts';
import { openSetupPull, setupMerge, setupStatus } from '@/setup/server/pull-requests.ts';
import { workflowCredentials } from '@/setup/workflows/integrate.ts';
import { readBody } from '@/webhook';

const webhookInstallation = mutableStruct({ account: mutableStruct({ id: looseSchema }) });
const webhookRepositoryIds = Schema.optional(Schema.NullOr(mutableArray(mutableStruct({ id: countSchema }))));
const webhookRepository = mutableStruct({
	id: looseSchema,
	full_name: looseSchema,
	owner: mutableStruct({ id: looseSchema }),
});

const changeRetention = 7 * 24 * 60 * 60 * 1000;
export interface AutomationBindings extends AuthBindings, Credentials, WinGetBindings {
	AUTOMATION: DurableObjectNamespace<AutomationCoordinator>;
	OWNER_ID: string;
	GITHUB_WEBHOOK_SECRET: string;
	VAULT_KEYS: string;
	VAULT_ACTIVE_KEY: string;
}
const retiredStates: readonly string[] = ['cancelled', 'failed'];

export class AutomationService {
	constructor(
		readonly env: AutomationBindings,
		readonly dependencies: AutomationDependencies,
		readonly defer?: (work: Promise<void>) => void,
	) {}
	get authentication() {
		return this.dependencies.authentication;
	}
	get store() {
		return this.dependencies.store;
	}
	get gateway() {
		return this.dependencies.gateway;
	}
	get credentials() {
		return this.dependencies.credentials;
	}
	get grants() {
		return this.dependencies.grants;
	}
	get secretDeliveries() {
		return this.dependencies.secretDeliveries;
	}
	get sessions() {
		return this.dependencies.sessions;
	}
	get cliSessions() {
		return this.dependencies.cliSessions;
	}
	get schedules() {
		return this.dependencies.schedules;
	}
	get onboarding() {
		return this.dependencies.onboarding;
	}
	get changes() {
		return this.dependencies.changes;
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
			if (existing) return yield* fromPromise(() => coordinator.enqueue(execution));
			const stream = execution.configuration.streams[execution.stream];
			if (
				execution.operation === 'prepare'
				&& !execution.plan
				&& execution.version
				&& stream?.prepare.strategy !== 'workflow'
			) {
				const snapshot = yield* repositorySnapshot(
					this.gateway,
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
		}).pipe(
			Effect.withSpan('release.enqueue', { attributes: { repositoryId: repository.id, executionId: execution.id } }),
			Effect.annotateLogs({ repositoryId: repository.id, executionId: execution.id }),
		);
	}
	winget() {
		return new WinGetService(this.store.db, this.gateway, this.env);
	}
	notifications() {
		return new Notifications(this.store.db, () => this.vault(), this.dependencies.transport);
	}
	vault() {
		return this.dependencies.vault;
	}

	publishingAccess(repository: { name: string; id: number }): PublishingAccess {
		return {
			request: this.dependencies.transport,
			github: this.gateway.verification(repository.name, repository.id, {
				contents: 'read',
				actions: 'read',
				secrets: 'read',
				actions_variables: 'read',
				environments: 'read',
			}).github,
			cargoToken: (file, secrets) => Effect.gen({ self: this }, function*() {
				const grants = yield* this.grants.list({ repositoryId: repository.id });
				const aliases = [...new Set([
					...secretAliases(grants, file, secrets),
					'crates-io',
				])];
				for (const alias of aliases) {
					if (yield* this.credentials.activeVersion(alias)) {
						return (yield* this.vault().reveal(alias, 'beepboop:setup-publishing')).value;
					}
				}
				return undefined;
			}),
		};
	}

	get catalog(): RepositoryCatalog {
		return new RepositoryCatalog({
			store: this.store.repositories,
			installation: name => this.gateway.installation(name),
			identify: name => this.gateway.identify(name),
			snapshot: (name, id) => repositorySnapshot(this.gateway, name, id),
			preset: reference => this.gateway.preset(reference),
			inferConfiguration: inferredConfiguration,
			setupPullOpen: (name, id) => openSetupPull(this.gateway, name, id).pipe(Effect.map(Boolean)),
			resolvePublished: (inventory, name, id) =>
				resolvePublished(inventory, this.dependencies.transport, this.gateway.verification(name, id)),
			wake: id => fromPromise(() => this.coordinator(id).wake()),
			refreshed: (name, repository, saved, snapshot) =>
				Effect.gen({ self: this }, function*() {
					yield* this.releaseFromManifest(repository, saved).pipe(
						this.store.auditFailure('beepboop', 'release.push.failed', name),
					);
					yield* maintainSetup(this.store, this.gateway, snapshot, this.publishingAccess(snapshot.repository)).pipe(
						this.store.auditFailure('beepboop', 'repository.setup.failed', name),
					);
					yield* this.winget().watch(repository);
				}),
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
				const merge = result.kind === 'commit'
					? (yield* this.gateway.contains(repository.name, repository.id, result.head, target))
						? { sha: result.head, extended: false }
						: undefined
					: yield* preparationMerge(this.gateway, repository.name, repository.id, result, target);
				if (merge && !merge.extended) return { sha: merge.sha, started };
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
				const merge = yield* preparationMerge(this.gateway, repository.name, repository.id, result, target).pipe(
					recover(error =>
						logFailure('preparation-merge.failed', error, { repository: repository.name, pull: result.url }).pipe(
							Effect.as(undefined),
						)
					),
				);
				if (merge) return merge.sha;
			}
			return undefined;
		});
	}
	private landedCommit(
		repository: RepositoryRecord,
		stream: string,
		version: string,
		target: string,
	): Effect.Effect<string | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const results = yield* fromPromise(() => this.coordinator(repository.id).preparationResults(stream, version));
			for (const result of results) {
				if (result.kind !== 'commit') continue;
				if (yield* this.gateway.contains(repository.name, repository.id, result.head, target)) return result.head;
			}
			return undefined;
		}).pipe(
			recover(error =>
				logFailure('landed-commit.failed', error, { repository: repository.name, stream }).pipe(
					Effect.as(undefined),
				)
			),
		);
	}
	private releaseHeld(
		repository: ReadyRepository,
		stream: Stream,
		packages: Package[],
		commit: string,
	): Effect.Effect<Snapshot | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const paths = releasePaths(repository.inventory.packages, stream);
			if (!(yield* unchangedSince(this.gateway, repository.name, repository.id, commit, repository.sha, paths))) {
				return undefined;
			}
			const snapshot = yield* repositorySnapshot(
				this.gateway,
				repository.name,
				repository.id,
				commit,
				(stream.versionFiles ?? []).map(rule => rule.path),
			);
			if (commit === repository.sha) return snapshot;
			const metadata = metadataProblems(discover(snapshot, repository.configuration.managers), packages);
			return metadata.join('\n') === metadataProblems(repository.inventory, packages).join('\n')
				? snapshot
				: undefined;
		});
	}
	private versionCommit(
		repository: ReadyRepository,
		streamName: string,
		stream: Stream,
		promotions: Execution[],
		packages: Package[],
	): Effect.Effect<Snapshot | undefined, DomainError> {
		return Effect.gen({ self: this }, function*() {
			for (const promotion of promotions) {
				if (retiredStates.includes(promotion.state)) continue;
				if (JSON.stringify(promotion.configuration.streams[streamName]) !== JSON.stringify(stream)) continue;
				const held = yield* this.releaseHeld(repository, stream, packages, promotion.sourceSha).pipe(
					recover(error =>
						logFailure('version-commit.failed', error, {
							repository: repository.name,
							stream: streamName,
							promotion: promotion.id,
						}).pipe(Effect.as(undefined))
					),
				);
				if (held) return held;
			}
			return undefined;
		});
	}
	prepareJsr(execution: Execution): Effect.Effect<void, DomainError> {
		const ids = [
			...(execution.workflow?.publications ?? []),
			...(execution.releaseSet?.required ?? execution.configuration.streams[execution.stream]?.required ?? []),
		];
		return setUpJsrPackages(ids, execution.repository, `setup:${execution.id}`).pipe(
			Effect.provide(Layer.mergeAll(registryLayer(this.dependencies.transport), secretsLayer(this.vault()))),
		);
	}
	private releaseFromManifest(stored: RepositoryRecord, saved: string): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const state = readiness(stored);
			if (state.kind !== 'ready') return;
			const tagged: Diagnostic[] = [];
			const exit = yield* Effect.exit(this.releaseStreams(state.repository, tagged));
			if (tagged.length) {
				stored.diagnostics.push(...tagged);
				yield* this.store.repositories.replaceDiscovery(saved, stored);
			}
			return yield* exit;
		});
	}
	private releaseStreams(repository: ReadyRepository, tagged: Diagnostic[]): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			let tags: RefState[] | undefined;
			let setupMerge: { sha: string; body: string } | null | undefined;
			for (const [name, stream] of Object.entries(repository.configuration.streams)) {
				if (!stream.promote.workflow) continue;
				if (stream.versionSource?.kind === 'tags') {
					yield* this.releasePreparedTags(repository, name, stream, stream.versionSource.prefix);
					continue;
				}
				const packages = publishablePackages(repository.inventory.packages, stream.packages);
				const unread = packages.filter(pkg => pkg.publicationStatus === 'failed');
				if (unread.length) {
					tagged.push({
						code: 'release-unchecked',
						severity: 'warning',
						subject: { kind: 'stream', name },
						message: `Beepboop starts no release of stream ${name} until its registries answer for ${
							unread.map(packageId).join(', ')
						}. The next push or discovery asks again.`,
					});
					continue;
				}
				const version = unreleasedManifestVersion(packages);
				if (!version || manifestProblems(repository.inventory, packages).length) continue;
				const { started, merge, held, snapshot } = yield* this.releaseSource(
					repository,
					name,
					stream,
					version,
					packages,
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
				let reclaims: RefState[] = [];
				if (stream.promote.workflow.refs) {
					tags ??= yield* this.gateway.tagRefs(repository.name, repository.id);
					const claim = yield* this.tagClaims(repository, name, stream, version, plan.sourceSha, tags);
					reclaims = claim.reclaims;
					const { conflict } = claim;
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
				if (reclaims.length) promotion.reclaims = reclaims;
				if (yield* fromPromise(() => this.coordinator(repository.id).execution(promotion.id))) continue;
				setupMerge ??= (yield* this.setupMerge(repository)) ?? null;
				if (setupMerge?.sha === plan.sourceSha && !releaseAfterMerge(setupMerge.body)) continue;
				if (started && held) {
					promotion.approvedBy = 'start';
					promotion.started = started.started;
				} else if (merge && held && stream.promote.approval === 'merge') promotion.approvedBy = 'merge';
				yield* this.store.audit('beepboop', 'release.push', promotion.id);
				yield* this.enqueue(repository, promotion);
			}
		});
	}
	private releasePreparedTags(
		repository: ReadyRepository,
		name: string,
		stream: Stream,
		prefix: string,
	): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (!hasTagPromotion(stream, prefix)) return;
			const coordinator = this.coordinator(repository.id);
			const versions = yield* fromPromise(() => coordinator.preparationVersions(name));
			if (!versions.length) return;
			const tags = yield* this.gateway.tagRefs(repository.name, repository.id);
			const latest = latestTag(tags.map(ref => ref.name), prefix);
			const packages = publishablePackages(repository.inventory.packages, stream.packages);
			for (const version of versions.sort(compareVersions)) {
				if (latest && compareVersions(version, latest) <= 0) continue;
				const started = yield* this.startedPreparation(repository, name, version, repository.sha);
				const merged = started ? undefined : yield* this.mergedPreparation(repository, name, version, repository.sha);
				const prepared = started?.sha ?? merged
					?? (yield* this.landedCommit(repository, name, version, repository.sha));
				if (!prepared) continue;
				const snapshot = yield* this.releaseHeld(repository, stream, packages, prepared);
				if (!snapshot) continue;
				const plan = versionsInFiles(repository.inventory)
					? yield* planRelease(snapshot, repository.inventory, version, stream.packages, undefined, stream.versionFiles)
					: stream.versionFiles?.length
					? yield* planVersionFiles(snapshot, version, stream.versionFiles)
					: undefined;
				if (plan?.edits.length || plan?.requiresPreparation) continue;
				const promotion = yield* createExecution(repository, {
					stream: name,
					operation: 'promote',
					eventId: `release:${version}:${snapshot.sha}`,
					sourceSha: snapshot.sha,
					version,
				});
				if (yield* fromPromise(() => coordinator.execution(promotion.id))) continue;
				const claim = yield* this.tagClaims(repository, name, stream, version, snapshot.sha, tags);
				if (claim.conflict) continue;
				promotion.reclaims = claim.reclaims;
				if (started) {
					promotion.approvedBy = 'start';
					promotion.started = started.started;
					promotion.initiatedBy = started.started.actor;
				} else if (merged && stream.promote.approval === 'merge') promotion.approvedBy = 'merge';
				yield* this.store.audit('beepboop', 'release.push', promotion.id);
				yield* this.enqueue(repository, promotion);
			}
		});
	}
	releaseSource(
		repository: ReadyRepository,
		name: string,
		stream: Stream,
		version: string,
		packages: Package[],
	): Effect.Effect<
		{
			snapshot: Snapshot;
			started: { sha: string; started: ReleaseStarted } | undefined;
			merge: string | undefined;
			held: Snapshot | undefined;
		},
		DomainError
	> {
		return Effect.gen({ self: this }, function*() {
			const started = yield* this.startedPreparation(repository, name, version, repository.sha);
			const merge = started ? undefined : yield* this.mergedPreparation(repository, name, version, repository.sha);
			const promotions = yield* fromPromise(() => this.coordinator(repository.id).promotions(name, version));
			const prepared = started?.sha ?? merge;
			const retired = promotions.some(promotion =>
				promotion.sourceSha === prepared && retiredStates.includes(promotion.state)
			);
			const held = prepared === undefined || retired
				? undefined
				: yield* this.releaseHeld(repository, stream, packages, prepared);
			const snapshot = held ?? (yield* this.versionCommit(repository, name, stream, promotions, packages))
				?? (yield* repositorySnapshot(
					this.gateway,
					repository.name,
					repository.id,
					repository.sha,
					(stream.versionFiles ?? []).map(rule => rule.path),
				));
			return { snapshot, started, merge, held };
		});
	}
	tagClaims(
		repository: ReadyRepository,
		name: string,
		stream: Stream,
		version: string,
		sourceSha: string,
		known?: RefState[],
	): Effect.Effect<{ reclaims: RefState[]; conflict?: RefState }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const policy = stream.promote.workflow?.refs;
			const parsed = safeDecode(semVer, version);
			if (!policy || !parsed.success) return { reclaims: [] };
			const tags = known ?? (yield* this.gateway.tagRefs(repository.name, repository.id));
			const conflicts = tagConflicts(
				policy,
				parsed.data,
				sourceSha,
				tags,
				streamModuleTagPrefixes(repository.inventory.packages, stream),
			);
			const [conflict] = conflicts;
			if (!conflict) return { reclaims: [] };
			const owned = yield* fromPromise(() =>
				this.coordinator(repository.id).reclaimable(
					repository.id,
					name,
					version,
					`${policy.prefix}${version}`,
					conflicts,
				)
			);
			return owned.length === conflicts.length ? { reclaims: owned } : { reclaims: [], conflict };
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
			return yield* setupMerge(this.gateway, repository.name, repository.id, saved.url);
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
					yield* repositorySnapshot(this.gateway, repository.name, repository.id, tag.commit),
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
			const clock = yield* Clock.Clock;

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
				for (const repository of yield* this.store.repositories.enrollments()) {
					const access: Access | undefined =
						payload.action === 'deleted' || payload.action === 'suspend' || removed.has(repository.id)
							? { kind: 'suspended', since: clock.currentTimeMillisUnsafe() }
							: all || added.has(repository.id)
							? { kind: 'active' }
							: payload.action === 'unsuspend' && repository.access.kind === 'suspended'
							? yield* this.catalog.access(repository.name)
							: undefined;
					if (access) yield* this.catalog.setAccess(repository.id, access);
					else yield* fromPromise(() => this.coordinator(repository.id).wake());
				}
				return new Response(null, { status: 202 });
			}
			const source = yield* Effect.fromResult(decode(webhookRepository, payload.repository));
			if (source.owner.id !== Number(this.env.OWNER_ID)) {
				return new Response(null, { status: 204 });
			}
			const sourceId = yield* Effect.fromResult(integer(source.id));
			const repository = yield* this.store.repositories.get(sourceId);
			if (!repository || repository.name !== source.full_name) {
				return new Response(null, { status: 204 });
			}
			const delivery = request.headers.get('x-github-delivery');
			if (!delivery) return new Response('Missing delivery', { status: 400 });
			const received = safeDecode(inboxEvent, yield* Effect.fromResult(this.inbound(event, payload)));
			if (received.success) {
				const data = received.data;
				yield* fromPromise(() => this.coordinator(repository.id).receive(delivery, repository.id, data));
			}
			return new Response(null, { status: 202 });
		}).pipe(
			Effect.withSpan('webhook.receive', {
				attributes: { deliveryId: request.headers.get('x-github-delivery') ?? '' },
			}),
			Effect.annotateLogs({ deliveryId: request.headers.get('x-github-delivery') ?? '' }),
		);
	}
	private inbound(event: string | null, payload: Record<string, unknown>): Parsed<unknown> {
		if (event === 'pull_request') {
			return Result.succeed(
				payload.action === 'closed' ? { kind: 'setup_merged', merge: payload } : { kind: event, edit: payload },
			);
		}
		if (event === 'push') return Result.succeed({ kind: event, ref: payload.ref });
		if (event === 'release') {
			const release = safeDecode(looseStruct({ tag_name: Schema.String }), payload.release);
			return Result.succeed({
				kind: event,
				action: payload.action,
				...(release.success ? { tag: release.data.tag_name } : {}),
			});
		}
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
			const repository = yield* this.store.repositories.get(repositoryId);
			if (!repository) return;
			if (event.kind === 'pull_request') return yield* this.setupEdited(repository, event.edit);
			if (event.kind === 'setup_merged') return yield* this.setupMerged(repository, event.merge);
			if (event.kind === 'release') {
				if (event.action !== 'published') return;
				const tag = event.tag;
				if (tag) yield* fromPromise(() => this.coordinator(repository.id).releasePublished(tag));
				yield* this.winget().automatic(repository);
				return;
			}
			if (event.kind === 'push') {
				if (event.ref === `refs/heads/${repository.defaultBranch}`) {
					yield* this.catalog.refresh(repository.name, repository.id);
				}
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
			const choices = yield* fromSync(() => decodeSync(Schema.optional(setupChoicesSchema), saved.choices));
			if (!choices) return;
			const generated = setupEdits(saved);
			const workflowPath = (file: string | undefined) => file === undefined ? [] : [`.github/workflows/${file}`];
			const workflows = choices.streams.flatMap(stream => [
				...workflowPath(stream.prepare?.file),
				...workflowPath(stream.promote?.file),
				...(stream.operations ?? []).flatMap(entry => workflowPath(entry.file)),
			]);
			const merged = yield* repositorySnapshot(this.gateway, repository.name, repository.id, pull.merge_commit_sha, [
				...new Set([...generated.map(edit => edit.path), ...workflows]),
			]);
			if (!generated.length || generated.some(edit => merged.files[edit.path] !== edit.after)) return;
			yield* this.catalog.refresh(repository.name, repository.id);
			const current = yield* this.store.repositories.get(repository.id);
			if (!current) return;
			const ready = yield* requireReady(current);
			const existing = yield* this.grants.list({ repositoryId: repository.id });
			const granted: Grant[] = [];
			for (const stream of choices.streams) {
				const requested: { operation: string; alias: string; environment?: string }[] = [
					...(['prepare', 'promote'] as const).flatMap(operation =>
						Object.values(stream[operation]?.credentials ?? {}).map(alias => ({ operation, alias }))
					),
					...(['prepare', 'promote'] as const).flatMap(operation =>
						workflowPath(stream[operation]?.file).flatMap(path =>
							workflowCredentials(merged.files[path], operation).credentials.map(credential => ({
								operation,
								...credential,
							}))
						)
					),
					...(stream.operations ?? []).flatMap(entry =>
						Object.values(entry.credentials ?? {}).map(alias => ({ operation: entry.name, alias }))
					),
					...(stream.operations ?? []).flatMap(entry =>
						workflowPath(entry.file).flatMap(path =>
							workflowCredentials(merged.files[path], entry.name).credentials.map(credential => ({
								operation: entry.name,
								...credential,
							}))
						)
					),
				];
				const approved = ready.configuration.streams[stream.name]?.credentials ?? [];
				for (const { operation, alias, environment } of requested) {
					if (!approved.includes(alias) || environment?.includes('${{')) {
						yield* Effect.logWarning('setup.grant.skipped').pipe(
							Effect.annotateLogs({ repository: repository.name, stream: stream.name, operation, alias, environment }),
						);
						continue;
					}
					if ((yield* this.credentials.activeVersion(alias)) === undefined) continue;
					const grant = yield* configuredGrant(ready, {
						stream: stream.name,
						operation,
						alias,
						delivery: 'runtime',
						...(environment === undefined ? {} : { environment }),
					});
					if (
						[...existing, ...granted].some(other =>
							other.alias === grant.alias && other.operation === grant.operation
							&& other.workflow === grant.workflow && other.ref === grant.ref && isRuntimeGrant(other)
							&& other.environment === grant.environment
						)
					) continue;
					yield* this.vault().grant(grant, `merge:${pull.merged_by.login}`);
					granted.push(grant);
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
			const base = yield* fromSync(() => decodeSync(Schema.optional(setupChoicesSchema), saved.choices));
			if (!base) return;
			const options = yield* currentOptions(
				this.store,
				this.gateway,
				repository,
				base,
				this.publishingAccess(repository),
			);
			const body = pull.body ?? '';
			const choices = yield* fromSync(() => decodeSync(setupChoicesSchema, bodyChoices(body, options, base)));
			const scheduled = yield* fromPromise(() =>
				this.coordinator(repository.id).setupEdited(
					{ repositoryId: repository.id, number: pull.number, head: pull.head.sha, body, choices },
					JSON.stringify(choices) !== JSON.stringify(base),
				)
			);
			if (scheduled) {
				yield* setupStatus(this.gateway, repository.name, repository.id, pull.number, rebuildingStatus(body));
			}
		});
	}
	releaseEvents() {
		return new ReleaseEvents(sql(this.store.db));
	}
	private eventDelivery(): EventDelivery {
		return {
			events: this.releaseEvents(),
			repositories: this.store.repositories.readable(),
			repository: id => this.store.repositories.get(id),
			packagePublished: (repositoryId, registry, name, version) =>
				fromPromise(() => this.coordinator(repositoryId).packagePublished(registry, name, version)),
			openIssue: (ready, deliveryId, issue) =>
				fromPromise(() => this.coordinator(ready.id).openSubscriptionIssue(ready.name, ready.id, deliveryId, issue)),
			enqueue: (ready, execution) => this.enqueue(ready, execution),
		};
	}
	event(event: AutomationEvent): Effect.Effect<void, DomainError> {
		return deliverEvent(this.eventDelivery(), event).pipe(
			Effect.withSpan('release.event', { attributes: { eventId: event.id } }),
			Effect.annotateLogs({ eventId: event.id }),
		);
	}
	private deliverEvents: Effect.Effect<void, DomainError> = Effect.suspend(() => deliverPending(this.eventDelivery()));
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
			const clock = yield* Clock.Clock;

			const refreshed = yield* this.catalog.refresh(repository.name, repository.id);
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
			yield* this.scheduleStreams(state.repository, clock.currentTimeMillisUnsafe());
		});
	}
	scheduled: Effect.Effect<void, DomainError> = Effect.gen({ self: this }, function*() {
		const clock = yield* Clock.Clock;

		yield* this.sessions.sweep();
		yield* this.changes.prune(clock.currentTimeMillisUnsafe() - changeRetention);
		yield* this.deliverEvents;
		yield* this.winget().reconcile();
		for (const repository of yield* this.store.repositories.enrollments()) {
			// Next scheduled pass retries; preserve the last known configuration.
			yield* this.scheduledRepository(repository).pipe(
				logRecovered('repository.scheduled.failed', { repositoryId: repository.id, repository: repository.name }),
			);
		}
		const notifications = this.notifications();
		const readable = yield* this.store.repositories.readable();
		yield* pollPackages(
			this.store.db,
			readable,
			this.dependencies.transport,
			event => this.event(event),
			notifications,
		);
		yield* notifications.deliver();
	});
}

export interface AutomationDependencies {
	readonly authentication: AuthenticationDependencies;
	readonly store: Store;
	readonly vault: Pick<Vault, keyof Vault>;
	readonly gateway: RepositoryGateway;
	readonly credentials: CredentialStore;
	readonly grants: GrantStore;
	readonly secretDeliveries: SecretDeliveryStore;
	readonly sessions: SessionStore;
	readonly cliSessions: CLISessionStore;
	readonly schedules: ScheduleStore;
	readonly onboarding: OnboardingStore;
	readonly changes: ChangeLog;
	readonly transport: Fetcher;
}

export class ApplicationConfiguration extends Context.Service<ApplicationConfiguration, {
	readonly env: AutomationBindings;
	readonly defer?: (work: Promise<void>) => void;
}>()('beepboop/ApplicationConfiguration') {}

export class HttpTransport
	extends Context.Service<HttpTransport, { readonly fetch: Fetcher }>()('beepboop/HttpTransport')
{}
export class ApplicationSecrets
	extends Context.Service<ApplicationSecrets, Pick<Vault, keyof Vault>>()('beepboop/ApplicationSecrets')
{}
export class Automation extends Context.Service<Automation, AutomationService>()('beepboop/Automation') {}

export const makeAutomation = Effect.gen(function*() {
	const { env, defer } = yield* ApplicationConfiguration;
	const db = yield* Database;
	const vault = yield* ApplicationSecrets;
	const auth = yield* Authentication;
	const github = yield* GitHubTransport;
	const app = yield* GitHubApp;
	const { fetch: transport } = yield* HttpTransport;
	return new AutomationService(env, {
		authentication: auth,
		store: new Store(db),
		vault,
		gateway: new RepositoryGateway(env, Number(env.OWNER_ID), transport, defer, github, app),
		credentials: new CredentialStore(db),
		grants: new GrantStore(db),
		secretDeliveries: new SecretDeliveryStore(db),
		sessions: auth.sessions,
		cliSessions: auth.cliSessions,
		schedules: new ScheduleStore(db),
		onboarding: new OnboardingStore(db),
		changes: new ChangeLog(db),
		transport,
	}, defer);
});

export const automationLayer = Layer.effect(Automation, makeAutomation);

export const authenticationLayer = Layer.effect(
	Authentication,
	Effect.gen(function*() {
		const { env } = yield* ApplicationConfiguration;
		const db = yield* Database;
		const { fetch: transport } = yield* HttpTransport;
		return yield* authentication(env, db, transport);
	}),
);

export function applicationLayer(
	env: AutomationBindings,
	defer?: (work: Promise<void>) => void,
	transport: Fetcher = platformFetch,
) {
	const base = Layer.mergeAll(
		Layer.succeed(ApplicationConfiguration, { env, defer }),
		Layer.succeed(HttpTransport, { fetch: transport }),
		databaseLayer(env.DB),
		gitHubTransportLayer(transport),
		Layer.sync(GitHubApp, () => isolateGitHubApp(transport, env, Number(env.OWNER_ID))),
	);
	const secrets = Layer.effect(
		ApplicationSecrets,
		Effect.gen(function*() {
			const db = yield* Database;
			const { env } = yield* ApplicationConfiguration;
			const keys = yield* fromJson(env.VAULT_KEYS).pipe(
				Effect.flatMap(value => fromSync(() => decodeSync(mutableRecord(Schema.String, Schema.String), value))),
			);
			return new Vault(
				new AuditStore(db),
				{ credentials: new CredentialStore(db), grants: new GrantStore(db), deliveries: new SecretDeliveryStore(db) },
				keys,
				env.VAULT_ACTIVE_KEY,
			);
		}),
	);

	return automationLayer.pipe(
		Layer.provide(Layer.mergeAll(secrets, authenticationLayer).pipe(Layer.provideMerge(base))),
	);
}

export function withAutomation<A, E, R>(
	use: (service: AutomationService) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Automation> {
	return Effect.flatMap(Automation, use);
}
