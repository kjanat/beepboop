import { Context, Effect, Layer } from 'effect';
import type { Publication } from '@/automation/types';
import type { Discoverer } from '@/discovery/managers/registry.ts';
import { DiscoveryRegistry, uniqueDiagnostics } from '@/discovery/managers/registry.ts';
import type { ManagerDestinationId, ManagerName } from '@/domain/catalog.ts';
import { destinationsOf, managerSpec } from '@/domain/catalog.ts';
import type { Channel, ChannelOutcome, RegistryOutcome } from '@/domain/destinations.ts';
import { isChannelOutcome } from '@/domain/destinations.ts';
import type { Inventory, Package } from '@/domain/inventory.ts';
import { packageId } from '@/domain/package-identity.ts';
import { publishable } from '@/domain/package-publication.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { ioConcurrency } from '@/kernel/http/retry.ts';
import { checkChannel } from '@/publication/registries/channels.ts';
import type { VerificationContext } from '@/publication/registries/context.ts';

export interface Manager extends Discoverer {
	verifyPublication?(
		publication: Publication,
		request: Fetcher,
		context?: VerificationContext,
	): Effect.Effect<Publication>;
	latest?(pkg: Package, request: Fetcher, context?: VerificationContext): Effect.Effect<RegistryVersion>;
	secondaryLatest?: Partial<Record<ManagerDestinationId, RegistryLookup>>;
	secondaryPublication?: Partial<Record<ManagerDestinationId, PublicationCheck>>;
}
export type PublicationCheck = (publication: Publication, request: Fetcher) => Effect.Effect<Publication>;
export type Adapter<M extends ManagerName> = Manager & { readonly name: M };
export type RegistryLookup = (
	pkg: Package,
	request: Fetcher,
	context?: VerificationContext,
) => Effect.Effect<RegistryVersion>;
export type RegistryVersion =
	& (
		| { kind: 'published'; version: string }
		| { kind: 'missing'; url: string }
		| { kind: 'failed'; url: string; reason: string }
	)
	& { previousModule?: { name: string; version: string } };
export type Adapters = { readonly [M in ManagerName]: Adapter<M> };
export class ManagerRegistry extends DiscoveryRegistry {
	private readonly managers: ReadonlyMap<ManagerName, Manager>;
	constructor(adapters: Adapters) {
		super(adapters);
		this.managers = new Map(Object.values(adapters).map(manager => [manager.name, manager]));
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
	verifySecondaryPublications(publication: Publication, request: Fetcher): Effect.Effect<Publication[]> {
		const checks = Object.values(this.managers.get(publication.manager)?.secondaryPublication ?? {})
			.filter(check => check !== undefined);
		return Effect.forEach(checks, check => check(publication, request), { concurrency: ioConcurrency });
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
				})), { concurrency: ioConcurrency });
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
					{ concurrency: ioConcurrency },
				),
				channels(pkg.channels ?? [], () => `${pkg.manager}:${pkg.name}`),
			], { concurrency: ioConcurrency }).pipe(Effect.flatMap(([results, checked]) =>
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
			yield* Effect.forEach(pending, resolve, { concurrency: ioConcurrency, discard: true });
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
				diagnostics: uniqueDiagnostics([...inventory.diagnostics, ...diagnostics]),
			};
		});
	}
	canVerify(name: ManagerName): boolean {
		return Boolean(this.managers.get(name)?.verifyPublication);
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
	return Layer.succeed(Registry, {
		fetch: (url, init) =>
			fromPromise(signal =>
				transport(url, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal })
			),
	});
}
