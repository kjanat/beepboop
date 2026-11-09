import { Effect } from 'effect';
import { z } from 'zod';
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
