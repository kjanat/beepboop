import { cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { git as runGit } from '@/git';
import source from '@/package-url/source.json';
import { definitionFiles } from '@/tooling/purl/definition-files';
import { attempt, attemptPromise, main, refuse, run, temporaryDirectory } from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../package-url');

function git(args: string[], cwd?: string) {
	return attempt(() => runGit(args, { stderr: 'inherit', ...(cwd === undefined ? {} : { cwd }) })).pipe(
		Effect.flatMap(result =>
			result.ok ? Effect.succeed(result.stdout) : refuse(`git ${args.join(' ')} failed: ${result.stdout}`.trim())
		),
	);
}

const clone = Effect.gen(function*() {
	const checkout = join(yield* temporaryDirectory('beepboop-purl-'), 'spec');
	yield* git(['clone', '--filter=blob:none', '--no-checkout', source.repository, checkout]);
	yield* git(['checkout', '--detach', source.revision], checkout);
	return checkout;
});

await main(Effect.scoped(Effect.gen(function*() {
	const { values } = yield* attempt(() =>
		parseArgs({ args: Bun.argv.slice(2), options: { source: { type: 'string' } }, strict: true })
	);
	const checkout = values.source ? resolve(values.source) : yield* clone;
	const revision = yield* git(['rev-parse', 'HEAD'], checkout);
	if (revision !== source.revision) {
		return yield* refuse(`Expected pinned revision ${source.revision}, got ${revision}`);
	}
	const files = yield* definitionFiles(join(checkout, 'types'));
	for (const filename of files) {
		yield* attemptPromise(() => cp(join(checkout, 'types', filename), join(root, 'definitions', filename)));
	}
	for (const filename of yield* definitionFiles(join(root, 'definitions'))) {
		if (!files.includes(filename)) yield* attemptPromise(() => rm(join(root, 'definitions', filename)));
	}
	yield* attemptPromise(() =>
		cp(join(checkout, 'schemas/purl-type-definition.schema-1.1.json'), join(root, 'type-definition.schema.json'))
	);
	yield* attemptPromise(() => cp(join(checkout, 'LICENSE'), join(root, 'LICENSE')));
	yield* run(['bunx', 'kfmt', join(root, 'definitions'), join(root, 'type-definition.schema.json')]).pipe(
		Effect.catch(() => refuse('Could not format upstream data')),
	);
	console.log(`Fetched ${files.length} PURL definitions at ${revision}`);
})));
