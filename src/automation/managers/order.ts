import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Package } from '@/automation/types';

export type PublicationOrder = { kind: 'ordered'; order: string[] } | { kind: 'cycle'; message: string };

export function publicationOrder(packages: Package[]): PublicationOrder {
	const byName = new Map(packages.map((p) => [packageId(p), p]));
	const visiting = new Set<string>(),
		visited = new Set<string>(),
		order: string[] = [];
	function visit(key: string): string | undefined {
		if (visited.has(key)) return undefined;
		if (visiting.has(key)) return key;
		const pkg = byName.get(key);
		if (!pkg) return undefined;
		visiting.add(key);
		for (const name of [...pkg.dependencies].sort()) {
			const dependency = packages.find(candidate => candidate.manager === pkg.manager && candidate.name === name);
			const cycle = dependency ? visit(packageId(dependency)) : undefined;
			if (cycle !== undefined) return cycle;
		}
		visiting.delete(key);
		visited.add(key);
		if (publishable(pkg)) order.push(key);
		return undefined;
	}
	for (const key of [...byName.keys()].sort()) {
		const cycle = visit(key);
		if (cycle !== undefined) return { kind: 'cycle', message: `Publication dependency cycle at ${cycle}` };
	}
	return { kind: 'ordered', order };
}
