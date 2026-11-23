import { Effect, Result } from 'effect';
import { pkgbuildChannels } from '@/discovery/managers/pkgbuild.ts';
import type { ManagerName } from '@/domain/catalog.ts';
import { channelKey } from '@/domain/destinations.ts';
import type { Inventory, Package, Snapshot } from '@/domain/inventory.ts';
import { packageId } from '@/domain/package-identity.ts';
import { publicationOrder } from '@/domain/publication-order.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { PackageIdentity } from '@/package-url';
import { invalidPackageUrl, parsePackageIdentity } from '@/package-url';

export interface Discoverer {
	readonly name: ManagerName;
	discover(snapshot: Snapshot): Inventory;
	identity?(pkg: Package, snapshot: Snapshot): PackageIdentity;
	ownsVersionSource?(source: string): boolean;
	editVersion?(context: VersionEdit): Effect.Effect<string, DomainError>;
	updateDependencies?(context: DependencyEdit): Effect.Effect<void, DomainError>;
}
export type DiscovererOf<M extends ManagerName> = Discoverer & { readonly name: M };
export type Discoverers = { readonly [M in ManagerName]: DiscovererOf<M> };
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
export function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
	return [...new Map(diagnostics.map(entry => [entry.message, entry])).values()];
}
export function emptyInventory(): Inventory {
	return { packages: [], workflows: [], managers: [], diagnostics: [], publicationOrder: [] };
}
export class DiscoveryRegistry {
	private readonly discoverers: ReadonlyMap<ManagerName, Discoverer>;
	constructor(private readonly adapters: Discoverers) {
		this.discoverers = new Map(Object.values(adapters).map(discoverer => [discoverer.name, discoverer]));
	}
	names(): ManagerName[] {
		return [...this.discoverers.keys()];
	}
	editVersion(context: VersionEdit): Effect.Effect<string, DomainError> {
		const managers = [...this.discoverers.values()].filter(manager => manager.ownsVersionSource?.(context.source));
		const [manager] = managers;
		return managers.length === 1 && manager?.editVersion
			? manager.editVersion(context)
			: Effect.fail(precondition(`Expected exactly one version editor for ${context.source}`));
	}
	updateDependencies(context: DependencyEdit): Effect.Effect<void, DomainError> {
		return Effect.forEach(this.discoverers.values(), manager => {
			const packages = context.packages.filter(pkg => pkg.manager === manager.name);
			return packages.length && manager.updateDependencies
				? manager.updateDependencies({ ...context, packages })
				: Effect.void;
		}, { discard: true });
	}
	discover(snapshot: Snapshot, enabled = this.names()): Inventory {
		const result = emptyInventory();
		for (const name of new Set(enabled)) {
			const manager: Discoverer = this.adapters[name];
			const inventory = manager.discover(snapshot);
			for (const pkg of inventory.packages) {
				const identified = pkg.identity ?? manager.identity?.(pkg, snapshot);
				const identity = identified === undefined
					? Result.fail(invalidPackageUrl(`Manager ${name} did not identify package ${pkg.name}`))
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
		result.diagnostics = uniqueDiagnostics(result.diagnostics);
		return result;
	}
}
