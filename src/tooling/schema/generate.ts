import { Effect } from 'effect';
import { attemptPromise, checkArguments, main } from '@/tooling/runtime';
import {
	assertCurrent,
	assertTargetsCurrent,
	renderedConfigurationSchema,
	renderedTargetsSchema,
	schemaPath,
	targetsSchemaPath,
} from '@/tooling/schema/render';

await main(Effect.gen(function*() {
	const { values: { check } } = yield* checkArguments(false);
	if (check) {
		yield* assertCurrent(schemaPath);
		return yield* assertTargetsCurrent;
	}
	const schema = yield* renderedConfigurationSchema;
	yield* attemptPromise(() => Bun.write(schemaPath, schema));
	const targets = yield* renderedTargetsSchema;
	yield* attemptPromise(() => Bun.write(targetsSchemaPath, targets));
}));
