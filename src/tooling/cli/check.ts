import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const directory = resolve(root, 'packages/cli');
const manifest = await Bun.file(`${directory}/package.json`).json();
const temporary = await mkdtemp(join(tmpdir(), 'beepboop-package-'));
async function run(args: string[], cwd: string): Promise<string> {
	const process = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
	const [stdout, stderr, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	assert.equal(code, 0, `${args.join(' ')} failed: ${stdout}\n${stderr}`);
	return stdout;
}
try {
	const tarball = join(temporary, 'cli.tgz');
	await run(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', tarball], directory);
	const second = join(temporary, 'second.tgz');
	await run(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', second], directory);
	assert.deepEqual(
		await Bun.file(tarball).arrayBuffer(),
		await Bun.file(second).arrayBuffer(),
		'Publish retry requires deterministic tarballs',
	);
	await Bun.write(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
	await run(['bun', 'add', '--ignore-scripts', tarball], temporary);
	const binary = join(temporary, 'node_modules/.bin/beepboop');
	assert.equal((await run([binary, '--version'], temporary)).trim(), manifest.version);
	assert.match(await run([binary, '--help'], temporary), /auth/);
	assert.match(await run([binary, 'releases', 'plan', '--help'], temporary), /releaseVersion/);
	assert.match(await run([binary, 'completions', 'bash'], temporary), /beepboop/);
	await run([
		'bun',
		'-e',
		"const {run} = await import('@kjanat/beepboop'); if(typeof run !== 'function') throw Error('missing run export')",
	], temporary);
	console.log(
		`Verified installed ${manifest.name}@${manifest.version}: executable, manifest, completions and module export`,
	);
} finally {
	await rm(temporary, { recursive: true, force: true });
}
