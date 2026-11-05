#!/usr/bin/env bun
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, command, flag } from '@kjanat/dreamcli';
import { Effect, Result } from 'effect';
import { generateManifests, renderManifests, wingetConfiguration } from '@/distribution/winget/generate';
import { outputEntry } from '@/tooling/github-output';
import { attemptPromise, parse, readJson, ToolFailure } from '@/tooling/runtime';

export const generate = command('generate')
	.description('Write WinGet version, installer, and locale manifests for a published release')
	.flag('config', flag.path({ type: 'file' }).env().required().describe('Package metadata JSON file'))
	.flag(
		'version',
		flag.string({ pattern: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/ }).env().required().describe(
			'Stable release version, MAJOR.MINOR.PATCH',
		),
	)
	.flag('tag', flag.string().env().describe('Release tag; defaults to v followed by the version'))
	.flag(
		'checksums',
		flag.path({ type: 'file' }).env().required().describe('Release SHA-256 checksums file'),
	)
	.flag(
		'releaseNotes',
		flag.path({ type: 'file' }).env().required().describe('Release notes Markdown file'),
	)
	.flag(
		'releaseDate',
		flag.date().env().required().describe('Release date in YYYY-MM-DD format (UTC)'),
	)
	.flag(
		'out',
		flag.path({ type: 'directory', create: true }).env().required().describe(
			'Directory for the three generated manifests',
		),
	)
	.action(({ flags, out }) =>
		Effect.runPromise(Effect.gen(function*() {
			const configuration = yield* parse(wingetConfiguration, yield* readJson(flags.config));
			const checksums = yield* attemptPromise(() => readFile(flags.checksums, 'utf8'));
			const releaseNotes = yield* attemptPromise(() => readFile(flags.releaseNotes, 'utf8'));
			const manifests = yield* generateManifests({
				configuration,
				version: flags.version,
				tag: flags.tag || undefined,
				releaseDate: flags.releaseDate.toISOString().slice(0, 10),
				checksums,
				releaseNotes,
			}).pipe(Effect.mapError(error => new ToolFailure({ message: error.detail ?? error.message, cause: error })));
			const directory = resolve(flags.out);
			const files: string[] = [];
			for (const [name, content] of Object.entries(renderManifests(manifests))) {
				const path = join(directory, name);
				yield* attemptPromise(() => writeFile(path, content, { flag: 'wx' }));
				files.push(path);
				out.log(path);
			}
			const output = yield* Effect.fromResult(
				Result.all([outputEntry('directory', directory), outputEntry('files', JSON.stringify(files))]),
			).pipe(
				Effect.map(entries => entries.join('')),
				Effect.mapError(error => new ToolFailure({ message: error.message, cause: error })),
			);
			const target = process.env.GITHUB_OUTPUT;
			if (target) yield* attemptPromise(() => appendFile(target, output));
			else process.stderr.write(output);
		}))
	);

export const app = cli('beepboop-winget')
	.envPrefix('WINGET_')
	.help({ flagSpelling: 'kebab' })
	.description('Generate WinGet manifests from package metadata and release assets')
	.default(generate, { route: true });

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await app.run();
