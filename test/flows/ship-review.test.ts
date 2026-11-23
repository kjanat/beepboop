import { expect, test } from 'bun:test';
import {
	CommentPages,
	checkStates,
	codexLogin,
	completedReviews,
	outcome,
	PullRequestView,
	waitFor,
} from '@root/.claude/skills/beepboop-ship/review.ts';
import { virtualTime } from '@root/test/support/time.ts';
import { Effect, Schema } from 'effect';
import { ToolFailure } from '@/tooling/runtime.ts';

const head = 'a'.repeat(40);
const done = [
	{ name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
	{ name: 'CodeQL', status: 'COMPLETED', conclusion: 'SUCCESS' },
	{ name: 'browser', status: 'COMPLETED', conclusion: 'SUCCESS' },
];

function summary(findings: boolean | null): string {
	const state = { code_review: { commit_sha: head, has_any_findings: findings, status: 'completed' } };
	return `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->`;
}

function comment(login: string, body: string) {
	return { id: 1, body, user: { login } };
}

function reviews(pages: unknown) {
	return completedReviews(Schema.decodeSync(CommentPages)(JSON.stringify(pages)), head);
}

test('a review on the second page of comments is read', () => {
	const pages = [[comment('kjanat', 'first page')], [comment(codexLogin, summary(false))]];
	expect(reviews(pages).map(review => review.code_review.commit_sha)).toEqual([head]);
});

test('a review marker from any other author is ignored', () => {
	const pages = [[comment(codexLogin, summary(true)), comment('mallory', summary(false))]];
	expect(reviews(pages).map(review => review.code_review.has_any_findings)).toEqual([true]);
});

test('only a review without findings exits 0', () => {
	const exits = [true, null, false].map(findings => {
		const result = outcome(done, reviews([[comment(codexLogin, summary(findings))]]), 'MERGEABLE');
		return result._tag === 'Reviewed' ? result.exit : result._tag;
	});
	expect(exits).toEqual([3, 3, 0]);
});

test('a failed check before the review exits 1 and a running check waits', () => {
	const failed = [
		{ name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE' },
		{ name: 'browser', status: 'IN_PROGRESS', conclusion: '' },
	];
	expect(outcome(failed, [], 'MERGEABLE')).toEqual({ _tag: 'Failed', exit: 1 });
	expect(outcome([{ name: 'verify', status: 'IN_PROGRESS', conclusion: '' }], [], 'MERGEABLE')).toEqual({
		_tag: 'Waiting',
	});
});

test('a conflicting pull request exits 4 without waiting for checks or review', () => {
	const running = [{ name: 'verify', status: 'IN_PROGRESS', conclusion: '' }];
	expect(outcome(running, [], 'CONFLICTING')).toEqual({ _tag: 'Conflicting', exit: 4 });
	expect(outcome(running, [], 'UNKNOWN')).toEqual({ _tag: 'Waiting' });
});

test('required checks are read from check runs and status contexts', () => {
	const view = Schema.decodeSync(PullRequestView)(JSON.stringify({
		headRefOid: head,
		mergeable: 'MERGEABLE',
		statusCheckRollup: [
			{ __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'Verify' },
			{ __typename: 'StatusContext', context: 'CodeQL', state: 'PENDING' },
		],
	}));
	expect(checkStates(view.statusCheckRollup, ['verify', 'CodeQL', 'browser'])).toEqual([
		{ name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
		{ name: 'CodeQL', status: 'PENDING', conclusion: '' },
		{ name: 'browser', status: 'missing', conclusion: '' },
	]);
});

function fakeGh(failures: number, message = 'GraphQL: Something went wrong') {
	const calls: string[][] = [];
	const run = (args: string[]) => {
		calls.push(args);
		if (calls.length <= failures) return Effect.fail(new ToolFailure({ message }));
		if (args[0] === 'pr') {
			return Effect.succeed(JSON.stringify({ headRefOid: head, mergeable: 'MERGEABLE', statusCheckRollup: done }));
		}
		return Effect.succeed(JSON.stringify([[comment(codexLogin, summary(false))]]));
	};
	return { calls, run };
}

test('transient gh failures are retried until the normal result', async () => {
	const gh = fakeGh(3);
	const verdict = await virtualTime(waitFor('1', gh.run));
	expect(verdict.exit).toBe(0);
	expect(gh.calls.length).toBe(5);
});

test('an undecodable gh reply is transient', async () => {
	let first = true;
	const gh = fakeGh(0);
	const run = (args: string[]) => {
		if (first) {
			first = false;
			return Effect.succeed('<html>502 Bad Gateway</html>');
		}
		return gh.run(args);
	};
	expect((await virtualTime(waitFor('1', run))).exit).toBe(0);
});

test('gh failing five times exits 5 with the message and never 1', async () => {
	const gh = fakeGh(Infinity, 'HTTP 502');
	const verdict = await virtualTime(waitFor('1', gh.run));
	expect(verdict).toEqual({ exit: 5, output: 'gh error: HTTP 502' });
	expect(gh.calls.length).toBe(5);
});
