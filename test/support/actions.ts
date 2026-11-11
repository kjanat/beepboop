import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Repository, Run } from '@root/test/support/github.ts';
import { botId } from '@root/test/support/github.ts';
import { withConsoleLog, withEnvironment } from '@root/test/support/process.ts';
import type { RunIdentity, World } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { git } from '@/git';
import { bundleRuntime } from '@/tooling/actions/runtime-bundle';

export const tokenHost = 'pipelines.actions.githubusercontent.com';
export const tokenRequest = {
	ACTIONS_ID_TOKEN_REQUEST_URL: `https://${tokenHost}/token?api-version=2.0`,
	ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
};
let invocation = 0;

function outputs(file: string): Record<string, string> {
	const entries: Record<string, string> = {};
	const pattern = /^([A-Za-z_][\w-]*)<<(value_[0-9a-f-]+)\n([\s\S]*?)\n\2$/gm;
	for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
		if (match[1] !== undefined && match[3] !== undefined) entries[match[1]] = match[3];
	}
	return entries;
}

export interface ActionResult {
	outputs: Record<string, string>;
	environment: string;
	logs: string[];
}

async function withRuntime<A>(prefix: string, work: (directory: string) => Promise<A>): Promise<A> {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	try {
		await Effect.runPromise(bundleRuntime(join(directory, 'runtime')));
		return await work(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function runAction(
	world: World,
	mode: string,
	run: RunIdentity,
	variables: Record<string, string>,
): Promise<ActionResult> {
	return withRuntime('beepboop-action-', async directory => {
		const client = join(directory, 'runtime', 'client.ts');
		const output = join(directory, 'output'), environment = join(directory, 'env');
		writeFileSync(output, '');
		writeFileSync(environment, '');
		const token = await world.runToken(run);
		world.network.serve(tokenHost, request => {
			if (request.headers.get('authorization') !== 'Bearer request-token') {
				return Response.json({ message: 'Bad credentials' }, { status: 401 });
			}
			return Response.json({ value: token });
		});
		const logs: string[] = [];
		return withEnvironment({
			SERVICE_ORIGIN: world.env.APPLICATION_ORIGIN,
			...tokenRequest,
			GITHUB_OUTPUT: output,
			GITHUB_ENV: environment,
			...variables,
		}, () => {
			process.argv[2] = mode;
			return withConsoleLog((...values: unknown[]) => logs.push(values.map(String).join(' ')), async () => {
				await import(`${client}?run=${++invocation}`);
				return { outputs: outputs(output), environment: readFileSync(environment, 'utf8'), logs };
			});
		});
	});
}

export function runIdentity(repository: Repository, run: Pick<Run, 'id' | 'headSha'>, file: string): RunIdentity {
	return { repository, runId: run.id, sha: run.headSha, file, actorId: botId };
}

export function begin(
	world: World,
	identity: RunIdentity,
	executionId: string,
	stream: string,
	operation: string,
): Promise<ActionResult> {
	return runAction(world, 'begin', identity, { EXECUTION_ID: executionId, STREAM: stream, OPERATION: operation });
}

export function runRuntime(
	entry: 'prepare' | 'pull-request' | 'refs',
	env: Record<string, string>,
): Promise<void> {
	return withRuntime('beepboop-runtime-', async directory => {
		const result = Bun.spawnSync(['bun', '--no-install', join(directory, 'runtime', `${entry}.ts`)], {
			cwd: directory,
			env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const stdout = result.stdout.toString();
		const stderr = result.stderr.toString();
		if (result.exitCode !== 0) throw new Error(`${entry} exited ${result.exitCode}\n${stdout}${stderr}`);
	});
}

export function materialize(files: Record<string, string>): { dir: string; sha: string } {
	const dir = mkdtempSync(join(tmpdir(), 'beepboop-checkout-'));
	gitOutput(dir, ['init', '-b', 'main']);
	gitOutput(dir, ['config', 'user.email', 'bot@example.com']);
	gitOutput(dir, ['config', 'user.name', 'Beepboop']);
	gitOutput(dir, ['config', 'commit.gpgsign', 'false']);
	gitOutput(dir, ['config', 'tag.gpgsign', 'false']);
	gitOutput(dir, ['config', 'core.hooksPath', '/dev/null']);
	for (const [path, content] of Object.entries(files)) {
		const target = join(dir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	return { dir, sha: commitAll(dir, 'Initial commit') };
}

export function commitAll(dir: string, message: string): string {
	gitOutput(dir, ['add', '-A']);
	gitOutput(dir, ['commit', '-m', message]);
	return gitOutput(dir, ['rev-parse', 'HEAD']);
}

export function gitOutput(dir: string, args: string[]): string {
	const result = git(args, { cwd: dir });
	if (!result.ok) throw new Error(`git ${args.join(' ')} failed\n${result.stderr}`);
	return result.stdout;
}
