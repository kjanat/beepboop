import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Effect, Exit } from 'effect';
import { registry } from '@/tooling/cli/registry';

const root = join(import.meta.dir, '../..');

async function exitOf(args: string[], environment: Record<string, string> = {}) {
	const child = Bun.spawn(['bun', ...args], {
		cwd: root,
		env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? root, ...environment },
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, output: stdout + stderr };
}

function inline(program: string): string[] {
	return ['-e', `import { Cause, Effect } from 'effect'; import { runMain } from '@/host/main.ts'; ${program}`];
}

test('action and tooling entrypoints print only the failure message and exit 1', async () => {
	const runs = await Promise.all([
		exitOf(['packages/actions/src/client.ts']),
		exitOf(['packages/actions/src/prepare.ts']),
		exitOf(['packages/actions/src/publish.ts']),
		exitOf(['packages/actions/src/pull-request.ts']),
		exitOf(['packages/actions/src/refs.ts']),
		exitOf(['src/tooling/schema/generate.ts', '--bogus']),
	]);
	expect(runs).toEqual([
		{ code: 1, output: 'Unknown integration action\n' },
		{ code: 1, output: 'RELEASE_CONTEXT is required\n' },
		{ code: 1, output: 'EXECUTION_ID is required\n' },
		{ code: 1, output: 'GITHUB_WORKSPACE is required\n' },
		{ code: 1, output: 'Ref plan required\n' },
		{ code: 1, output: "Unknown option '--bogus'\n" },
	]);
});

test('GitHub Actions receives every failure as one error annotation', async () => {
	const run = await exitOf(
		inline(
			`await runMain(Effect.failCause(Cause.combine(Cause.fail(new Error('first 100%')), Cause.fail('second'))));`,
		),
		{ GITHUB_ACTIONS: 'true' },
	);
	expect(run).toEqual({ code: 1, output: '::error::first 100%25%0Asecond\n' });
});

test('a defect keeps its stack, an interruption exits 130 and success exits 0', async () => {
	const [defect, interrupted, succeeded] = await Promise.all([
		exitOf(inline(`await runMain(Effect.die(new Error('broken invariant')));`)),
		exitOf(inline('await runMain(Effect.interrupt);')),
		exitOf(inline('await runMain(Effect.void);')),
	]);
	expect(defect.code).toBe(1);
	expect(defect.output).toStartWith('Error: broken invariant\n    at ');
	expect([interrupted, succeeded]).toEqual([{ code: 130, output: '' }, { code: 0, output: '' }]);
});

test('a failure names every distinct message along its cause chain', async () => {
	const [wrapped, repeated, blank] = await Promise.all([
		exitOf(inline(
			`await runMain(Effect.fail(new Error('Internal error 7', { cause: new Error('Discovery file limit exceeded') })));`,
		)),
		exitOf(
			inline(`await runMain(Effect.fail(new Error('Ref plan required', { cause: new Error('Ref plan required') })));`),
		),
		exitOf(inline(`await runMain(Effect.fail(new Error('')));`)),
	]);
	expect([wrapped, repeated]).toEqual([
		{ code: 1, output: 'Internal error 7: Discovery file limit exceeded\n' },
		{ code: 1, output: 'Ref plan required\n' },
	]);
	expect(blank.code).toBe(1);
	expect(blank.output.trim()).not.toBe('');
});

test('a registry failure names the URL it requested', async () => {
	using server = Bun.serve({ port: 0, fetch: () => new Response('down', { status: 500 }) });
	const failing = `http://127.0.0.1:${server.port}/@kjanat%2fbeepboop`;
	const unreachable = 'http://127.0.0.1:9/@kjanat%2fbeepboop';
	const messages = await Promise.all([failing, unreachable].map(async url => {
		const exit = await Effect.runPromiseExit(registry(url));
		return Exit.isFailure(exit) ? exit.cause.reasons.map(reason => 'error' in reason ? reason.error.message : '') : [];
	}));
	expect(messages[0]).toEqual([`${failing}: Registry returned HTTP 500`]);
	expect(messages[1]?.[0]).toStartWith(`${unreachable}: `);
});
