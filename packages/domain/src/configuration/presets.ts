import type { Schema } from 'effect';
import { Effect, Result } from 'effect';
import { legacyConfiguration } from '@/domain/configuration/names.ts';
import type { Configuration } from '@/domain/configuration/schema.ts';
import { configurationSchema } from '@/domain/configuration/schema.ts';
import { parsePresetReference } from '@/domain/preset.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';
import { invalid, record, strings } from '@/kernel/schema/result.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';

type Invalid = DomainError | Schema.SchemaError;

export function parseRepositoryConfiguration(value: unknown): Result.Result<Configuration, Schema.SchemaError> {
	const decoded = safeDecode(configurationSchema, value);
	return decoded.success ? Result.succeed(decoded.data) : Result.fail(decoded.error);
}
export function mergeConfiguration(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Result.Result<Record<string, unknown>, DomainError> {
	return Result.gen(function*() {
		const result = { ...base };
		if (typeof base.file === 'string' && typeof override.file === 'string' && base.file !== override.file) {
			// Generated phase inputs belong to the old shared workflow, including when inherited from a preset.
			// Keep other inherited inputs and allow an explicitly supplied phase input to override this cleanup.
			const inputs = record(base.inputs);
			if (Result.isSuccess(inputs) && Object.hasOwn(inputs.success, 'beepboop_operation')) {
				const { beepboop_operation: _phase, ...userInputs } = inputs.success;
				result.inputs = userInputs;
			}
		}
		for (const [key, value] of Object.entries(override)) {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) {
				return yield* invalid('Invalid configuration key');
			}
			const prior = result[key];
			result[key] = value
					&& typeof value === 'object'
					&& !Array.isArray(value)
					&& prior
					&& typeof prior === 'object'
					&& !Array.isArray(prior)
				? yield* mergeConfiguration(
					Object.fromEntries(Object.entries(prior)),
					Object.fromEntries(Object.entries(value)),
				)
				: value;
		}
		return result;
	});
}
export type PresetLoader = (reference: string) => Effect.Effect<{ value: unknown; sha: string }, DomainError>;
export interface ResolvedConfiguration {
	configuration: Configuration;
	presetShas: Record<string, string>;
}
export function resolveConfiguration(
	value: unknown,
	load: PresetLoader,
): Effect.Effect<ResolvedConfiguration, Invalid> {
	const presetShas: Record<string, string> = {};
	const cache = new Map<string, { value: unknown; sha: string }>();
	const visit = (raw: unknown, stack: string[]): Effect.Effect<Record<string, unknown>, DomainError> =>
		Effect.gen(function*() {
			if (stack.length > 16) return yield* precondition('Preset nesting limit exceeded');
			const data = yield* Effect.fromResult(record(legacyConfiguration(raw)));
			let resolved: Record<string, unknown> = {};
			for (const reference of yield* Effect.fromResult(strings(data.extends ?? []))) {
				if (!parsePresetReference(reference)) return yield* precondition('Invalid preset reference');
				if (stack.includes(reference)) {
					return yield* precondition(`Preset cycle: ${[...stack, reference].join(' -> ')}`);
				}
				const loaded = cache.get(reference) ?? (yield* load(reference));
				cache.set(reference, loaded);
				if (!shaPattern.test(loaded.sha)) return yield* precondition('Preset must resolve to a commit');
				presetShas[reference] = loaded.sha;
				const nested = yield* visit(loaded.value, [...stack, reference]);
				resolved = yield* Effect.fromResult(mergeConfiguration(resolved, nested));
			}
			return yield* Effect.fromResult(mergeConfiguration(resolved, data));
		});
	return Effect.gen(function*() {
		const merged = yield* visit(value, []);
		const configuration = yield* Effect.fromResult(parseRepositoryConfiguration(merged));
		return { configuration, presetShas };
	});
}
