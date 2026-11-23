import { Result } from 'effect';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { disabled, expandStep } from '@/discovery/release-graph/bindings.ts';
import { localAction } from '@/discovery/release-graph/calls.ts';
import type { Snapshot } from '@/domain/inventory.ts';
import { yaml } from '@/kernel/parse/yaml.ts';

export function references(source: unknown, context: 'secrets' | 'vars'): string[] {
	const text = JSON.stringify(source) ?? '';
	return [
		...new Set(
			[...text.matchAll(new RegExp(`\\b${context}(?:\\.([A-Za-z_][\\w]*)|\\[['"]([A-Za-z_][\\w]*)['"]\\])`, 'g'))].map(
				match => match[1] ?? match[2] ?? '',
			),
		),
	];
}

export function usedActions(snapshot: Snapshot, steps: unknown, seen = new Set<string>()): string[] {
	if (!Array.isArray(steps)) return [];
	return steps.flatMap(entry => expandStep(object(entry), {}, {})).flatMap(step => {
		if (disabled(step.if) || typeof step.uses !== 'string') return [];
		const local = localAction(step.uses);
		if (!local || seen.has(local)) return [step.uses];
		const source = snapshot.files[`${local}/action.yml`] ?? snapshot.files[`${local}/action.yaml`];
		const parsed = source === undefined ? undefined : yaml(source);
		return [
			step.uses,
			...(parsed && Result.isSuccess(parsed)
				? usedActions(snapshot, object(parsed.success.runs).steps, new Set([...seen, local]))
				: []),
		];
	});
}
