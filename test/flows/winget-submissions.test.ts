import { expect, test } from 'bun:test';
import { TestD1 } from '@root/test/support/d1.ts';
import { Effect } from 'effect';
import { sql } from '@/persistence/d1/database';
import { WinGetSubmissions } from '@/publication/adapters/d1/winget-submissions.ts';
import type { WinGetSubmission } from '@/publication/winget/submission.ts';

function submission(
	repositoryId: number,
	releaseId: number,
	version: string,
	updatedAt: number,
	state: WinGetSubmission['state'] = 'pending',
): WinGetSubmission {
	return {
		plan: {
			id: `${repositoryId}:${releaseId}`,
			repositoryId,
			repository: `octo/repo-${repositoryId}`,
			releaseId,
			tag: `v${version}`,
			version,
			packageIdentifier: `Octo.Repo${repositoryId}`,
			sourceSha: 'a'.repeat(40),
			configurationSha: 'b'.repeat(64),
			files: {},
			digest: 'c'.repeat(64),
			releaseUrl: `https://github.com/octo/repo-${repositoryId}/releases/tag/v${version}`,
		},
		state,
		updatedAt,
	};
}

test('a WinGet submission lease admits one holder and hides the row from reconciliation until released', async () => {
	const submissions = new WinGetSubmissions(sql(new TestD1()));
	const run = <A>(work: Effect.Effect<A, unknown>) => Effect.runPromise(work);
	const pending = submission(42, 10, '1.1.0', 1_000);
	await run(submissions.insert(pending));
	await run(submissions.insert({ ...pending, plan: { ...pending.plan, id: '42:11' }, updatedAt: 2_000 }));
	expect(await run(submissions.get('42:10'))).toEqual(pending);
	expect(await run(submissions.get('42:11'))).toBeUndefined();

	expect(await run(submissions.lock('42:10', 'first', 601_000, 1_000))).toBe(true);
	expect(await run(submissions.lock('42:10', 'second', 602_000, 2_000))).toBe(false);
	expect(await run(submissions.open(null, 2_000))).toEqual([]);

	await run(submissions.save({ ...pending, state: 'failed', updatedAt: 3_000 }, 'second'));
	expect((await run(submissions.get('42:10')))?.state).toBe('pending');
	const open = { ...pending, state: 'open' as const, number: 7, updatedAt: 3_000 };
	await run(submissions.save(open, 'first'));
	expect(await run(submissions.get('42:10'))).toEqual(open);

	const replaced = { ...pending, plan: { ...pending.plan, version: '1.1.1' }, updatedAt: 4_000 };
	expect(await run(submissions.replace(replaced, 'first', 700_000))).toBe(false);
	expect(await run(submissions.replace(replaced, 'first', 4_000))).toBe(true);
	expect(await run(submissions.get('42:10'))).toEqual(replaced);

	await run(submissions.settle({ ...replaced, state: 'merged' }, 5_000, 5_000));
	expect((await run(submissions.get('42:10')))?.state).toBe('pending');
	await run(submissions.unlock('42:10', 'second'));
	expect(await run(submissions.open(null, 5_000))).toEqual([]);
	await run(submissions.unlock('42:10', 'first'));
	expect(await run(submissions.open(null, 5_000))).toEqual([{ id: '42:10', document: JSON.stringify(replaced) }]);
	await run(submissions.settle({ ...replaced, state: 'merged' }, 6_000, 6_000));
	expect((await run(submissions.get('42:10')))?.state).toBe('merged');
	expect(await run(submissions.open(null, 6_000))).toEqual([]);
});

test('WinGet listings page open rows by id, keep the newest release per repository and track the watch start', async () => {
	const submissions = new WinGetSubmissions(sql(new TestD1()));
	const run = <A>(work: Effect.Effect<A, unknown>) => Effect.runPromise(work);
	const older = submission(42, 10, '1.0.0', 3_000, 'open');
	const newer = submission(42, 11, '1.1.0', 1_000, 'closed');
	const other = submission(7, 5, '2.0.0', 2_000);
	for (const value of [older, newer, other]) await run(submissions.insert(value));

	expect(await run(submissions.recent())).toEqual([older, other, newer]);
	expect(
		(await run(submissions.latestPerRepository())).map(value => value.plan.id).sort(),
	).toEqual(['42:11', '7:5']);
	expect((await run(submissions.open(null, 1))).map(row => row.id)).toEqual(['42:10', '7:5']);
	expect((await run(submissions.open('42:10', 1))).map(row => row.id)).toEqual(['7:5']);

	expect(await run(submissions.watchedSince(42))).toBeUndefined();
	await run(submissions.watch(42, 100));
	await run(submissions.watch(42, 200));
	expect(await run(submissions.watchedSince(42))).toBe(100);
	await run(submissions.unwatch(42));
	expect(await run(submissions.watchedSince(42))).toBeUndefined();
});
