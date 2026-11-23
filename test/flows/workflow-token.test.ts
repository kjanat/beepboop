import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import type { DispatchedExecution, TokenIssuer } from '@/auth/workflow-token.ts';
import { issueWorkflowToken } from '@/auth/workflow-token.ts';
import { dispatchedExecution } from '@/automation/execution';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';

const identity: RunIdentity = {
	repositoryId: 1,
	repository: 'octo/widget',
	ownerId: 7,
	actorId: 9,
	runId: 42,
	attempt: 1,
	sha: 'a'.repeat(40),
	workflowSha: 'a'.repeat(40),
	workflowRef: 'octo/widget/.github/workflows/release.yml@refs/heads/main',
	ref: 'refs/heads/main',
	event: 'workflow_dispatch',
};

function issuer(title: string): TokenIssuer {
	return {
		botIdentity: Effect.succeed({ login: 'beepboop[bot]', id: 9, email: 'bot@example.com' }),
		defaultRevision: () => Effect.die('unused'),
		revisionFiles: () => Effect.die('unused'),
		mintToken: () => Effect.succeed('minted'),
		workflowRun: () => Effect.succeed({ title, path: '.github/workflows/release.yml' }),
	};
}

function issued(execution: DispatchedExecution | undefined, title = 'Release 1.0.0 (exec-1)') {
	const log = { audit: () => Effect.void, execution: () => Effect.succeed(execution) };
	const body = { permissions: { contents: 'read' }, executionId: 'exec-1' };
	return Effect.runPromise(issueWorkflowToken(identity, body, 7, issuer(title), log).pipe(Effect.isSuccess));
}

const dispatched: DispatchedExecution = {
	repositoryId: 1,
	state: 'dispatching',
	workflow: { file: 'release.yml', ref: 'main' },
	runTitle: 'Release 1.0.0 (exec-1)',
};

test('a run dispatched by Beepboop gets a token while its execution waits for that run', async () => {
	expect(await issued(dispatched)).toBe(true);
	expect(await issued({ ...dispatched, state: 'running', runId: 42 }, 'Renamed')).toBe(true);
	expect(await issued(dispatched, 'Release 1.0.1 (exec-2)')).toBe(false);
	expect(await issued({ ...dispatched, runId: 41 })).toBe(false);
	expect(await issued({ ...dispatched, state: 'succeeded' })).toBe(false);
	expect(await issued({ ...dispatched, repositoryId: 2 })).toBe(false);
	expect(await issued({ ...dispatched, workflow: { file: 'other.yml', ref: 'main' } })).toBe(false);
	expect(await issued(undefined)).toBe(false);
});

test('the token check sees the run title and workflow of the execution', () => {
	const execution = decodeExecutionV1({
		id: 'exec-1-0123456789',
		repositoryId: 1,
		repository: 'octo/widget',
		stream: 'main',
		version: '1.0.0',
		configurationSha: 'configuration',
		sourceSha: 'source',
		eventId: 'manual',
		configuration: { extends: [], managers: ['npm'], subscriptions: [], streams: {} },
		publications: [],
		operation: 'promote',
		presetShas: {},
		dependencies: [],
		attempts: 1,
		artifacts: [],
		createdAt: 1,
		updatedAt: 1,
		state: 'dispatching',
		workflow: { file: 'release.yml', ref: 'refs/heads/main' },
	});
	expect(dispatchedExecution(execution)).toEqual({
		repositoryId: 1,
		state: 'dispatching',
		workflow: { file: 'release.yml', ref: 'refs/heads/main' },
		runTitle: 'Release operation exec-1-0123456789',
	});
	expect(dispatchedExecution({ ...execution, titled: true, runId: 42 })).toEqual({
		repositoryId: 1,
		state: 'dispatching',
		runId: 42,
		workflow: { file: 'release.yml', ref: 'refs/heads/main' },
		runTitle: 'Release 1.0.0 (exec-1-0)',
	});
});
