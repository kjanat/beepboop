import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublicationRuntime } from '@root/actions/runtime/publish.ts';
import { publicationStage } from '@root/actions/runtime/publish.ts';
import { withConsoleLog } from '@root/test/support/process.ts';
import { Effect, Result } from 'effect';
import type { WorkflowPublicationPlan } from '@/contract/publication';

const executionId = 'a'.repeat(64);
const plan: WorkflowPublicationPlan = {
	executionId,
	repositoryId: 1,
	repository: 'octo/action',
	sourceSha: 'b'.repeat(40),
	packages: false,
	refs: false,
	release: false,
};
const environment = { EXECUTION_ID: executionId, GITHUB_WORKSPACE: '/fixture' };

function fixture(overrides: Partial<WorkflowPublicationPlan> = {}) {
	const calls: { path: string; body: unknown }[] = [];
	const events: string[] = [];
	const runtime: PublicationRuntime = {
		packages: Effect.sync(() => {
			events.push('packages');
		}),
		call: (path, body) => Effect.sync(() => {
			calls.push({ path, body });
			events.push(path);
			if (path === '/api/workflow/publication-plan') return { ...plan, ...overrides };
			if (path === '/api/workflow/token') {
				return {
					token: 'synthetic-token',
					bot: { login: 'example[bot]', id: 123, email: '123+example[bot]@users.noreply.github.com' },
				};
			}
			if (path === '/api/workflow/refs-plan') {
				return {
					repository: plan.repository,
					executionId,
					version: '1.2.3',
					changes: [{ name: 'v1', commit: plan.sourceSha, expected: null, annotated: false, signed: false }],
				};
			}
			return {};
		}),
		refs: (refs, root, remote, token, identity) => Effect.sync(() => {
			events.push('push');
			expect(refs.executionId).toBe(executionId);
			expect([root, remote, token, identity]).toEqual([
				'/fixture',
				'https://github.com/octo/action.git',
				'synthetic-token',
				{ name: 'example[bot]', email: '123+example[bot]@users.noreply.github.com' },
			]);
		}),
	};
	return { calls, events, runtime };
}

function run(work: Effect.Effect<void, unknown>) {
	return withConsoleLog(() => {}, () => Effect.runPromise(work.pipe(Effect.result)));
}

test('publication preparation follows the authoritative plan and skips package work for aliases', async () => {
	const scenario = fixture({ refs: true });
	expect(Result.isSuccess(await run(publicationStage('prepare', environment, scenario.runtime)))).toBe(true);
	expect(scenario.events).toEqual(['/api/workflow/publication-plan']);
});

test('distribution capture follows package publication and gets only server-selected paths and execution identity', async () => {
	const scenario = fixture({ packages: true, refs: true, distribution: { files: ['dist/main.mjs'] } });
	const directory = mkdtempSync(join(tmpdir(), 'beepboop-publication-test-'));
	const output = join(directory, 'output');
	writeFileSync(output, '');
	scenario.runtime.prepare = received => Effect.sync(() => {
		scenario.events.push('capture');
		expect(received.DISTRIBUTION_PATHS).toBe('["dist/main.mjs"]');
		expect(received.DISTRIBUTION_TOKEN).toBe('synthetic-token');
		expect(JSON.parse(received.CONTEXT || '{}')).toEqual({
			id: executionId,
			repositoryId: 1,
			repository: 'octo/action',
			sourceSha: plan.sourceSha,
		});
		return { manifestPath: '/manifest.json', subjectChecksums: '/subjects.sha256' };
	});
	try {
		const result = await run(
			publicationStage(
				'prepare',
				{ ...environment, GITHUB_OUTPUT: output, DISTRIBUTION_PATHS: '["untrusted"]' },
				scenario.runtime,
			),
		);
		expect(Result.isSuccess(result)).toBe(true);
		expect(scenario.events).toEqual(['/api/workflow/publication-plan', 'packages', '/api/workflow/token', 'capture']);
		expect(readFileSync(output, 'utf8')).toContain('/manifest.json');
		expect(readFileSync(output, 'utf8')).toContain('/subjects.sha256');
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('completion plans, pushes and confirms refs before requesting the GitHub release', async () => {
	const scenario = fixture({ refs: true, release: true });
	expect(Result.isSuccess(await run(publicationStage('complete', environment, scenario.runtime)))).toBe(true);
	expect(scenario.events).toEqual([
		'/api/workflow/publication-plan',
		'/api/workflow/refs-plan',
		'/api/workflow/token',
		'push',
		'/api/workflow/refs-complete',
		'/api/workflow/release',
	]);
	expect(scenario.calls.find(call => call.path === '/api/workflow/token')?.body).toEqual({
		executionId,
		permissions: { contents: 'write' },
		identity: true,
	});
	expect(scenario.calls.find(call => call.path === '/api/workflow/refs-plan')?.body).toEqual({ executionId });
});

test('distribution completion requires its internal manifest and proof before planning or minting a push token', async () => {
	const scenario = fixture({ refs: true, distribution: { files: ['dist/main.mjs'] } });
	const result = await run(publicationStage('complete', environment, scenario.runtime));
	expect(Result.isFailure(result)).toBe(true);
	expect(scenario.events).toEqual(['/api/workflow/publication-plan']);
});

test('release-only publication performs no package, distribution or ref work', async () => {
	const scenario = fixture({ release: true });
	expect(Result.isSuccess(await run(publicationStage('complete', environment, scenario.runtime)))).toBe(true);
	expect(scenario.events).toEqual(['/api/workflow/publication-plan', '/api/workflow/release']);
});
