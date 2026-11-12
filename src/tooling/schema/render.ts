import { Effect } from 'effect';
import { z } from 'zod';
import { targetsSchema } from '@/contract/targets';
import { configurationSchema } from '@/domain/configuration';
import type { ToolFailure } from '@/tooling/runtime';
import { attempt, format, readText, refuse } from '@/tooling/runtime';

export const schemaPath = new URL('../../../schemas/v1.json', import.meta.url).pathname;

export const renderedConfigurationSchema: Effect.Effect<string, ToolFailure> = Effect.gen(function*() {
	const { $schema, ...rest } = yield* attempt(() =>
		z.toJSONSchema(configurationSchema, { io: 'input', target: 'draft-2020-12' })
	);
	const source = `${
		JSON.stringify({ $schema, $id: 'https://beepboop.kjanat.dev/schema/v1.json', ...rest }, null, '\t')
	}\n`;
	return yield* format(schemaPath, source).pipe(
		Effect.catch(() => refuse('Cannot format the generated configuration schema')),
	);
});

export function assertCurrent(path: string): Effect.Effect<void, ToolFailure> {
	return Effect.gen(function*() {
		const current = yield* readText(path);
		if (current === undefined || current !== (yield* renderedConfigurationSchema)) {
			return yield* refuse(`The configuration schema is stale; run schema:generate: ${path}`);
		}
	});
}

export const targetsSchemaPath = new URL('../../../schemas/targets.v1.json', import.meta.url).pathname;
export const renderedTargetsSchema: Effect.Effect<string, ToolFailure> = Effect.gen(function*() {
	const { $schema, ...rest } = yield* attempt(() =>
		z.toJSONSchema(targetsSchema, { io: 'input', target: 'draft-2020-12' })
	);
	return yield* format(
		targetsSchemaPath,
		`${JSON.stringify({ $schema, $id: 'https://beepboop.kjanat.dev/schema/targets.v1.json', ...rest }, null, '\t')}\n`,
	);
});
export const assertTargetsCurrent: Effect.Effect<void, ToolFailure> = Effect.gen(function*() {
	if ((yield* readText(targetsSchemaPath)) !== (yield* renderedTargetsSchema)) {
		return yield* refuse('The targets schema is stale; run schema:generate');
	}
});
