import { expect, test } from 'bun:test';
import { join, relative } from 'node:path';
import type { Repository } from '@root/test/support/github.ts';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect, Schema } from 'effect';
import { parse } from 'yaml';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import type { TokenIssuer } from '@/auth/workflow-token.ts';
import { issueWorkflowToken, publishCode } from '@/auth/workflow-token.ts';
import { revisionFiles } from '@/github/contents.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import { decode } from '@/kernel/schema/result.ts';
import { entrypoints } from '@/tooling/actions/runtime-bundle';

let world: World;
eachWorld(created => {
	world = created;
});

const root = join(import.meta.dir, '../..');
const workflow = [
	'name: Verify and publish Actions',
	'on: { push: { branches: [main] } }',
	'jobs:',
	'  verify:',
	'    uses: $/.github/workflows/ci.yml',
	'  publish:',
	'    needs: verify',
	'    runs-on: ubuntu-latest',
	'    steps:',
	'      - uses: $/actions/token',
	'      - run: bun src/tooling/actions/distribute.ts',
	'',
].join('\n');
const token = 'runs:\n  using: composite\n  steps:\n    - uses: $/actions/deps/bun\n';
const bun = 'runs:\n  using: composite\n  steps: []\n';
const code = Object.fromEntries(
	publishCode.map(path => /\.\w+$/.test(path) ? [path, `${path}\n`] : [`${path}/index.ts`, `export {};\n`]),
);

function publishable(repository: Repository): string {
	return world.github.push(repository, {
		...code,
		'.github/workflows/publish-actions.yml': workflow,
		'actions/token/action.yml': token,
		'actions/deps/bun/action.yml': bun,
	}, 'Add the publish workflow').sha;
}

async function publicationToken(repository: Repository, sha: string): Promise<number> {
	const bearer = await world.runToken({ repository, runId: 7, sha, file: 'publish-actions.yml', event: 'push' });
	const response = await world.handle(
		new Request(`${origin}/api/workflow/token`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ purpose: 'publish-actions', permissions: { contents: 'write', workflows: 'write' } }),
		}),
	);
	return response.status;
}

const run = 'a'.repeat(40), head = 'b'.repeat(40);
type Files = Record<string, readonly [string, string]>;

function listing(files: Files) {
	const blobs = Object.entries(files).map(([path, [mode, text]]) => ({
		path,
		type: 'blob',
		mode,
		sha: String(Bun.hash(`${mode} ${text}`)),
	}));
	const directories = new Set(
		blobs.flatMap(({ path }) =>
			path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))
		),
	);
	const trees = [...directories].map(directory => ({
		path: directory,
		type: 'tree',
		mode: '040000',
		sha: String(Bun.hash(JSON.stringify(blobs.filter(({ path }) => path.startsWith(`${directory}/`))))),
	}));
	return [...blobs, ...trees];
}

function issuedFor(trees: Record<string, Files>, truncated = false): Promise<boolean> {
	const identity: RunIdentity = {
		repositoryId: 41,
		repository: 'octo/widget',
		ownerId: 7,
		actorId: 7,
		runId: 900,
		attempt: 1,
		sha: run,
		workflowSha: run,
		workflowRef: 'octo/widget/.github/workflows/publish-actions.yml@refs/heads/main',
		ref: 'refs/heads/main',
		event: 'push',
	};
	const issuer: TokenIssuer = {
		botIdentity: Effect.succeed({ login: 'beepboop[bot]', id: 9, email: 'bot@example.com' }),
		defaultRevision: () => Effect.succeed({ ref: 'refs/heads/main', sha: head }),
		revisionFiles: (name, _id, sha) => {
			const files = trees[sha] ?? {};
			const response = (path: string): unknown => {
				if (!path.includes('/contents/')) return { truncated, tree: listing(files) };
				const content = files[decodeURIComponent(path.split('/contents/')[1]?.split('?')[0] ?? '')]?.[1];
				return content === undefined ? null : { encoding: 'base64', content: btoa(content), size: content.length };
			};
			const github: GitHubRequests = {
				call: path => Effect.succeed(response(path)),
				read: (schema, path) => Effect.fromResult(decode(schema, response(path))),
			};
			return revisionFiles(github, name, sha, 'token');
		},
		mintToken: () => Effect.succeed('minted'),
		workflowRun: () => Effect.succeed({ title: '', path: '' }),
	};
	const log = { audit: () => Effect.void, execution: () => Effect.undefined };
	const body = { purpose: 'publish-actions', permissions: { contents: 'write', workflows: 'write' } };
	return Effect.runPromise(issueWorkflowToken(identity, body, 7, issuer, log).pipe(Effect.isSuccess));
}

function file(content: string, mode = '100644'): readonly [string, string] {
	return [mode, content];
}

const codeFiles: Files = Object.fromEntries(Object.entries(code).map(([path, text]) => [path, file(text)]));

test('the publication token compares modes and refuses local uses it cannot resolve', async () => {
	const script = { 'actions/deps/bun/action.yml': file(bun), 'actions/deps/bun/setup.sh': file('echo\n') };
	const at = (uses: string, extra: Files = script): Files => ({
		...codeFiles,
		'.github/workflows/publish-actions.yml': file(`jobs:\n  publish:\n    steps:\n      - uses: ${uses}\n`),
		...extra,
	});
	expect(await issuedFor({ [run]: at('$/actions/deps/bun'), [head]: at('$/actions/deps/bun') })).toBe(true);
	expect(await issuedFor({ [run]: at('$/actions/deps/bun'), [head]: at('$/actions/deps/bun') }, true)).toBe(false);
	expect(
		await issuedFor({
			[run]: at('$/actions/deps/bun'),
			[head]: at('$/actions/deps/bun', { ...script, 'actions/deps/bun/setup.sh': file('echo\n', '100755') }),
		}),
	).toBe(false);
	expect(await issuedFor({ [run]: at('./${{ matrix.action }}'), [head]: at('./${{ matrix.action }}') })).toBe(false);
	expect(await issuedFor({ [run]: at('$/actions/missing'), [head]: at('$/actions/missing') })).toBe(false);
	const broken = { 'actions/deps/bun/action.yml': file('runs: [\n') };
	expect(await issuedFor({ [run]: at('$/actions/deps/bun', broken), [head]: at('$/actions/deps/bun', broken) }))
		.toBe(false);
	expect(
		await issuedFor({
			[run]: at('./', { 'action.yml': file(bun), 'README.md': file('one\n') }),
			[head]: at('./', { 'action.yml': file(bun), 'README.md': file('two\n') }),
		}),
	).toBe(false);
	const { 'src/tooling/runtime.ts': _, ...withoutRuntime } = at('$/actions/deps/bun');
	expect(await issuedFor({ [run]: withoutRuntime, [head]: withoutRuntime })).toBe(false);
});

test('an older run gets the publication token while only code outside the publish job changed', async () => {
	const repository = widget(world.github);
	const run = publishable(repository);
	world.github.push(repository, {
		'README.md': '# widget\n\nMoved on.\n',
		'src/automation/service.ts': 'export {};\n',
		'packages/persistence/src/index.ts': 'export {};\n',
	}, 'Change server code');
	expect(await publicationToken(repository, run)).toBe(200);
});

test('an older run is refused once the publish workflow changes', async () => {
	const repository = widget(world.github);
	const run = publishable(repository);
	world.github.push(repository, {
		'.github/workflows/publish-actions.yml': workflow.replace('bun src', 'bun --smol src'),
	}, 'Change the publish workflow');
	expect(await publicationToken(repository, run)).toBe(403);
});

test('an older run is refused once a local action that the publish workflow uses changes', async () => {
	const repository = widget(world.github);
	const run = publishable(repository);
	world.github.push(repository, { 'actions/deps/bun/action.yml': `${bun}# changed\n` }, 'Change a nested action');
	expect(await publicationToken(repository, run)).toBe(403);
});

test('an older run is refused once the reusable workflow that the publish workflow calls changes', async () => {
	const repository = widget(world.github);
	const run = publishable(repository);
	world.github.push(repository, { '.github/workflows/ci.yml': 'name: CI\n' }, 'Change the reusable workflow');
	expect(await publicationToken(repository, run)).toBe(403);
});

test('an older run is refused once a script that the publish job runs changes', async () => {
	const repository = widget(world.github);
	const run = publishable(repository);
	world.github.push(repository, { 'src/tooling/actions/distribute.ts': 'export {};\n' }, 'Change the distribution');
	expect(await publicationToken(repository, run)).toBe(403);
});

test('the publish code covers every module the publish job runs or bundles', async () => {
	const loaded = new Set<string>();
	const result = await Bun.build({
		entrypoints: [
			'src/tooling/actions/distribute.ts',
			'src/tooling/actions/release.ts',
			...entrypoints.map(entry => `packages/actions/src/${entry}.ts`),
		].map(path => join(root, path)),
		target: 'bun',
		tsconfig: join(root, 'tsconfig.json'),
		plugins: [{
			name: 'loaded',
			setup(build) {
				build.onLoad({ filter: /.*/ }, args => {
					loaded.add(args.path);
					return undefined;
				});
			},
		}],
	});
	expect(result.success).toBe(true);
	const local = [...loaded].map(path => relative(root, path)).filter(path => !path.includes('node_modules/'));
	expect(local.filter(path => !publishCode.some(code => path === code || path.startsWith(`${code}/`)))).toEqual([]);
	const publishSteps = Schema.Struct({
		jobs: Schema.Struct({
			publish: Schema.Struct({
				steps: Schema.Array(Schema.Struct({
					env: Schema.optional(Schema.Struct({ PUBLISH_CODE: Schema.optional(Schema.String) })),
				})),
			}),
		}),
	});
	const { jobs } = Schema.decodeUnknownSync(publishSteps)(
		parse(await Bun.file(join(root, '.github/workflows/publish-actions.yml')).text()),
	);
	const declared = jobs.publish.steps.flatMap(step => step.env?.PUBLISH_CODE?.split(/\s+/) ?? []);
	expect(declared).toEqual(['.github', ...publishCode]);
});
