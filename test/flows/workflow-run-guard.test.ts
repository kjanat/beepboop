import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { RunBinding, RunExpectation, RunIdentity } from '@/auth/actions-oidc.ts';
import { WorkflowRunGuard } from '@/auth/actions-oidc.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';

const identity: RunIdentity = {
	repositoryId: 41,
	repository: 'octo/widget',
	ownerId: 7,
	actorId: 7,
	runId: 900,
	attempt: 2,
	sha: 'a'.repeat(40),
	workflowSha: 'b'.repeat(40),
	workflowRef: 'octo/widget/.github/workflows/release.yml@refs/heads/main',
	ref: 'refs/heads/main',
	event: 'workflow_dispatch',
};
const bound: RunBinding = {
	state: 'running',
	repositoryId: 41,
	repository: 'octo/widget',
	runId: 900,
	runAttempt: 2,
	workflowSha: 'b'.repeat(40),
};

const changes: Record<string, Partial<RunBinding>> = {
	state: { state: 'queued' },
	repositoryId: { repositoryId: 42 },
	runId: { runId: 901 },
	unboundRun: { runId: undefined },
	runAttempt: { runAttempt: 1 },
	unboundAttempt: { runAttempt: undefined },
	workflowSha: { workflowSha: 'c'.repeat(40) },
	unboundWorkflowSha: { workflowSha: undefined },
	repository: { repository: 'octo/renamed' },
};

function outcome(binding: RunBinding, expectation: RunExpectation): Promise<string> {
	return Effect.runPromise(
		WorkflowRunGuard.require(binding, identity, expectation).pipe(
			Effect.as('accepted'),
			Effect.catch(error => Effect.succeed(`${error.problem.code}: ${decodeError(error)}`)),
		),
	);
}

test('SameRun refuses a binding to another run and ignores the repository name', async () => {
	const results = Object.fromEntries(
		await Promise.all(
			Object.entries(changes).map(async ([name, change]) =>
				[
					name,
					await outcome({ ...bound, ...change }, { _tag: 'SameRun', mismatch: 'Report identity mismatch' }),
				] as const
			),
		),
	);
	expect(results).toEqual({
		state: 'precondition: Report identity mismatch',
		repositoryId: 'precondition: Report identity mismatch',
		runId: 'precondition: Report identity mismatch',
		unboundRun: 'precondition: Report identity mismatch',
		runAttempt: 'precondition: Report identity mismatch',
		unboundAttempt: 'precondition: Report identity mismatch',
		workflowSha: 'precondition: Report identity mismatch',
		unboundWorkflowSha: 'precondition: Report identity mismatch',
		repository: 'accepted',
	});
	expect(await outcome(bound, { _tag: 'SameRun', mismatch: 'Report identity mismatch' })).toBe('accepted');
});

test('SameRunAndName also refuses a binding under another repository name', async () => {
	const expectation: RunExpectation = { _tag: 'SameRunAndName', mismatch: 'Ref operation identity mismatch' };
	const results = await Promise.all(
		Object.values(changes).map(change => outcome({ ...bound, ...change }, expectation)),
	);
	expect(new Set(results)).toEqual(new Set(['precondition: Ref operation identity mismatch']));
	expect(await outcome(bound, expectation)).toBe('accepted');
});
