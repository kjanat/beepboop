import { Context, Effect, Layer, Result } from 'effect';
import {
	type Channel,
	type ChannelOutcome,
	channelKey,
	isChannelOutcome,
	type RegistryOutcome,
} from '@/automation/destinations';
import { checkChannel, pkgbuildChannels } from '@/automation/managers/channels';
import { publicationOrder } from '@/automation/managers/order';
import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Inventory, Package, Publication, Snapshot } from '@/automation/types';
import { destinationsOf, type ManagerDestinationId, type ManagerName, managerSpec } from '@/contract/catalog';
import { type Diagnostic, fileProblem } from '@/contract/diagnostics';
import { type DomainError, precondition } from '@/contract/errors';
import { fromPromise } from '@/failure';
import { InvalidPackageUrl, type PackageIdentity, parsePackageIdentity } from '@/package-url';

export interface Manager {
	readonly name: ManagerName;
	discover(snapshot: Snapshot): Inventory;
	identity?(pkg: Package, snapshot: Snapshot): PackageIdentity;
	ownsVersionSource?(source: string): boolean;
	editVersion?(context: VersionEdit): Effect.Effect<string, DomainError>;
	updateDependencies?(context: DependencyEdit): Effect.Effect<void, DomainError>;
	verifyPublication?(
		publication: Publication,
		request: Fetcher,
		context?: VerificationContext,
	): Effect.Effect<Publication>;
	latest?(pkg: Package, request: Fetcher, context?: VerificationContext): Effect.Effect<RegistryVersion>;
	secondaryLatest?: Partial<Record<ManagerDestinationId, RegistryLookup>>;
}
export type Adapter<M extends ManagerName> = Manager & { readonly name: M };
export type RegistryLookup = (
	pkg: Package,
	request: Fetcher,
	context?: VerificationContext,
) => Effect.Effect<RegistryVersion>;
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface VerificationContext {
	repository: string;
	github(path: string): Effect.Effect<unknown, DomainError>;
}
export type RegistryVersion =
	& (
		| { kind: 'published'; version: string }
		| { kind: 'missing'; url: string }
		| { kind: 'failed'; url: string; reason: string }
	)
	& { previousModule?: { name: string; version: string } };
export interface VersionEdit {
	source: string;
	before: string;
	version: string;
	packages: Package[];
}
export interface DependencyEdit {
	snapshot: Snapshot;
	packages: Package[];
	version: string;
	changed: Map<string, string>;
}
function unique(diagnostics: Diagnostic[]): Diagnostic[] {
	return [...new Map(diagnostics.map(entry => [entry.message, entry])).values()];
}
export function emptyInventory(): Inventory {
	return { packages: [], workflows: [], managers: [], diagnostics: [], publicationOrder: [] };
}
export type Adapters = { readonly [M in ManagerName]: Adapter<M> };
export class ManagerRegistry {
	private readonly managers: ReadonlyMap<ManagerName, Manager>;
	constructor(private readonly adapters: Adapters) {
		this.managers = new Map(Object.values(adapters).map(manager => [manager.name, manager]));
	}
	names(): ManagerName[] {
		return [...this.managers.keys()];
	}
	editVersion(context: VersionEdit): Effect.Effect<string, DomainError> {
		const managers = [...this.managers.values()].filter(manager => manager.ownsVersionSource?.(context.source));
		const [manager] = managers;
		return managers.length === 1 && manager?.editVersion
			? manager.editVersion(context)
			: Effect.fail(precondition(`Expected exactly one version editor for ${context.source}`));
	}
	updateDependencies(context: DependencyEdit): Effect.Effect<void, DomainError> {
		return Effect.forEach(this.managers.values(), manager => {
			const packages = context.packages.filter(pkg => pkg.manager === manager.name);
			return packages.length && manager.updateDependencies
				? manager.updateDependencies({ ...context, packages })
				: Effect.void;
		}, { discard: true });
	}
	verifyPublication(
		publication: Publication,
		request: Fetcher,
		context?: VerificationContext,
	): Effect.Effect<Publication> {
		const manager = this.managers.get(publication.manager);
		return manager?.verifyPublication
			? manager.verifyPublication(publication, request, context)
			: Effect.succeed({ ...publication, outcome: 'uncertain' });
	}
	resolvePublished(inventory: Inventory, request: Fetcher, context?: VerificationContext): Effect.Effect<Inventory> {
		const packages: Package[] = inventory.packages.map(pkg => {
			const { published: _published, previousModule: _previous, destinations: _destinations, ...rest } = pkg;
			return publishable(pkg)
				? {
					...rest,
					publicationStatus: 'unchecked',
					destinations: [
						...destinationsOf(pkg.manager).map(destination => unchecked({ destination })),
						...(pkg.channels ?? []).map(unchecked),
					],
				}
				: { ...rest, publicationStatus: 'unchecked' };
		});
		const diagnostics: Diagnostic[] = [];
		const channels = (list: Channel[], label: (channel: Channel) => string): Effect.Effect<ChannelOutcome[]> =>
			Effect.forEach(list, channel =>
				checkChannel(channel, request).pipe(Effect.map(({ outcome, failure }) => {
					if (failure) {
						diagnostics.push({ code: 'lookup-failed', severity: 'warning', message: `${label(channel)}: ${failure}` });
					}
					return outcome;
				})), { concurrency: 'unbounded' });
		const lookups = (pkg: Package): { destination: ManagerDestinationId; latest: RegistryLookup }[] => {
			const manager = this.managers.get(pkg.manager);
			const mapped = managerSpec(pkg.manager).destinations;
			if (!manager || !mapped || !publishable(pkg)) return [];
			const latest = manager.latest?.bind(manager);
			return [
				...(latest ? [{ destination: mapped.primary, latest }] : []),
				...mapped.secondary.flatMap(destination => {
					const latest = manager.secondaryLatest?.[destination];
					return latest ? [{ destination, latest }] : [];
				}),
			];
		};
		const pending = packages.filter(pkg => lookups(pkg).length || (publishable(pkg) && pkg.channels?.length));
		const resolve = (pkg: Package) =>
			Effect.all([
				Effect.forEach(
					lookups(pkg),
					({ destination, latest }) =>
						latest(pkg, request, context).pipe(Effect.map(result => ({ destination, result }))),
					{ concurrency: 'unbounded' },
				),
				channels(pkg.channels ?? [], () => `${pkg.manager}:${pkg.name}`),
			], { concurrency: 'unbounded' }).pipe(Effect.flatMap(([results, checked]) =>
				Effect.sync(() => {
					const primary = managerSpec(pkg.manager).destinations?.primary;
					pkg.destinations = [
						...(pkg.destinations ?? []).filter(outcome => !isChannelOutcome(outcome)),
						...checked,
					];
					for (const { destination, result } of results) {
						pkg.destinations = pkg.destinations?.map(outcome =>
							outcome.destination === destination ? registryOutcome(destination, result) : outcome
						);
						if (result.kind === 'failed') {
							diagnostics.push({
								code: 'lookup-failed',
								severity: 'warning',
								subject: { kind: 'package', key: packageId(pkg) },
								message: `${pkg.manager}:${pkg.name}: ${result.reason} from ${result.url}`,
							});
						}
						if (destination !== primary) continue;
						pkg.publicationStatus = result.kind;
						if (result.previousModule) pkg.previousModule = result.previousModule;
						if (result.kind === 'published') pkg.published = result.version;
					}
				})
			));
		return Effect.gen(function*() {
			yield* Effect.forEach(pending, resolve, { concurrency: 8, discard: true });
			const { destinations: _destinations, ...rest } = inventory;
			const repositoryChannels = inventory.channels ?? [];
			const destinations: ChannelOutcome[] = [];
			for (let offset = 0; offset < repositoryChannels.length; offset += 8) {
				destinations.push(
					...yield* channels(repositoryChannels.slice(offset, offset + 8), channel => channel.manifest),
				);
			}
			return {
				...rest,
				...(destinations.length ? { destinations } : {}),
				packages,
				diagnostics: unique([...inventory.diagnostics, ...diagnostics]),
			};
		});
	}
	canVerify(name: ManagerName): boolean {
		return Boolean(this.managers.get(name)?.verifyPublication);
	}
	discover(snapshot: Snapshot, enabled = this.names()): Inventory {
		const result = emptyInventory();
		for (const name of new Set(enabled)) {
			const manager: Manager = this.adapters[name];
			const inventory = manager.discover(snapshot);
			for (const pkg of inventory.packages) {
				const identified = pkg.identity ?? manager.identity?.(pkg, snapshot);
				const identity = identified === undefined
					? Result.fail(new InvalidPackageUrl({ message: `Manager ${name} did not identify package ${pkg.name}` }))
					: parsePackageIdentity(identified);
				if (Result.isFailure(identity)) {
					result.diagnostics.push(fileProblem(pkg.manifest, 'invalid-manifest', identity.failure.message));
					continue;
				}
				pkg.identity = identity.success;
				result.packages.push(pkg);
			}
			result.workflows.push(...inventory.workflows);
			result.managers.push(...inventory.managers);
			result.diagnostics.push(...inventory.diagnostics);
			if (inventory.references) {
				result.references ??= [];
				result.references.push(...inventory.references);
			}
		}
		const pkgbuilds = pkgbuildChannels(snapshot);
		const claimed = new Set(result.packages.flatMap(pkg => pkg.channels ?? []).map(channelKey));
		const channels = pkgbuilds.channels.filter(channel => !claimed.has(channelKey(channel)));
		if (channels.length) result.channels = channels;
		result.diagnostics.push(...pkgbuilds.diagnostics);
		const identities = new Set<string>();
		for (const pkg of result.packages) {
			const identity = packageId(pkg);
			if (identities.has(identity)) {
				result.diagnostics.push({
					code: 'duplicate-identity',
					severity: 'blocking',
					subject: { kind: 'package', key: identity },
					message: `Duplicate package identity: ${identity}`,
				});
			}
			identities.add(identity);
			pkg.dependencies = pkg.dependencies.filter(name =>
				result.packages.some(other => other.manager === pkg.manager && other.name === name)
			);
		}
		const ordering = publicationOrder(result.packages);
		if (ordering.kind === 'ordered') result.publicationOrder = ordering.order;
		else result.diagnostics.push({ code: 'cycle', severity: 'blocking', message: `Error: ${ordering.message}` });
		result.managers = [...new Set(result.managers)].filter(name => enabled.includes(name)).sort();
		result.diagnostics = unique(result.diagnostics);
		return result;
	}
}
function unchecked<T extends object>(target: T): T & { state: 'unchecked' } {
	return { ...target, state: 'unchecked' };
}
function registryOutcome(destination: ManagerDestinationId, result: RegistryVersion): RegistryOutcome {
	if (result.kind === 'published') return { destination, state: 'published', version: result.version };
	if (result.kind === 'failed') return { destination, state: 'failed', reason: result.reason };
	return { destination, state: 'missing' };
}

export class Registry extends Context.Service<Registry, {
	readonly fetch: (url: string, init?: RequestInit) => Effect.Effect<Response, DomainError>;
}>()('beepboop/Registry') {}

export function registryLayer(transport: Fetcher): Layer.Layer<Registry> {
	return Layer.succeed(Registry, { fetch: (url, init) => fromPromise(() => transport(url, init ?? {})) });
}
