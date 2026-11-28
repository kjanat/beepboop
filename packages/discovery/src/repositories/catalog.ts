import { Clock, Effect, Schema } from 'effect';
import type { RepositoryStore } from '@/discovery/adapters/d1/repositories.ts';
import { discover } from '@/discovery/discover.ts';
import { validateAgainst } from '@/discovery/validation/validate.ts';
import { resolveConfiguration } from '@/domain/configuration/presets.ts';
import { configurationDiagnostics, configurationPath, configurationProblem } from '@/domain/configuration/schema.ts';
import type { Inventory, RepositoryRecord, Snapshot } from '@/domain/inventory.ts';
import type { Access, RepositoryDiscovery } from '@/domain/repository';
import { repositoryReference } from '@/domain/repository-name.ts';
import type { InstallationState } from '@/github/app.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { invalid, notFound, precondition } from '@/kernel/errors/domain-error.ts';
import { logFailure } from '@/kernel/logging/failure-log.ts';

export interface CatalogSources {
	readonly store: RepositoryStore;
	installation(name: string): Effect.Effect<InstallationState, DomainError>;
	identify(name: string): Effect.Effect<number, DomainError>;
	snapshot(name: string, id: number): Effect.Effect<Snapshot, DomainError>;
	preset(reference: string): Effect.Effect<{ value: unknown; sha: string }, DomainError>;
	inferConfiguration(snapshot: Snapshot, inventory: Inventory): Effect.Effect<string | undefined, DomainError>;
	setupPullOpen(name: string, id: number): Effect.Effect<boolean, DomainError>;
	resolvePublished(inventory: Inventory, name: string, id: number): Effect.Effect<Inventory>;
	wake(id: number): Effect.Effect<void, DomainError>;
	refreshed(
		name: string,
		repository: RepositoryRecord,
		document: string,
		snapshot: Snapshot,
	): Effect.Effect<void, DomainError>;
}

export class RepositoryCatalog {
	constructor(private readonly sources: CatalogSources) {}
	get(id: number): Effect.Effect<RepositoryRecord | undefined, DomainError> {
		return this.sources.store.get(id);
	}
	resolve(input: string): Effect.Effect<RepositoryRecord, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const wanted = yield* repositoryReference(input).pipe(
				Effect.mapError(error => invalid(error.message, ['repository'])),
			);
			const name = wanted.name.toLowerCase(), owner = wanted.owner?.toLowerCase();
			const matches = (yield* this.sources.store.enrollments()).filter(repository => {
				const [candidateOwner = '', candidateName = ''] = repository.name.toLowerCase().split('/');
				return candidateName === name && (owner === undefined || candidateOwner === owner);
			});
			const [found, ...others] = matches;
			if (others.length) {
				return yield* precondition(
					`Repository ${input} matches ${matches.map(repository => repository.name).join(', ')}; name the owner`,
				);
			}
			const stored = found ? yield* this.sources.store.get(found.id) : undefined;
			if (stored) return stored;
			return yield* notFound(
				'repository',
				`Repository ${input} is not enrolled; run beepboop repositories discover ${input}`,
				input,
			);
		});
	}
	setAccess(id: number, access: Access): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (yield* this.sources.store.setAccess(id, access)) yield* this.sources.wake(id);
		});
	}
	access(name: string): Effect.Effect<Access, DomainError> {
		return Effect.clockWith(clock => {
			return this.sources.installation(name).pipe(
				Effect.map((installation): Access =>
					installation === 'active' ? { kind: 'active' } : { kind: 'suspended', since: clock.currentTimeMillisUnsafe() }
				),
			);
		});
	}
	discover(name: string, id: number | undefined): Effect.Effect<RepositoryRecord, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const installation = yield* this.sources.installation(name);
			if (installation === 'active') {
				const repositoryId = id ?? (yield* this.sources.identify(name));
				yield* this.setAccess(repositoryId, { kind: 'active' });
				return yield* this.refresh(name, repositoryId);
			}
			const enrolled = (yield* this.sources.store.enrollments())
				.find(entry => entry.id === id || entry.name === name);
			const stored = enrolled && (yield* this.sources.store.get(enrolled.id));
			if (!stored) {
				return yield* installation === 'suspended'
					? precondition(`GitHub App access to ${name} is suspended`)
					: notFound('repository', `The GitHub App is not installed on ${name}`, name);
			}
			const access: Access = stored.access.kind === 'suspended'
				? stored.access
				: { kind: 'suspended', since: clock.currentTimeMillisUnsafe() };
			yield* this.setAccess(stored.id, access);
			return { ...stored, access };
		});
	}
	refresh(name: string, id: number): Effect.Effect<RepositoryRecord, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const snapshot = yield* this.sources.snapshot(name, id);
			const discovered: RepositoryDiscovery = {
				...snapshot.repository,
				sha: snapshot.sha,
				inventory: { packages: [], workflows: [], managers: [], diagnostics: [], publicationOrder: [] },
				presetShas: {},
				diagnostics: [],
				updatedAt: clock.currentTimeMillisUnsafe(),
			};
			const document = snapshot.files[configurationPath]
				?? (yield* this.sources.inferConfiguration(snapshot, discover(snapshot)).pipe(
					Effect.catch(error => logFailure('setup.inference-failed', error).pipe(Effect.as(undefined))),
				));
			if (document) {
				yield* Effect.gen({ self: this }, function*() {
					const raw = yield* fromSync((): unknown => JSON.parse(document));
					const resolved = yield* resolveConfiguration(raw, ref => this.sources.preset(ref));
					discovered.configuration = resolved.configuration;
					discovered.presetShas = resolved.presetShas;
				}).pipe(
					Effect.catch(error =>
						Effect.sync(() => {
							discovered.diagnostics.push(
								...(error instanceof Schema.SchemaError
									? configurationDiagnostics(error)
									: [configurationProblem(decodeError(error))]),
							);
						})
					),
				);
			} else {
				discovered.diagnostics.push({
					code: 'unconfigured',
					severity: 'blocking',
					message: (yield* this.sources.setupPullOpen(name, id))
						? 'The setup pull request is open. Merge it to enable releases.'
						: 'Not configured yet. Configure releases opens a setup pull request.',
				});
			}
			discovered.inventory = discover(snapshot, discovered.configuration?.managers);
			if (discovered.configuration) {
				discovered.diagnostics.push(...validateAgainst(discovered.configuration, discovered.inventory, snapshot));
			}
			discovered.inventory = yield* this.sources.resolvePublished(discovered.inventory, name, id);
			const { repository, document: saved } = yield* this.sources.store.saveDiscovery(discovered);
			yield* this.sources.refreshed(name, repository, saved, snapshot);
			return repository;
		}).pipe(
			Effect.withSpan('repository.refresh', { attributes: { repositoryId: id, repository: name } }),
			Effect.annotateLogs({ repositoryId: id, repository: name }),
		);
	}
}
