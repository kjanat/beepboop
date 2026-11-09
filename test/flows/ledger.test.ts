import { expect, test } from 'bun:test';
import { Result } from 'effect';
import type { LedgerRecord } from '@/automation/ledger';
import {
	availability,
	claim,
	fail,
	leaseDuration,
	publicationOf,
	publish,
	rateLimit,
	rateLimitAttempts,
	reuse,
} from '@/automation/ledger';

const now = Date.parse('2026-11-09T10:00:00.000Z');
const planned: LedgerRecord = {
	purl: 'pkg:cargo/lint-core@1.1.0',
	id: 'pkg:cargo/lint-core',
	manager: 'cargo',
	name: 'lint-core',
	version: '1.1.0',
	manifest: 'crates/core/Cargo.toml',
	required: true,
	dependencies: [],
	status: { state: 'planned' },
	attempts: [],
};

function claimed(record: LedgerRecord, holder: string, digest = 'a'.repeat(64), at = now): LedgerRecord {
	return Result.getOrThrow(claim(record, holder, digest, at));
}

test('a planned record is open, and claiming it hands the run a lease', () => {
	expect(availability(planned, '1:1', now)).toEqual({ kind: 'open' });
	const held = claimed(planned, '1:1');
	expect(held.status).toEqual({ state: 'claimed', holder: '1:1', leaseUntil: now + leaseDuration });
	expect(held.digest).toBe('a'.repeat(64));
	expect(held.attempts).toEqual([{ holder: '1:1', at: now, event: 'claimed' }]);
	expect(publicationOf(held)).toBeUndefined();
});

test('a paced record waits until its slot', () => {
	expect(availability({ ...planned, notBefore: now + 60_000 }, '1:1', now)).toEqual({
		kind: 'wait',
		until: now + 60_000,
		reason: 'crates.io allows lint-core 1.1.0 at 2026-11-09T10:01:00.000Z',
	});
	expect(Result.isFailure(claim({ ...planned, notBefore: now + 60_000 }, '1:1', 'a'.repeat(64), now))).toBe(true);
});

test('claiming again in the same run is idempotent and refuses a changed artifact', () => {
	const held = claimed(planned, '1:1');
	expect(availability(held, '1:1', now)).toEqual({ kind: 'held' });
	expect(claimed(held, '1:1')).toBe(held);
	expect(Result.isFailure(claim(held, '1:1', 'b'.repeat(64), now))).toBe(true);
});

test('another run waits for a live lease and takes over an expired one', () => {
	const held = claimed(planned, '1:1');
	expect(availability(held, '2:1', now)).toEqual({
		kind: 'wait',
		until: now + leaseDuration,
		reason: 'Another run is publishing lint-core 1.1.0',
	});
	expect(availability(held, '2:1', now + leaseDuration)).toEqual({ kind: 'open' });
	expect(claimed(held, '2:1', 'b'.repeat(64), now + leaseDuration).status).toEqual({
		state: 'claimed',
		holder: '2:1',
		leaseUntil: now + 2 * leaseDuration,
	});
});

test('a claimed record becomes published and reports a succeeded publication with its digest', () => {
	const done = publish(claimed(planned, '1:1'), '1:1', 'https://crates.io/x', now + 1);
	expect(done.status).toEqual({ state: 'published', url: 'https://crates.io/x' });
	expect(availability(done, '2:1', now)).toEqual({ kind: 'settled' });
	expect(publicationOf(done)).toEqual({
		id: 'pkg:cargo/lint-core',
		manager: 'cargo',
		name: 'lint-core',
		version: '1.1.0',
		required: true,
		digest: 'a'.repeat(64),
		url: 'https://crates.io/x',
		outcome: 'succeeded',
	});
});

test('an open record the registry already has becomes reused', () => {
	const done = reuse({ ...planned, digest: 'a'.repeat(64) }, '1:1', 'https://crates.io/x', now);
	expect(done.status).toEqual({ state: 'reused', url: 'https://crates.io/x' });
	expect(done.attempts.map(entry => entry.event)).toEqual(['reused']);
	expect(publicationOf(done)?.outcome).toBe('succeeded');
});

test('a rate limited record waits for Retry-After and opens again afterwards', () => {
	const limited = rateLimit(claimed(planned, '1:1'), '1:1', now + 90_000, now);
	expect(limited.status).toEqual({ state: 'rate-limited', holder: '1:1', retryAfter: now + 90_000 });
	expect(availability(limited, '1:1', now).kind).toBe('wait');
	expect(availability(limited, '1:1', now + 90_000)).toEqual({ kind: 'open' });
	expect(publicationOf(limited)).toEqual({
		id: 'pkg:cargo/lint-core',
		manager: 'cargo',
		name: 'lint-core',
		version: '1.1.0',
		required: true,
		outcome: 'rate-limited',
		retryAfter: '2026-11-09T10:01:30.000Z',
	});
	expect(claimed(limited, '1:1', 'a'.repeat(64), now + 90_000).status.state).toBe('claimed');
});

test('a run that keeps hitting the rate limit fails its record for that run', () => {
	let record = planned;
	for (let attempt = 1; attempt < rateLimitAttempts; attempt++) {
		record = rateLimit(claimed(record, '1:1', 'a'.repeat(64), now + attempt * 100_000), '1:1', now, now);
		expect(record.status.state).toBe('rate-limited');
	}
	record = rateLimit(claimed(record, '1:1', 'a'.repeat(64), now + 1e6), '1:1', now, now);
	expect(record.status).toEqual({
		state: 'failed-retryable',
		holder: '1:1',
		error: 'crates.io kept rate limiting lint-core 1.1.0',
	});
});

test('a retryable failure settles the failing run and stays open for the next one', () => {
	const failed = fail(claimed(planned, '1:1'), '1:1', 'error: could not compile', false, now);
	expect(failed.status).toEqual({ state: 'failed-retryable', holder: '1:1', error: 'error: could not compile' });
	expect(availability(failed, '1:1', now)).toEqual({ kind: 'settled' });
	expect(availability(failed, '1:2', now)).toEqual({ kind: 'open' });
	expect(publicationOf(failed)).toEqual({
		id: 'pkg:cargo/lint-core',
		manager: 'cargo',
		name: 'lint-core',
		version: '1.1.0',
		required: true,
		outcome: 'failed',
	});
});

test('a permanent failure settles every run', () => {
	const failed = fail(claimed(planned, '1:1'), '1:1', 'crates.io has a different lint-core 1.1.0', true, now);
	expect(failed.status).toEqual({ state: 'failed-permanent', error: 'crates.io has a different lint-core 1.1.0' });
	expect(availability(failed, '2:1', now)).toEqual({ kind: 'settled' });
	expect(Result.isFailure(claim(failed, '2:1', 'a'.repeat(64), now))).toBe(true);
});
