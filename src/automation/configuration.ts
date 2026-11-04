import { parsePresetReference } from '@/automation/preset';
import type { Configuration } from '@/automation/types';
import { configurationSchema } from '@/domain/configuration';
import { array, record, text } from '@/model';

export function mergeConfiguration(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (['__proto__', 'constructor', 'prototype'].includes(key)) {
			throw new Error('Invalid configuration key');
		}
		const prior = result[key];
		result[key] = value
				&& typeof value === 'object'
				&& !Array.isArray(value)
				&& prior
				&& typeof prior === 'object'
				&& !Array.isArray(prior)
			? mergeConfiguration(record(prior), record(value))
			: value;
	}
	return result;
}
export type PresetLoader = (reference: string) => Promise<{ value: unknown; sha: string }>;
export async function resolveConfiguration(
	value: unknown,
	load: PresetLoader,
): Promise<{ configuration: Configuration; presetShas: Record<string, string> }> {
	const presetShas: Record<string, string> = {};
	const cache = new Map<string, { value: unknown; sha: string }>();
	async function visit(raw: unknown, stack: string[]): Promise<Record<string, unknown>> {
		if (stack.length > 16) throw new Error('Preset nesting limit exceeded');
		const data = record(raw);
		let resolved: Record<string, unknown> = {};
		for (const reference of array(data.extends ?? []).map(text)) {
			if (!parsePresetReference(reference)) {
				throw new Error('Invalid preset reference');
			}
			if (stack.includes(reference)) {
				throw new Error(`Preset cycle: ${[...stack, reference].join(' -> ')}`);
			}
			let loaded = cache.get(reference);
			if (!loaded) {
				loaded = await load(reference);
				cache.set(reference, loaded);
			}
			if (!/^[a-f0-9]{40}$/.test(loaded.sha)) throw new Error('Preset must resolve to a commit');
			presetShas[reference] = loaded.sha;
			resolved = mergeConfiguration(resolved, await visit(loaded.value, [...stack, reference]));
		}
		return mergeConfiguration(resolved, data);
	}
	return { configuration: configurationSchema.parse(await visit(value, [])), presetShas };
}
