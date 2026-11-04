import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import source from '@/package-url/source.json';

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { source: { type: 'string' } }, strict: true });
const temporary = values.source ? undefined : await mkdtemp(join(tmpdir(), 'beepboop-purl-'));
const checkout = resolve(values.source ?? join(temporary ?? '', 'spec'));
const root = resolve(import.meta.dir, '../../package-url');
async function git(args: string[], cwd?: string): Promise<string> {
	const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'inherit' });
	const output = await new Response(child.stdout).text();
	if (await child.exited !== 0) throw new Error(`git ${args[0]} failed`);
	return output.trim();
}
try {
	if (temporary) {
		await git(['clone', '--filter=blob:none', '--no-checkout', source.repository, checkout]);
		await git(['checkout', '--detach', source.revision], checkout);
	}
	const revision = await git(['rev-parse', 'HEAD'], checkout);
	if (revision !== source.revision) throw new Error(`Expected pinned revision ${source.revision}, got ${revision}`);
	const files = (await readdir(join(checkout, 'types'))).filter(name => name.endsWith('-definition.json')).sort();
	for (const filename of files) await cp(join(checkout, 'types', filename), join(root, 'definitions', filename));
	for (const filename of await readdir(join(root, 'definitions'))) {
		if (filename.endsWith('-definition.json') && !files.includes(filename)) {
			await rm(join(root, 'definitions', filename));
		}
	}
	await cp(join(checkout, 'schemas/purl-type-definition.schema-1.1.json'), join(root, 'type-definition.schema.json'));
	await cp(join(checkout, 'LICENSE'), join(root, 'LICENSE'));
	const format = Bun.spawn([
		'bunx',
		'kfmt',
		join(root, 'definitions'),
		join(root, 'type-definition.schema.json'),
	], { stdout: 'inherit', stderr: 'inherit' });
	if (await format.exited !== 0) throw new Error('Could not format upstream data');
	console.log(`Fetched ${files.length} PURL definitions at ${revision}`);
} finally {
	if (temporary) await rm(temporary, { recursive: true, force: true });
}
