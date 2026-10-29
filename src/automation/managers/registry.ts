import type { Inventory, ManagerName, Package, Publication, Snapshot } from '../types.ts';
import { publicationOrder } from './order.ts';

export interface Manager {
	readonly name: ManagerName;
	discover(snapshot: Snapshot): Inventory;
	ownsVersionSource?(source: string): boolean;
	editVersion?(context: VersionEdit): string;
	updateDependencies?(context: DependencyEdit): void;
	verifyPublication?(publication: Publication, request: Fetcher): Promise<Publication>;
}
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
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
	async verifyPublication(publication: Publication, request: Fetcher): Promise<Publication> {
		const manager = this.managers.get(publication.manager);
		return manager?.verifyPublication
			? manager.verifyPublication(publication, request)
			: { ...publication, outcome: 'uncertain' };
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
			result.packages.push(...inventory.packages);
			result.workflows.push(...inventory.workflows);
			result.managers.push(...inventory.managers);
			result.diagnostics.push(...inventory.diagnostics);
			if (inventory.references) {
				result.references ??= [];
				result.references.push(...inventory.references);
			}
		}
		const identities = new Set<string>();
		for (const pkg of result.packages) {
			const identity = `${pkg.manager}:${pkg.name}`;
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
