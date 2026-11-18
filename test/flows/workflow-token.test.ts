import { expect, test } from 'bun:test';
import { bearer } from '@root/test/support/http.ts';
import { World } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import type { TokenAudit, TokenIssuer, TokenRequest } from '@/automation/token';
import { issueWorkflowToken } from '@/automation/token';
import { parseBindings } from '@/server/bindings';

const ownerId = 1;
const ref = 'refs/heads/master';
const sha = 'a'.repeat(40);
const repository = 'octo/tasks';
const filename = 'refresh-dependencies.yml';
const workflow = `${repository}/.github/workflows/${filename}`;
const identity: WorkflowIdentity = {
	repository,
	repositoryId: 2,
	ownerId,
	actorId: 3,
	runId: 4,
	attempt: 1,
	sha,
	workflowSha: sha,
	workflowRef: `${workflow}@${ref}`,
	ref,
	event: 'workflow_run',
};
const request: TokenRequest = { permissions: { contents: 'write' } };
const grants = { [identity.repositoryId]: ['other-approved.yml', filename] };

function issue(overrides: Partial<WorkflowIdentity> = {}, body = request, workflowRunGrants = grants) {
	const issued: unknown[] = [];
	const audited: unknown[] = [];
	const issuer: TokenIssuer = {
		botIdentity: Effect.die('Unexpected bot identity lookup'),
		defaultRevision: () => Effect.succeed({ ref, sha }),
		token: (...args) => Effect.sync(() => {
			issued.push(args);
			return 'installation-token';
		}),
		workflowRun: () => Effect.die('Unexpected dispatch lookup'),
	};
	const log: TokenAudit = {
		audit: (...args) => Effect.sync(() => {
			audited.push(args);
		}),
		execution: () => Effect.succeed(undefined),
	};
	const outcome = Effect.runSync(
		Effect.result(issueWorkflowToken({ ...identity, ...overrides }, body, ownerId, issuer, log, workflowRunGrants)),
	);
	return { outcome, issued, audited };
}

test('a non-owner can obtain a contents-only token from an approved default-branch workflow', () => {
	const { outcome, issued, audited } = issue();
	expect(outcome).toMatchObject({ _tag: 'Success', success: { token: 'installation-token' } });
	expect(issued).toEqual([[repository, 2, { contents: 'write' }]]);
	expect(audited).toEqual([['run:4', 'token.issued', `${repository} contents:write`]]);
});

test('the owner can still request other permissions without an approved workflow', () => {
	const body = { permissions: { issues: 'write' } };
	const { outcome, issued } = issue({ actorId: ownerId, event: 'push' }, body, {});
	expect(outcome).toMatchObject({ _tag: 'Success', success: { token: 'installation-token' } });
	expect(issued).toEqual([[repository, 2, body.permissions]]);
});

const rejectedIdentities: [string, Partial<WorkflowIdentity>][] = [
	['a pull request run', { event: 'pull_request' }],
	['a manually dispatched run', { event: 'workflow_dispatch' }],
	['an unlisted repository ID using the same workflow', { repositoryId: 5 }],
	['a different workflow', { workflowRef: `${repository}/.github/workflows/unapproved.yml@${ref}` }],
	['a reusable workflow', { helperSha: sha }],
	['a workflow from a different commit', { workflowSha: 'b'.repeat(40) }],
	['a stale revision', { sha: 'b'.repeat(40), workflowSha: 'b'.repeat(40) }],
	['a non-default ref', { ref: 'refs/heads/other', workflowRef: `${workflow}@refs/heads/other` }],
];

test.each(rejectedIdentities)('workflow_run token authorization refuses %s', (_label, overrides) => {
	const { outcome, issued } = issue(overrides);
	expect(outcome).toMatchObject({ _tag: 'Failure', failure: { problem: { code: 'forbidden' } } });
	expect(issued).toEqual([]);
});

const rejectedRequests: [string, TokenRequest][] = [
	['an extra scope', { ...request, permissions: { contents: 'write', pull_requests: 'write' } }],
	['the wrong scope', { ...request, permissions: { contents: 'read' } }],
	['a nonempty purpose', { ...request, purpose: 'autofix-vendor-hash' }],
];

test.each(rejectedRequests)('workflow_run token authorization refuses %s', (_label, body) => {
	const { outcome, issued } = issue({}, body);
	expect(outcome).toMatchObject({ _tag: 'Failure', failure: { problem: { code: 'forbidden' } } });
	expect(issued).toEqual([]);
});

test('the token endpoint reads the operator grant and validates the Worker binding', async () => {
	const world = await World.create();
	try {
		const repo = world.github.create(repository, { [`.github/workflows/${filename}`]: 'on: workflow_run' });
		const token = await world.runToken({
			repository: repo,
			runId: 4,
			sha: world.github.head(repo),
			file: filename,
			event: 'workflow_run',
			actorId: 3,
		});
		const api = bearer(world, token);
		expect((await api('/api/workflow/token', request)).status).toBe(403);
		world.env.WORKFLOW_RUN_CONTENTS_WRITE = { [repo.id]: [filename] };
		expect(Effect.runSync(parseBindings(world.env))).toBe(world.env);
		expect(await api('/api/workflow/token', request)).toMatchObject({
			status: 200,
			body: { token: expect.any(String) },
		});
		expect(world.github.tokenPermissions).toEqual([{ contents: 'read' }, { contents: 'write' }]);

		const invalidGrants: Record<string, string[]>[] = [{ [repository]: [filename] }, { [repo.id]: [`../${filename}`] }];
		for (const invalid of invalidGrants) {
			const outcome = Effect.runSync(
				Effect.result(parseBindings({ ...world.env, WORKFLOW_RUN_CONTENTS_WRITE: invalid })),
			);
			expect(outcome).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ConfigurationError' } });
		}
	} finally {
		world.dispose();
	}
});
