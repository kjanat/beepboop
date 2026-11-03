#!/usr/bin/env bun
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, command, flag } from '@kjanat/dreamcli';
import { generateManifests, renderManifests } from '@/distribution/winget/generate';

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
	.action(async ({ flags, out }) => {
		const manifests = generateManifests({
			configuration: JSON.parse(await readFile(flags.config, 'utf8')),
			version: flags.version,
			tag: flags.tag || undefined,
			releaseDate: flags.releaseDate.toISOString().slice(0, 10),
			checksums: await readFile(flags.checksums, 'utf8'),
			releaseNotes: await readFile(flags.releaseNotes, 'utf8'),
		});
		const directory = resolve(flags.out);
		const files: string[] = [];
		for (const [name, content] of Object.entries(renderManifests(manifests))) {
			const path = join(directory, name);
			await writeFile(path, content, { flag: 'wx' });
			files.push(path);
			out.log(path);
		}
		const delimiter = `output_${crypto.randomUUID()}`;
		const output = `directory<<${delimiter}\n${directory}\n${delimiter}\nfiles=${JSON.stringify(files)}\n`;
		if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
		else process.stderr.write(output);
	});

export const app = cli('beepboop-winget')
	.envPrefix('WINGET_')
	.help({ flagSpelling: 'kebab' })
	.description('Generate WinGet manifests from package metadata and release assets')
	.default(generate, { route: true });

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await app.run();
