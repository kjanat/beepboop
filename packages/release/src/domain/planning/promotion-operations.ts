import type { Stream } from '@/domain/configuration/schema.ts';

/** Operations owned by a single promotion, including prerequisites shared by its downstream workflows. */
export function promotionOperations(stream: Stream): string[] {
	const bindings = new Map(
		Object.entries(stream.workflows).filter(([, binding]) =>
			binding.mode !== 'observe' && binding.each !== 'package' && !binding.backfill
		),
	);
	const dependents = new Map<string, string[]>();
	for (const [name, binding] of bindings) {
		for (const dependency of binding.needs ?? []) {
			const siblings = dependents.get(dependency);
			if (siblings) siblings.push(name);
			else dependents.set(dependency, [name]);
		}
	}
	const downstream = new Set(['promote']);
	for (const name of downstream) {
		for (const dependent of dependents.get(name) ?? []) downstream.add(dependent);
	}

	const planned = new Set<string>();
	function include(name: string) {
		const binding = bindings.get(name);
		if (!binding || planned.has(name)) return;
		for (const dependency of binding.needs ?? []) include(dependency);
		planned.add(name);
	}
	for (const name of downstream) include(name);
	return [...planned];
}
