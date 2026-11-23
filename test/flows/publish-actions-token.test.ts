import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import type { TokenIssuer } from '@/auth/workflow-token.ts';
import { issueWorkflowToken } from '@/auth/workflow-token.ts';
import { revisionFiles } from '@/github/contents.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import { decode } from '@/kernel/schema/result.ts';

let world: World;
eachWorld(created => {
	world = created;
});

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

function publishable(repository: Repository): string {
	return world.github.push(repository, {
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

function issuedFor(
	trees: Record<string, Record<string, readonly [string, string]>>,
	truncated = false,
): Promise<boolean> {
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
				const content = files[decodeURIComponent(path.split('/contents/')[1]?.split('?')[0] ?? '')]?.[1];
				if (path.includes('/contents/')) {
					return content === undefined
						? null
						: { encoding: 'base64', content: btoa(content), size: content.length };
				}
				return {
					truncated,
					tree: Object.entries(files).map(([file, [mode, text]]) => ({
						path: file,
						type: 'blob',
						mode,
						sha: String(Bun.hash(text)),
					})),
				};
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
	return Effect.runPromise(
		issueWorkflowToken(
			identity,
			{
				purpose: 'publish-actions',
				permissions: { contents: 'write', workflows: 'write' },
			},
			7,
			issuer,
			log,
		).pipe(Effect.isSuccess),
	);
}

function file(content: string, mode = '100644'): readonly [string, string] {
	return [mode, content];
}

test('the publication token compares modes and refuses local uses it cannot resolve', async () => {
	const script = { 'actions/deps/bun/action.yml': file(bun), 'actions/deps/bun/setup.sh': file('echo\n') };
	const at = (uses: string, extra: Record<string, readonly [string, string]> = script) => ({
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
});

test('an older run gets the publication token while the workflow and its local actions are unchanged', async () => {
	const repository = widget(world.github);
	const run = publishable(repository);
	world.github.push(repository, { 'README.md': '# widget\n\nMoved on.\n' }, 'Edit the readme');
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
