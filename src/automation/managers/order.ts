import type { Package } from '../types.ts';
export function publicationOrder(packages: Package[]): string[] {
	const byName = new Map(packages.map((p) => [`${p.manager}:${p.name}`, p]));
	const visiting = new Set<string>(),
		visited = new Set<string>(),
		order: string[] = [];
	function visit(key: string): void {
		if (visited.has(key)) return;
		if (visiting.has(key)) throw new Error(`Publication dependency cycle at ${key}`);
		const pkg = byName.get(key);
		if (!pkg) return;
		visiting.add(key);
		for (const name of [...pkg.dependencies].sort()) visit(`${pkg.manager}:${name}`);
		visiting.delete(key);
		visited.add(key);
		if (pkg.publish) order.push(key);
	}
	for (const key of [...byName.keys()].sort()) visit(key);
	return order;
}
