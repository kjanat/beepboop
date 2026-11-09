import { Effect } from 'effect';
import { attemptPromise, checkArguments, main } from '@/tooling/runtime';
import { assertCurrent, renderedConfigurationSchema, schemaPath } from '@/tooling/schema/render';

await main(Effect.gen(function*() {
	const { values: { check } } = yield* checkArguments(false);
	if (check) return yield* assertCurrent(schemaPath);
	const schema = yield* renderedConfigurationSchema;
	yield* attemptPromise(() => Bun.write(schemaPath, schema));
}));
