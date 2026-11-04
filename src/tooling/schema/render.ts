import { z } from 'zod';
import { configurationSchema } from '@/domain/configuration';

export const schemaPath = new URL('../../../schemas/v1.json', import.meta.url).pathname;

export async function renderConfigurationSchema(): Promise<string> {
	const { $schema, ...rest } = z.toJSONSchema(configurationSchema, { io: 'input', target: 'draft-2020-12' });
	const source = `${
		JSON.stringify({ $schema, $id: 'https://beepboop.kjanat.dev/schema/v1.json', ...rest }, null, '\t')
	}\n`;
	const formatter = Bun.spawn(['bunx', 'kfmt', '--stdin', schemaPath], {
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'inherit',
	});
	formatter.stdin.write(source);
	formatter.stdin.end();
	const output = await new Response(formatter.stdout).text();
	if (await formatter.exited !== 0) throw new Error('Cannot format the generated configuration schema');
	return output;
}

export async function assertCurrent(path: string): Promise<void> {
	const file = Bun.file(path);
	if (!await file.exists() || await file.text() !== await renderConfigurationSchema()) {
		throw new Error(`The configuration schema is stale; run schema:generate: ${path}`);
	}
}
