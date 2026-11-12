#!/usr/bin/env bun
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, command, flag } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { stableVersion } from '@/distribution/assets';
import { generateCask, homebrewConfiguration } from '@/distribution/homebrew/generate';
import { releaseChecksums, writeRendered } from '@/distribution/output';
import { parse, readJson } from '@/tooling/runtime';

export const generate = command('generate')
	.description('Write a Homebrew cask for a published release')
	.flag('config', flag.path({ type: 'file' }).env().required().describe('Cask metadata JSON file'))
	.flag(
		'version',
		flag.string({ pattern: stableVersion }).env().required().describe('Stable release version, MAJOR.MINOR.PATCH'),
	)
	.flag('tag', flag.string().env().describe('Release tag; defaults to v followed by the version'))
	.flag('checksums', flag.path({ type: 'file' }).env().required().describe('Release SHA-256 checksums file'))
	.flag(
		'out',
		flag.path({ type: 'directory', create: true }).env().required().describe('Directory for the generated cask'),
	)
	.action(({ flags, out }) =>
		Effect.runPromise(Effect.gen(function*() {
			const configuration = yield* parse(homebrewConfiguration, yield* readJson(flags.config));
			const checksums = yield* releaseChecksums(flags.checksums);
			yield* writeRendered(
				flags.out,
				generateCask({ configuration, version: flags.version, tag: flags.tag || undefined, checksums }).pipe(
					Effect.map(content => ({ name: `${configuration.token}.rb`, content })),
				),
				line => out.log(line),
			);
		}))
	);

export const app = cli('beepboop-homebrew')
	.envPrefix('HOMEBREW_CASK_')
	.help({ flagSpelling: 'kebab' })
	.description('Generate a Homebrew cask from cask metadata and release checksums')
	.default(generate, { route: true });

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await app.run();
