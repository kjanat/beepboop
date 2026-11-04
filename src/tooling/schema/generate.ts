import { parseArgs } from 'node:util';
import { assertCurrent, renderConfigurationSchema, schemaPath } from '@/tooling/schema/render';

const { values: { check } } = parseArgs({
	args: Bun.argv.slice(2),
	options: { check: { type: 'boolean' } },
	strict: true,
});
if (check) await assertCurrent(schemaPath);
else await Bun.write(schemaPath, await renderConfigurationSchema());
