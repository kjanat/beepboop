import {
	type Channel,
	type ChannelOutcome,
	channelKey,
	destinationsOf,
	isChannelOutcome,
	type ManagerDestinationId,
	managerDestinations,
	type RegistryOutcome,
} from '@/automation/destinations';
import { checkChannel, pkgbuildChannels } from '@/automation/managers/channels';
import { publicationOrder } from '@/automation/managers/order';
import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Inventory, ManagerName, Package, Publication, Snapshot } from '@/automation/types';
import { type PackageIdentity, packageIdentity } from '@/package-url';

export interface Manager {
	readonly name: ManagerName;
	discover(snapshot: Snapshot): Inventory;
	identity?(pkg: Package, snapshot: Snapshot): PackageIdentity;
	ownsVersionSource?(source: string): boolean;
	editVersion?(context: VersionEdit): string;
	updateDependencies?(context: DependencyEdit): void;
	verifyPublication?(publication: Publication, request: Fetcher, context?: VerificationContext): Promise<Publication>;
	latest?(pkg: Package, request: Fetcher, context?: VerificationContext): Promise<RegistryVersion>;
	secondaryLatest?: Partial<Record<ManagerDestinationId, RegistryLookup>>;
}
export type RegistryLookup = (
	pkg: Package,
	request: Fetcher,
	context?: VerificationContext,
) => Promise<RegistryVersion>;
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface VerificationContext {
	repository: string;
	github(path: string): Promise<unknown>;
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
export function emptyInventory(): Inventory {
	return { packages: [], workflows: [], managers: [], diagnostics: [], publicationOrder: [] };
}
export class ManagerRegistry {
	private readonly managers = new Map<ManagerName, Manager>();
	constructor(managers: Manager[]) {
		for (const manager of managers) {
			if (this.managers.has(manager.name)) throw new Error(`Duplicate manager: ${manager.name}`);
			this.managers.set(manager.name, manager);
		}
	}
	names(): ManagerName[] {
		return [...this.managers.keys()];
	}
	editVersion(context: VersionEdit): string {
		const managers = [...this.managers.values()].filter(manager => manager.ownsVersionSource?.(context.source));
		if (managers.length !== 1 || !managers[0]?.editVersion) {
			throw new Error(`Expected exactly one version editor for ${context.source}`);
		}
		return managers[0].editVersion(context);
	}
	updateDependencies(context: DependencyEdit): void {
		for (const manager of this.managers.values()) {
			const packages = context.packages.filter(pkg => pkg.manager === manager.name);
			if (packages.length) manager.updateDependencies?.({ ...context, packages });
		}
	}
	async verifyPublication(
		publication: Publication,
		request: Fetcher,
		context?: VerificationContext,
	): Promise<Publication> {
		const manager = this.managers.get(publication.manager);
		return manager?.verifyPublication
			? manager.verifyPublication(publication, request, context)
			: { ...publication, outcome: 'uncertain' };
	}
	async resolvePublished(inventory: Inventory, request: Fetcher, context?: VerificationContext): Promise<Inventory> {
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
		const diagnostics: string[] = [];
		const channels = async (list: Channel[], label: (channel: Channel) => string): Promise<ChannelOutcome[]> =>
			Promise.all(list.map(async channel => {
				const { outcome, failure } = await checkChannel(channel, request);
				if (failure) diagnostics.push(`${label(channel)}: ${failure}`);
				return outcome;
			}));
		const lookups = (pkg: Package): { destination: ManagerDestinationId; latest: RegistryLookup }[] => {
			const manager = this.managers.get(pkg.manager);
			const mapped = managerDestinations[pkg.manager];
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
		for (let offset = 0; offset < pending.length; offset += 8) {
			await Promise.all(
				pending.slice(offset, offset + 8).map(async pkg => {
					const primary = managerDestinations[pkg.manager]?.primary;
					const [results, checked] = await Promise.all([
						Promise.all(
							lookups(pkg).map(async ({ destination, latest }) => ({
								destination,
								result: await latest(pkg, request, context),
							})),
						),
						channels(pkg.channels ?? [], () => `${pkg.manager}:${pkg.name}`),
					]);
					pkg.destinations = [
						...(pkg.destinations ?? []).filter(outcome => !isChannelOutcome(outcome)),
						...checked,
					];
					for (const { destination, result } of results) {
						pkg.destinations = pkg.destinations?.map(outcome =>
							outcome.destination === destination ? registryOutcome(destination, result) : outcome
						);
						if (result.kind === 'failed') {
							diagnostics.push(`${pkg.manager}:${pkg.name}: ${result.reason} from ${result.url}`);
						}
						if (destination !== primary) continue;
						pkg.publicationStatus = result.kind;
						if (result.previousModule) pkg.previousModule = result.previousModule;
						if (result.kind === 'published') pkg.published = result.version;
					}
				}),
			);
		}
		const { destinations: _destinations, ...rest } = inventory;
		const repositoryChannels = inventory.channels ?? [];
		const destinations: ChannelOutcome[] = [];
		for (let offset = 0; offset < repositoryChannels.length; offset += 8) {
			destinations.push(...await channels(repositoryChannels.slice(offset, offset + 8), channel => channel.manifest));
		}
		return {
			...rest,
			...(destinations.length ? { destinations } : {}),
			packages,
			diagnostics: [...new Set([...inventory.diagnostics, ...diagnostics])],
		};
	}
	canVerify(name: ManagerName): boolean {
		return Boolean(this.managers.get(name)?.verifyPublication);
	}
	discover(snapshot: Snapshot, enabled = this.names()): Inventory {
		const result = emptyInventory();
		for (const name of new Set(enabled)) {
			const manager = this.managers.get(name);
			if (!manager) throw new Error(`Unknown manager: ${name}`);
			const inventory = manager.discover(snapshot);
			for (const pkg of inventory.packages) {
				const identity = pkg.identity ?? manager.identity?.(pkg, snapshot);
				if (!identity) throw new Error(`Manager ${name} did not identify package ${pkg.name}`);
				pkg.identity = packageIdentity(identity);
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
			if (identities.has(identity)) result.diagnostics.push(`Duplicate package identity: ${identity}`);
			identities.add(identity);
			pkg.dependencies = pkg.dependencies.filter(name =>
				result.packages.some(other => other.manager === pkg.manager && other.name === name)
			);
		}
		try {
			result.publicationOrder = publicationOrder(result.packages);
		} catch (error) {
			result.diagnostics.push(String(error));
		}
		result.managers = [...new Set(result.managers)].filter(name => enabled.includes(name)).sort();
		result.diagnostics = [...new Set(result.diagnostics)];
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
