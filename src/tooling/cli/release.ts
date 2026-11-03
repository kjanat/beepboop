import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageId } from '@/automation/package-identity';

const directory = resolve(import.meta.dir, '../../../packages/cli');
const npm = await Bun.file(join(directory, 'package.json')).json();
const jsr = await Bun.file(join(directory, 'jsr.json')).json();
const context = JSON.parse(process.env.RELEASE_CONTEXT ?? '{}');
const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: directory });
if (revision.exitCode !== 0 || revision.stdout.toString().trim() !== context.sourceSha) {
	throw new Error('Checkout is not the approved commit');
}
if (
	context.operation !== 'promote' || context.stream !== 'cli' || context.version !== npm.version
	|| npm.version !== jsr.version || npm.name !== jsr.name || npm.version === '0.0.0'
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
async function command(args: string[]): Promise<void> {
	const child = Bun.spawn(args, { cwd: directory, stdout: 'inherit', stderr: 'inherit' });
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
				const existing = await response.json() as { dist?: { integrity?: string } };
				if (existing.dist?.integrity !== integrity) {
					throw new Error('Published npm tarball differs from this approved build');
				}
				console.log('Identical npm tarball already published; resuming release');
			} else {
				// npm is used only for its supported OIDC/provenance publication transport.
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
				]);
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
				...(manager === 'npm' ? { channel } : {}),
			});
		}
		await output('publications', JSON.stringify(publications));
		break;
	}
	default:
		throw new Error('Expected metadata, npm or report');
}
