import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import { packageId } from '@/domain/package-identity.ts';
import { checkoutAt } from '@/host/git.ts';
import { writeOutput } from '@/host/github-output.ts';
import { sha256Hex } from '@/kernel/crypto/sha256.ts';
import { responseJson } from '@/kernel/http/body.ts';
import { looseSchema } from '@/kernel/schema/result.ts';
import { mutableArray, mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';
import { packageManifest } from '@/tooling/cli/manifest';
import { registry } from '@/tooling/cli/registry';
import {
	attempt,
	attemptPromise,
	main,
	parse,
	readJson,
	refuse,
	run,
	ToolFailure,
	temporaryDirectory,
} from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../..');
const directory = join(root, 'packages/cli');
const npmVersion = mutableStruct({ dist: Schema.optional(Schema.NullOr(mutableStruct({ integrity: looseSchema }))) });
const jsrPackage = mutableStruct({
	versions: Schema.optional(Schema.NullOr(mutableRecord(Schema.String, Schema.Unknown))),
});
const jsrVersion = mutableStruct({ yanked: looseSchema });
const jsrFiles = mutableStruct({ manifest: mutableRecord(Schema.String, mutableStruct({ checksum: Schema.String })) });

function output(name: string, value: string): Effect.Effect<void, ToolFailure> {
	return writeOutput(name, value).pipe(
		Effect.mapError(error => new ToolFailure({ message: error.message, cause: error })),
	);
}
function body(response: Response): Effect.Effect<unknown, ToolFailure> {
	return responseJson(response).pipe(
		Effect.mapError(({ cause }) =>
			new ToolFailure({ message: cause instanceof Error ? cause.message : String(cause), cause })
		),
	);
}
function checksum(path: string): Effect.Effect<string | undefined, ToolFailure> {
	return attemptPromise(async () => {
		const file = Bun.file(join(directory, path));
		if (!await file.exists()) return undefined;
		return `sha256-${sha256Hex(await file.bytes())}`;
	});
}

await main(Effect.gen(function*() {
	const npm = yield* parse(packageManifest, yield* readJson(join(directory, 'package.json')));
	const jsr = yield* parse(
		mutableStruct({
			...packageManifest.fields,
			...{ publish: mutableStruct({ include: mutableArray(Schema.String) }) },
		}),
		yield* readJson(join(directory, 'jsr.json')),
	);
	const context = yield* parse(
		mutableStruct({
			sourceSha: Schema.optional(Schema.String),
			operation: Schema.optional(Schema.String),
			stream: Schema.optional(Schema.String),
			version: Schema.optional(Schema.String),
		}),
		yield* attempt((): unknown => JSON.parse(process.env.RELEASE_CONTEXT ?? '{}')),
	);
	if (!checkoutAt(directory, context.sourceSha)) return yield* refuse('Checkout is not the planned release commit');
	if (
		context.operation !== 'promote' || context.stream !== 'cli' || context.version !== npm.version
		|| npm.version !== jsr.version || npm.name !== jsr.name
	) {
		return yield* refuse(
			'Publication requires a promote operation of the cli stream with matching npm and JSR versions',
		);
	}
	if (process.env.GITHUB_SHA !== context.sourceSha) {
		return yield* refuse(
			'Workflow commit differs from the planned source; refresh and publish the current commit before publishing provenance',
		);
	}
	const channel = npm.version.includes('-') ? 'next' : 'latest';
	switch (process.argv[2]) {
		case 'metadata':
			return yield* output('version', npm.version);
		case 'npm':
			return yield* Effect.scoped(Effect.gen(function*() {
				const temporary = yield* temporaryDirectory('beepboop-publish-');
				const tarball = join(temporary, 'cli.tgz');
				yield* run(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', tarball], { cwd: directory });
				const integrity = `sha512-${
					new Bun.CryptoHasher('sha512').update(
						yield* attemptPromise(() => Bun.file(tarball).arrayBuffer()),
					).digest('base64')
				}`;
				const response = yield* registry(
					`https://registry.npmjs.org/${encodeURIComponent(npm.name)}/${npm.version}`,
				);
				if (response.ok) {
					const published = (yield* parse(npmVersion, yield* body(response))).dist?.integrity;
					if (typeof published !== 'string') {
						return yield* refuse('npm returned no integrity for the published version');
					}
					if (published === integrity) {
						yield* output('integrity', published);
						console.log(`npm ${npm.name}@${npm.version} matches this build (${integrity}).`);
					} else {
						console.log(
							`::error::npm ${npm.name}@${npm.version} has integrity ${published}. This build has integrity ${integrity}.`,
						);
						process.exitCode = 1;
					}
					return;
				}
				yield* output('integrity', integrity);
				const userconfig = join(temporary, '.npmrc');
				const token = process.env.NPM_TOKEN;
				if (token) {
					yield* attemptPromise(() =>
						writeFile(userconfig, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 })
					);
				}
				// npm is used only for its supported provenance publication transport.
				yield* run(['bunx', 'npm@12.2.1', 'publish', tarball, '--access', 'public', '--provenance', '--tag', channel], {
					cwd: directory,
					env: { ...process.env, ...(token ? { NPM_CONFIG_USERCONFIG: userconfig } : {}) },
				});
			}));
		case 'jsr': {
			const metadata = yield* registry(`https://jsr.io/${jsr.name}/meta.json`);
			const published = metadata.ok
				? (yield* parse(jsrPackage, yield* body(metadata))).versions?.[jsr.version]
				: undefined;
			if (published === undefined) {
				return yield* run([
					'deno',
					'publish',
					'--unstable-bare-node-builtins',
					'--unstable-sloppy-imports',
					'--unstable-byonm',
					'--no-check',
					'--config',
					'packages/cli/jsr.json',
				], {
					cwd: root,
					env: { ...process.env, DENO_DISABLE_PEDANTIC_NODE_WARNINGS: 'true' },
				});
			}
			if ((yield* parse(jsrVersion, published)).yanked === true) {
				console.log(`::error::JSR ${jsr.name}@${jsr.version} is yanked. Release a new version.`);
				process.exitCode = 1;
				return;
			}
			const files = yield* registry(`https://jsr.io/${jsr.name}/${jsr.version}_meta.json`);
			if (!files.ok) return yield* refuse(`JSR returned no file list for ${jsr.name}@${jsr.version}`);
			const { manifest: remote } = yield* parse(jsrFiles, yield* body(files));
			const paths = new Set([...Object.keys(remote), ...jsr.publish.include.map(path => `/${path}`)]);
			const changed: string[] = [];
			for (const path of [...paths].sort()) {
				if (remote[path]?.checksum !== (yield* checksum(path))) changed.push(path);
			}
			if (changed.length) {
				console.log(`::error::JSR ${jsr.name}@${jsr.version} differs from this build in ${changed.join(', ')}.`);
				process.exitCode = 1;
			} else console.log(`JSR ${jsr.name}@${jsr.version} matches this build.`);
			return;
		}
		case 'report': {
			const publications = (['npm', 'jsr'] as const).map(manager => ({
				id: packageId({ manager, name: npm.name }),
				manager,
				name: npm.name,
				version: npm.version,
				required: true,
				outcome: process.env[`${manager.toUpperCase()}_OUTCOME`] === 'success'
					? 'succeeded'
					: process.env[`${manager.toUpperCase()}_OUTCOME`] !== 'failure' && process.env.JOB_STATUS === 'cancelled'
					? 'cancelled'
					: 'failed',
				...(manager === 'npm'
					? { channel, ...(process.env.NPM_INTEGRITY ? { digest: process.env.NPM_INTEGRITY } : {}) }
					: {}),
			}));
			return yield* output('publications', JSON.stringify(publications));
		}
		default:
			return yield* refuse('Expected metadata, npm, jsr or report');
	}
}));
