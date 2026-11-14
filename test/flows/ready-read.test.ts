import { expect, spyOn, test } from 'bun:test';
import { TestD1, TestStatement } from '@root/test/support/d1';
import { Effect, Result } from 'effect';
import { sql } from '@/persistence/d1/database';
import { readyRead } from '@/persistence/d1/ready-read';

const pending = { query: 'SELECT 1 WHERE ?=1', values: [0] };
const selected = { query: 'SELECT ? AS id', values: ['selected-row'] };

test('ready reads bind guard and result queries into one database transaction', async () => {
	const db = new TestD1();
	try {
		const batch = spyOn(db, 'batch');
		expect(await Effect.runPromise(readyRead(sql(db), pending, selected, 'maintenance pending'))).toEqual([{
			id: 'selected-row',
		}]);
		expect(batch).toHaveBeenCalledTimes(1);
		const statements = batch.mock.calls[0]?.[0];
		expect(statements).toHaveLength(2);
		if (!statements) throw new Error('Missing atomic read batch');
		for (const [index, query] of [pending, selected].entries()) {
			const statement = statements[index];
			if (!(statement instanceof TestStatement)) throw new Error('Unexpected statement type');
			expect(statement.sql).toBe(query.query);
			expect(statement.values).toEqual(query.values);
		}
	} finally {
		db.sqlite.close();
	}
});

test('a pending marker rejects selected evidence instead of returning an incomplete success', async () => {
	const db = new TestD1();
	try {
		const result = await Effect.runPromise(
			Effect.result(readyRead(sql(db), { ...pending, values: [1] }, selected, 'maintenance pending')),
		);
		expect(Result.isFailure(result) && result.failure.message).toBe('maintenance pending');
		expect(JSON.stringify(result)).not.toContain('selected-row');
	} finally {
		db.sqlite.close();
	}
});

for (const malformed of [[], [{ results: [] }], [{ results: [] }, { results: 'wrong' }]]) {
	test(`ready reads reject malformed batch results (${JSON.stringify(malformed)})`, async () => {
		const db = new TestD1();
		try {
			const result = await Effect.runPromise(
				Effect.result(
					readyRead({ ...sql(db), batch: () => Effect.succeed(malformed) }, pending, selected, 'maintenance pending'),
				),
			);
			expect(Result.isFailure(result)).toBe(true);
		} finally {
			db.sqlite.close();
		}
	});
}
