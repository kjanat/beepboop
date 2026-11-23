import { cli, command, flag } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { parse, readJson } from '@/host/files.ts';
import { releaseChecksums, writeRendered } from '@/host/rendered-file.ts';
import { stableVersion } from '@/publication/distribution/assets.ts';
import { generateManifest, scoopConfiguration } from '@/publication/distribution/scoop.ts';

export const generate = command('generate')
	.description('Write a Scoop manifest for a published release')
	.flag('config', flag.path({ type: 'file' }).env().required().describe('Manifest metadata JSON file'))
	.flag(
		'version',
		flag.string({ pattern: stableVersion }).env().required().describe('Stable release version, MAJOR.MINOR.PATCH'),
	)
	.flag('tag', flag.string().env().describe('Release tag; defaults to v followed by the version'))
	.flag('checksums', flag.path({ type: 'file' }).env().required().describe('Release SHA-256 checksums file'))
	.flag(
		'out',
		flag.path({ type: 'directory', create: true }).env().required().describe('Directory for the generated manifest'),
	)
	.action(({ flags, out }) =>
		Effect.runPromise(Effect.gen(function*() {
			const configuration = yield* parse(scoopConfiguration, yield* readJson(flags.config));
			const checksums = yield* releaseChecksums(flags.checksums);
			yield* writeRendered(
				flags.out,
				generateManifest({ configuration, version: flags.version, tag: flags.tag || undefined, checksums }).pipe(
					Effect.map(content => ({ name: `${configuration.name}.json`, content })),
				),
				line => out.log(line),
			);
		}))
	);

export const app = cli('beepboop-scoop')
	.envPrefix('SCOOP_MANIFEST_')
	.help({ flagSpelling: 'kebab' })
	.description('Generate a Scoop manifest from manifest metadata and release checksums')
	.default(generate, { route: true });
