import { Result } from 'effect';

export function dependencyOrder<K, E>(
	roots: Iterable<K>,
	dependencies: (node: K, dependent: K | undefined) => Result.Result<readonly K[] | undefined, E>,
	cycle: (node: K) => Result.Result<void, E>,
): Result.Result<K[], E> {
	const done = new Set<K>(), visiting = new Set<K>(), order: K[] = [];
	const visit = (node: K, dependent: K | undefined): Result.Result<void, E> =>
		Result.gen(function*() {
			if (done.has(node)) return;
			if (visiting.has(node)) return yield* cycle(node);
			const needs = yield* dependencies(node, dependent);
			if (needs === undefined) return;
			visiting.add(node);
			for (const need of needs) yield* visit(need, node);
			visiting.delete(node);
			done.add(node);
			order.push(node);
		});
	return Result.gen(function*() {
		for (const root of roots) yield* visit(root, undefined);
		return order;
	});
}
