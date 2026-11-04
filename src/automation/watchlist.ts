import { publishable } from '@/automation/package-publication';
import type { RepositoryRecord } from '@/automation/types';

export const watchedRegistries = ['npm', 'jsr'] as const;
export type WatchedRegistry = (typeof watchedRegistries)[number];
export interface WatchedPackage {
	registry: WatchedRegistry;
	name: string;
	publishers: string[];
	dependents: string[];
}

function watchedRegistry(value: string): WatchedRegistry | undefined {
	return watchedRegistries.find(registry => registry === value);
}

export function watchlist(repositories: RepositoryRecord[]): WatchedPackage[] {
	const packages = new Map<string, WatchedPackage>();
	const entry = (registry: WatchedRegistry, name: string): WatchedPackage => {
		const key = `${registry}:${name}`;
		const existing = packages.get(key);
		if (existing) return existing;
		const created: WatchedPackage = { registry, name, publishers: [], dependents: [] };
		packages.set(key, created);
		return created;
	};
	for (const repository of repositories) {
		if (repository.suspended) continue;
		for (const pkg of repository.inventory.packages) {
			const registry = watchedRegistry(pkg.manager);
			if (!registry || !publishable(pkg)) continue;
			const watched = entry(registry, pkg.name);
			if (!watched.publishers.includes(repository.name)) watched.publishers.push(repository.name);
		}
		for (const subscription of repository.configuration?.subscriptions ?? []) {
			if (subscription.event !== 'package.version.changed') continue;
			const separator = subscription.source.indexOf(':');
			const registry = watchedRegistry(subscription.source.slice(0, separator));
			const name = subscription.source.slice(separator + 1);
			if (!registry || separator < 1 || !name) continue;
			const watched = entry(registry, name);
			if (!watched.dependents.includes(repository.name)) watched.dependents.push(repository.name);
		}
	}
	return [...packages.values()].sort((a, b) => `${a.registry}:${a.name}`.localeCompare(`${b.registry}:${b.name}`));
}
