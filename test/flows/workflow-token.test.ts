import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import type { TokenAudit, TokenIssuer, TokenRequest } from '@/automation/token';
import { issueWorkflowToken } from '@/automation/token';

const ownerId = 1;
const ref = 'refs/heads/master';
const sha = 'a'.repeat(40);
const workflow = 'kjanat/actionlint/.github/workflows/autofix-vendor-hash.yml';
const identity: WorkflowIdentity = {
	repository: 'kjanat/actionlint',
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
const request: TokenRequest = { purpose: 'autofix-vendor-hash', permissions: { contents: 'write' } };

function issue(overrides: Partial<WorkflowIdentity> = {}, body = request) {
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
		Effect.result(issueWorkflowToken({ ...identity, ...overrides }, body, ownerId, issuer, log)),
	);
	return { outcome, issued, audited };
}

test('a dependency bot can obtain a contents-only token from the current vendor hash workflow', () => {
	const { outcome, issued, audited } = issue();
	expect(outcome).toMatchObject({ _tag: 'Success', success: { token: 'installation-token' } });
	expect(issued).toEqual([['kjanat/actionlint', 2, { contents: 'write' }]]);
	expect(audited).toEqual([['run:4', 'token.issued', 'kjanat/actionlint contents:write']]);
});

const rejectedIdentities: [string, Partial<WorkflowIdentity>][] = [
	['a pull request run', { event: 'pull_request' }],
	['a manually dispatched run', { event: 'workflow_dispatch' }],
	['a different workflow', { workflowRef: `kjanat/actionlint/.github/workflows/autofix.yml@${ref}` }],
	['a reusable workflow', { helperSha: sha }],
	['a workflow from a different commit', { workflowSha: 'b'.repeat(40) }],
	['a stale revision', { sha: 'b'.repeat(40), workflowSha: 'b'.repeat(40) }],
	['a non-default ref', { ref: 'refs/heads/other', workflowRef: `${workflow}@refs/heads/other` }],
];

test.each(rejectedIdentities)('vendor hash autofix refuses %s', (_label, overrides) => {
	const { outcome, issued } = issue(overrides);
	expect(outcome).toMatchObject({ _tag: 'Failure', failure: { problem: { code: 'forbidden' } } });
	expect(issued).toEqual([]);
});

const rejectedRequests: [string, TokenRequest][] = [
	['an extra scope', { ...request, permissions: { contents: 'write', pull_requests: 'write' } }],
	['the wrong scope', { ...request, permissions: { contents: 'read' } }],
	['a non-owner request without the purpose', { permissions: { contents: 'write' } }],
];

test.each(rejectedRequests)('vendor hash autofix refuses %s', (_label, body) => {
	const { outcome, issued } = issue({}, body);
	expect(outcome).toMatchObject({ _tag: 'Failure', failure: { problem: { code: 'forbidden' } } });
	expect(issued).toEqual([]);
});
