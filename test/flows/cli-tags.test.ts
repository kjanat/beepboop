import { beforeEach, expect, setSystemTime, test } from 'bun:test';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { call, cliTransport } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import {
	ciWorkflow,
	jsonFile,
	licenseText,
	npmManifest,
	passChecks,
	publishWorkflow,
} from '@root/test/support/repositories.ts';
import type { SigningKey } from '@root/test/support/signing.ts';
import { fakeSigner, signingKey } from '@root/test/support/signing.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { routes } from '@/contract/routes';
import { packageTagView } from '@/contract/views';
import { decodeSync, mutableArray } from '@/kernel/schema/structs.ts';

let world: World, directory: string, token: string, key: SigningKey;
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-tags-', created => {
	directory = created;
});
beforeEach(async () => {
	({ token } = await savedClient(world, directory));
});

async function repository() {
	key = signingKey('Release Bot (CI) <release@example.com>');
	world.env.SIGNER = fakeSigner(key);
	const created = world.github.create('octo/widget', {
		'package.json': npmManifest('widget', '1.0.0'),
		'README.md': '# widget\n',
		LICENSE: licenseText,
		'.github/workflows/publish.yml': publishWorkflow,
		'.github/workflows/ci.yml': ciWorkflow,
		'.github/beepboop.json': jsonFile({
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:npm/widget'],
					packageTags: ['pkg:npm/widget'],
					required: ['pkg:npm/widget'],
					prepare: { strategy: 'managed' },
					release: {
						approval: 'required',
						workflow: {
							file: 'publish.yml',
							publications: ['pkg:npm/widget'],
							refs: { phase: 'version', prefix: 'v', signed: true },
						},
					},
				},
			},
		}, '\t'),
	});
	const head = world.github.head(created);
	passChecks(created, head);
	world.github.recordTag(created, 'v0.9.0', '1'.repeat(40), head, true);
	world.github.recordTag(created, 'v1.0.0', '2'.repeat(40), head, true);
	world.npm.publish('widget', '1.0.0');
	await call(routes.repositoriesDiscover, { repository: created.name }, cliTransport(world, token));
	return { created, head };
}

test('tags backfill previews the missing tags, asks, creates them and then has nothing left', async () => {
	try {
		const { created, head } = await repository();
		const commit = head.slice(0, 12);
		const args = ['tags', 'backfill', '--repository', 'octo/widget'];
		const dry = await runCli([...args, '--dry-run']);
		expect(dry.exitCode).toBe(0);
		expect(dry.stdout.join('')).toBe(
			'tag            version  commit        state          \n'
				+ '-------------  -------  ------------  ---------------\n'
				+ `widget-v0.9.0  0.9.0    ${commit}  ○ not published\n`
				+ `widget-v1.0.0  1.0.0    ${commit}  ◷ to create    \n`
				+ '0 exist, 1 to create, 1 not published, 0 on another commit, 0 unchecked.\n'
				+ 'Dry run: Beepboop created no tags.\n',
		);
		const declined = await runCli(args, [false]);
		expect([declined.exitCode, declined.stdout.join('').endsWith('Package tags unchanged.\n')]).toEqual([0, true]);
		expect(created.refs.has('tags/widget-v1.0.0')).toBe(false);
		const accepted = await runCli(args, [true]);
		expect(accepted.exitCode).toBe(0);
		expect(accepted.stdout.join('')).toEndWith(
			'tag            version  commit        state          \n'
				+ '-------------  -------  ------------  ---------------\n'
				+ `widget-v0.9.0  0.9.0    ${commit}  ○ not published\n`
				+ `widget-v1.0.0  1.0.0    ${commit}  ✔ created      \n`,
		);
		expect(accepted.activity).toContainEqual({ type: 'spinner:succeed', text: 'Created 1 package tags' });
		expect(created.refs.has('tags/widget-v1.0.0')).toBe(true);
		const done = await runCli([...args, '--json', '--yes']);
		expect(decodeSync(mutableArray(packageTagView), JSON.parse(done.stdout.join(''))).map(row => row.outcome))
			.toEqual(['unpublished', 'exists']);
		expect((await runCli(args)).stdout.join('')).toEndWith('Every published package has its tag.\n');
	} finally {
		key.dispose();
	}
}, 30_000);

test('tags backfill explains a repository without packageTags', async () => {
	await call(
		routes.repositoriesDiscover,
		{ repository: world.github.create('octo/plain', { 'README.md': '# plain\n' }).name },
		cliTransport(world, token),
	);
	const refused = await runCli(['tags', 'backfill', '--repository', 'octo/plain']);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.join('')).toContain('octo/plain names no packageTags in any stream');
});

test('tags backfill exits 1 when a tag name targets another commit, also when declined, or a tag fails', async () => {
	try {
		const { created } = await repository();
		const moved = world.github.push(created, { 'README.md': '# widget\n\nMoved.\n' }, 'Move on');
		world.github.recordTag(created, 'widget-v0.9.0', '3'.repeat(40), moved.sha, true);
		world.npm.publish('widget', '0.9.0');
		const args = ['tags', 'backfill', '--repository', 'octo/widget'];
		const conflicted = await runCli([...args, '--dry-run']);
		expect(conflicted.exitCode).toBe(1);
		expect(conflicted.stdout.join('')).toContain('targets another commit');
		const declined = await runCli(args, [false]);
		expect([declined.exitCode, declined.stdout.join('').endsWith('Package tags unchanged.\n')]).toEqual([1, true]);
		world.env.SIGNER = fakeSigner(key, { userId: 'release bot' });
		const failed = await runCli([...args, '--yes']);
		expect(failed.exitCode).toBe(1);
		expect(failed.stdout.join('')).toContain('The signing key needs a user ID with a name and email');
		expect(created.refs.has('tags/widget-v1.0.0')).toBe(false);
	} finally {
		key.dispose();
	}
}, 30_000);

test('tags backfill asks for --stream when several streams have packageTags', async () => {
	try {
		const { created } = await repository();
		const document = JSON.parse(world.github.file(created, '.github/beepboop.json') ?? '{}');
		document.streams.second = document.streams.main;
		world.github.push(created, { '.github/beepboop.json': jsonFile(document, '\t') }, 'Add a stream');
		await call(routes.repositoriesDiscover, { repository: created.name }, cliTransport(world, token));
		const refused = await runCli(['tags', 'backfill', '--repository', 'octo/widget']);
		expect(refused.exitCode).not.toBe(0);
		expect(refused.stderr.join('')).toContain('Choose a stream: main, second');
	} finally {
		key.dispose();
	}
}, 30_000);

test('tags backfill follows the pages of a long history', async () => {
	try {
		const { created, head } = await repository();
		for (let minor = 1; minor <= 9; minor++) {
			world.github.recordTag(created, `v0.${minor}.1`, String(minor).repeat(40), head, true);
		}
		let stalled = false;
		world.network.serve('registry.npmjs.org', request => {
			if (!stalled) {
				stalled = true;
				setSystemTime(new Date(Date.now() + 60_000));
			}
			return world.npm.handle(request);
		});
		const done = await runCli(['tags', 'backfill', '--repository', 'octo/widget', '--json', '--yes']);
		expect(done.exitCode).toBe(0);
		const rows = decodeSync(mutableArray(packageTagView), JSON.parse(done.stdout.join('')));
		expect([rows.length, new Set(rows.map(row => row.tag)).size]).toEqual([11, 11]);
		expect(rows.filter(row => row.outcome === 'created').map(row => row.tag)).toEqual(['widget-v1.0.0']);
		expect(created.refs.has('tags/widget-v1.0.0')).toBe(true);
	} finally {
		setSystemTime();
		key.dispose();
	}
}, 30_000);
