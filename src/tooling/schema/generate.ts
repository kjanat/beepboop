import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { attempt, attemptPromise, main } from '@/tooling/runtime';
import { assertCurrent, renderedConfigurationSchema, schemaPath } from '@/tooling/schema/render';

await main(Effect.gen(function*() {
	const { values: { check } } = yield* attempt(() =>
		parseArgs({ args: Bun.argv.slice(2), options: { check: { type: 'boolean' } }, strict: true })
	);
	if (check) return yield* assertCurrent(schemaPath);
	const schema = yield* renderedConfigurationSchema;
	yield* attemptPromise(() => Bun.write(schemaPath, schema));
}));
