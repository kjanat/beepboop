import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { packageId } from '@/automation/package-identity';
import { record } from '@/model';

const directory = resolve(import.meta.dir, '../../../packages/cli');
const manifest = z.object({ name: z.string(), version: z.string() });
const npm = manifest.parse(await Bun.file(join(directory, 'package.json')).json());
const jsr = manifest.parse(await Bun.file(join(directory, 'jsr.json')).json());
const context = z.object({
	sourceSha: z.string().optional(),
	operation: z.string().optional(),
	stream: z.string().optional(),
	version: z.string().optional(),
}).parse(JSON.parse(process.env.RELEASE_CONTEXT ?? '{}'));
const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: directory });
if (revision.exitCode !== 0 || revision.stdout.toString().trim() !== context.sourceSha) {
	throw new Error('Checkout is not the approved commit');
}
if (
	context.operation !== 'promote' || context.stream !== 'cli' || context.version !== npm.version
	|| npm.version !== jsr.version || npm.name !== jsr.name
) {
	throw new Error('Publication requires an approved CLI release with matching npm and JSR versions');
}
if (process.env.GITHUB_SHA !== context.sourceSha) {
	throw new Error(
		'Workflow commit differs from the approved source; refresh and approve the current commit before publishing provenance',
	);
}
const channel = npm.version.includes('-') ? 'next' : 'latest';
async function output(name: string, value: string): Promise<void> {
	if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GitHub output file');
	await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
async function command(args: string[], env: Record<string, string> = {}): Promise<void> {
	const child = Bun.spawn(args, {
		cwd: directory,
		stdout: 'inherit',
		stderr: 'inherit',
		env: { ...process.env, ...env },
	});
	if (await child.exited !== 0) throw new Error(`${args[0]} failed`);
}
async function registry(url: string): Promise<Response> {
	const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
	if (!response.ok && response.status !== 404) throw new Error(`Registry returned HTTP ${response.status}`);
	return response;
}
switch (process.argv[2]) {
	case 'metadata':
		await output('version', npm.version);
		break;
	case 'npm': {
		const temporary = await mkdtemp(join(tmpdir(), 'beepboop-publish-'));
		try {
			const tarball = join(temporary, 'cli.tgz');
			await command(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', tarball]);
			const integrity = `sha512-${
				new Bun.CryptoHasher('sha512').update(await Bun.file(tarball).arrayBuffer()).digest('base64')
			}`;
			const response = await registry(`https://registry.npmjs.org/${encodeURIComponent(npm.name)}/${npm.version}`);
			if (response.ok) {
				const published = record(record(await response.json()).dist ?? {}).integrity;
				if (typeof published !== 'string') throw new Error('npm returned no integrity for the published version');
				await output('integrity', published);
				console.log(
					published === integrity
						? `npm ${npm.name}@${npm.version} matches this build (${integrity}).`
						: `::warning::npm ${npm.name}@${npm.version} has integrity ${published}. This build has integrity ${integrity}.`,
				);
			} else {
				await output('integrity', integrity);
				const userconfig = join(temporary, '.npmrc');
				if (process.env.NPM_TOKEN) {
					await writeFile(userconfig, `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`, { mode: 0o600 });
				}
				// npm is used only for its supported provenance publication transport.
				await command([
					'bunx',
					'npm@12.2.1',
					'publish',
					tarball,
					'--access',
					'public',
					'--provenance',
					'--tag',
					channel,
				], process.env.NPM_TOKEN ? { NPM_CONFIG_USERCONFIG: userconfig } : {});
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
		break;
	}
	case 'report': {
		const publications = [];
		for (const manager of ['npm', 'jsr'] as const) {
			const successful = process.env[`${manager.toUpperCase()}_OUTCOME`] === 'success';
			publications.push({
				id: packageId({ manager, name: npm.name }),
				manager,
				name: npm.name,
				version: npm.version,
				required: true,
				outcome: successful ? 'succeeded' : 'failed',
				...(manager === 'npm'
					? { channel, ...(process.env.NPM_INTEGRITY ? { digest: process.env.NPM_INTEGRITY } : {}) }
					: {}),
			});
		}
		await output('publications', JSON.stringify(publications));
		break;
	}
	default:
		throw new Error('Expected metadata, npm or report');
}
