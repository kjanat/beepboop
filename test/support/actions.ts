import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RunIdentity, World } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { bundleRuntime } from '@/tooling/actions/runtime-bundle';

const tokenHost = 'pipelines.actions.githubusercontent.com';
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

export async function runAction(
	world: World,
	mode: string,
	run: RunIdentity,
	variables: Record<string, string>,
): Promise<ActionResult> {
	const directory = mkdtempSync(join(tmpdir(), 'beepboop-action-'));
	try {
		await Effect.runPromise(bundleRuntime(join(directory, 'runtime')));
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
		const saved = { env: { ...process.env }, argv: [...process.argv] };
		const logs: string[] = [];
		const log = console.log;
		Object.assign(process.env, {
			SERVICE_ORIGIN: world.env.APPLICATION_ORIGIN,
			ACTIONS_ID_TOKEN_REQUEST_URL: `https://${tokenHost}/token?api-version=2.0`,
			ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
			GITHUB_OUTPUT: output,
			GITHUB_ENV: environment,
			...variables,
		});
		process.argv[2] = mode;
		console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
		try {
			await import(`${client}?run=${++invocation}`);
			return { outputs: outputs(output), environment: readFileSync(environment, 'utf8'), logs };
		} finally {
			console.log = log;
			for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
			Object.assign(process.env, saved.env);
			process.argv.splice(0, process.argv.length, ...saved.argv);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export async function runRuntime(
	entry: 'prepare' | 'refs',
	env: Record<string, string>,
): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'beepboop-runtime-'));
	try {
		await Effect.runPromise(bundleRuntime(join(directory, 'runtime')));
		const result = Bun.spawnSync(['bun', '--no-install', join(directory, 'runtime', `${entry}.ts`)], {
			cwd: directory,
			env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const stdout = result.stdout.toString();
		const stderr = result.stderr.toString();
		if (result.exitCode !== 0) throw new Error(`${entry} exited ${result.exitCode}\n${stdout}${stderr}`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function materialize(files: Record<string, string>): { dir: string; sha: string } {
	const dir = mkdtempSync(join(tmpdir(), 'beepboop-checkout-'));
	const git = (...args: string[]) => {
		const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
		if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed\n${result.stderr}`);
		return result.stdout.trim();
	};
	git('init', '-b', 'main');
	git('config', 'user.email', 'bot@example.com');
	git('config', 'user.name', 'Beepboop');
	git('config', 'commit.gpgsign', 'false');
	git('config', 'tag.gpgsign', 'false');
	git('config', 'core.hooksPath', '/dev/null');
	for (const [path, content] of Object.entries(files)) {
		const target = join(dir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	git('add', '-A');
	git('commit', '-m', 'Initial commit');
	return { dir, sha: git('rev-parse', 'HEAD') };
}

export function commitAll(dir: string, message: string): string {
	const git = (...args: string[]) => {
		const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
		if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed\n${result.stderr}`);
		return result.stdout.trim();
	};
	git('add', '-A');
	git('commit', '-m', message);
	return git('rev-parse', 'HEAD');
}

export function gitOutput(dir: string, args: string[]): string {
	const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed\n${result.stderr}`);
	return result.stdout.trim();
}
