import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Package } from '@/automation/types';
export function publicationOrder(packages: Package[]): string[] {
	const byName = new Map(packages.map((p) => [packageId(p), p]));
	const visiting = new Set<string>(),
		visited = new Set<string>(),
		order: string[] = [];
	function visit(key: string): void {
		if (visited.has(key)) return;
		if (visiting.has(key)) throw new Error(`Publication dependency cycle at ${key}`);
		const pkg = byName.get(key);
		if (!pkg) return;
		visiting.add(key);
		for (const name of [...pkg.dependencies].sort()) {
			const dependency = packages.find(candidate => candidate.manager === pkg.manager && candidate.name === name);
			if (dependency) visit(packageId(dependency));
		}
		visiting.delete(key);
		visited.add(key);
		if (publishable(pkg)) order.push(key);
	}
	for (const key of [...byName.keys()].sort()) visit(key);
	return order;
}
