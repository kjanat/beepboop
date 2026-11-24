import { cli, command, flag } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { parse, readJson } from '@/host/files.ts';
import { releaseChecksums, writeRendered } from '@/host/rendered-file.ts';
import { stableVersion } from '@/publication/distribution/assets.ts';
import { generateCask, homebrewConfiguration } from '@/publication/distribution/homebrew.ts';

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
