import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { z } from 'zod';
import {
	attemptPromise,
	capture,
	main,
	parse,
	readJson,
	refuse,
	type ToolFailure,
	temporaryDirectory,
} from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../..');
const directory = resolve(root, 'packages/cli');

function expect(condition: boolean, message: string): Effect.Effect<void, ToolFailure> {
	return condition ? Effect.void : refuse(message);
}

await main(Effect.scoped(Effect.gen(function*() {
	const manifest = yield* parse(
		z.object({ name: z.string(), version: z.string() }),
		yield* readJson(`${directory}/package.json`),
	);
	const temporary = yield* temporaryDirectory('beepboop-package-');
	const tarball = join(temporary, 'cli.tgz');
	yield* capture(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', tarball], { cwd: directory });
	const second = join(temporary, 'second.tgz');
	yield* capture(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', second], { cwd: directory });
	const [first, repeated] = yield* attemptPromise(() =>
		Promise.all([Bun.file(tarball).bytes(), Bun.file(second).bytes()])
	);
	yield* expect(Buffer.from(first).equals(Buffer.from(repeated)), 'Publish retry requires deterministic tarballs');
	yield* attemptPromise(() =>
		Bun.write(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
	);
	yield* capture(['bun', 'add', '--ignore-scripts', tarball], { cwd: temporary });
	const binary = join(temporary, 'node_modules/.bin/beepboop');
	const version = (yield* capture([binary, '--version'], { cwd: temporary })).trim();
	yield* expect(version === manifest.version, `beepboop --version printed ${version}`);
	yield* expect(/auth/.test(yield* capture([binary, '--help'], { cwd: temporary })), 'Help omits auth');
	yield* expect(
		/releaseVersion/.test(yield* capture([binary, 'releases', 'plan', '--help'], { cwd: temporary })),
		'releases plan help omits releaseVersion',
	);
	yield* expect(
		/beepboop/.test(yield* capture([binary, 'completions', 'bash'], { cwd: temporary })),
		'Bash completions omit beepboop',
	);
	yield* capture([
		'bun',
		'-e',
		"const {run} = await import('@kjanat/beepboop'); if(typeof run !== 'function') throw Error('missing run export')",
	], { cwd: temporary });
	console.log(
		`Verified installed ${manifest.name}@${manifest.version}: executable, manifest, completions and module export`,
	);
})));
