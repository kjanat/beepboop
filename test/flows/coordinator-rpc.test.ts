import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('Durable Object RPC preserves domain refusals and hides unexpected server failures', async () => {
	const built = await Bun.build({
		entrypoints: [join(import.meta.dir, '../fixtures/rpc/worker.ts')],
		target: 'browser',
		external: ['cloudflare:workers'],
	});
	expect(built.success).toBe(true);
	const output = built.outputs[0];
	if (!output) throw new Error('RPC fixture bundle was not emitted');
	const child = Bun.spawn([
		'node',
		'--experimental-strip-types',
		join(import.meta.dir, '../support/rpc-runtime.ts'),
	], {
		stdin: output,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(code, stderr).toBe(0);
	const responses: unknown = JSON.parse(stdout);
	expect(responses).toEqual([
		{
			kind: 'precondition',
			status: 422,
			body: {
				error: 'The crate needs a license',
				problem: {
					code: 'precondition',
					diagnostics: [{ code: 'legacy', severity: 'blocking', message: 'The crate needs a license' }],
				},
			},
		},
		{
			kind: 'upstream',
			status: 502,
			body: { error: 'Registry lookup failed', problem: { code: 'upstream', service: 'registry', retryable: true } },
		},
		{
			kind: 'defect',
			status: 500,
			body: {
				error: expect.stringMatching(/^Internal error /),
				problem: { code: 'internal', incident: expect.any(String) },
			},
		},
		{
			kind: 'malformed',
			status: 500,
			body: {
				error: expect.stringMatching(/^Internal error /),
				problem: { code: 'internal', incident: expect.any(String) },
			},
		},
	]);
	expect(stdout).not.toContain('server-only');
}, 15_000);
