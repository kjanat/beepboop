import { expect, test } from 'bun:test';
import { Cause, Effect, Exit } from 'effect';
import { readEach } from '@/errors/decoding';
import { classify, fromSync } from '@/failure';
import { packageIdentity } from '@/package-url';

const message = 'Invalid purl: "name" is a required component';
const unnamed = () => packageIdentity('pkg:npm/');

test('an invalid package URL is a precondition failure with its own message', () => {
	let thrown: unknown;
	try {
		unnamed();
	} catch (error) {
		thrown = error;
	}
	expect(classify(thrown, 'incident')).toEqual({
		problem: { code: 'precondition', diagnostics: [{ code: 'legacy', severity: 'blocking', message }] },
		message,
	});
});

test('fromSync fails, rather than dies, on an invalid package URL', async () => {
	const exit = await Effect.runPromiseExit(fromSync(unnamed));
	if (!Exit.isFailure(exit)) throw new Error('expected a failure');
	expect(Cause.hasDies(exit.cause)).toBe(false);
	expect(Cause.squash(exit.cause)).toMatchObject({ problem: { code: 'precondition' }, message });
});

test('a row whose package URL is invalid reads as unreadable', () => {
	expect(readEach(['row'], unnamed, (row, error) => ({ kind: 'unreadable' as const, row, error }))).toEqual([
		{ kind: 'unreadable', row: 'row', error: message },
	]);
});
