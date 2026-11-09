import { spawnSync } from 'node:child_process';

export interface GitOptions {
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly input?: string;
	readonly timeout?: number;
	readonly maxBuffer?: number;
	readonly stderr?: 'pipe' | 'inherit';
}

export type GitResult =
	| { readonly ok: true; readonly stdout: string }
	| { readonly ok: false; readonly stdout: string; readonly stderr: string };

export function git(args: readonly string[], options: GitOptions = {}): GitResult {
	const { stderr = 'pipe', ...rest } = options;
	const result = spawnSync('git', args, { ...rest, encoding: 'utf8', stdio: ['pipe', 'pipe', stderr] });
	const stdout = result.stdout ?? '';
	return result.status === 0 && result.error === undefined
		? { ok: true, stdout: stdout.trim() }
		: { ok: false, stdout, stderr: result.stderr ?? '' };
}

export function checkoutAt(cwd: string, sha: unknown): boolean {
	const head = git(['rev-parse', 'HEAD'], { cwd });
	return head.ok && head.stdout === sha;
}
