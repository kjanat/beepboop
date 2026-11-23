import { expect, test } from 'bun:test';
import { codexLogin, completedReviews, outcome } from '@root/.claude/skills/beepboop-ship/review.ts';

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

test('a review on the second page of comments is read', () => {
	const pages = JSON.stringify([[comment('kjanat', 'first page')], [comment(codexLogin, summary(false))]]);
	expect(completedReviews(pages, head).map(review => review.code_review.commit_sha)).toEqual([head]);
});

test('a review marker from any other author is ignored', () => {
	const pages = JSON.stringify([[comment(codexLogin, summary(true)), comment('mallory', summary(false))]]);
	expect(completedReviews(pages, head).map(review => review.code_review.has_any_findings)).toEqual([true]);
});

test('only a review without findings exits 0', () => {
	const exits = [true, null, false].map(findings => {
		const result = outcome(done, completedReviews(JSON.stringify([[comment(codexLogin, summary(findings))]]), head));
		return result._tag === 'Reviewed' ? result.exit : result._tag;
	});
	expect(exits).toEqual([3, 3, 0]);
});

test('a failed check before the review exits 1 and a running check waits', () => {
	const failed = [
		{ name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE' },
		{ name: 'browser', status: 'IN_PROGRESS', conclusion: '' },
	];
	expect(outcome(failed, [])).toEqual({ _tag: 'Failed', exit: 1 });
	expect(outcome([{ name: 'verify', status: 'IN_PROGRESS', conclusion: '' }], [])).toEqual({ _tag: 'Waiting' });
});
