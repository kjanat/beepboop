import { Result, Schema } from 'effect';
import type { Publication, PublishKind } from '@/automation/types';
import { registryLabel } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import type { LedgerEntry, LedgerManager, LedgerPackage } from '@/contract/ledger';
import { ledgerManagers } from '@/contract/ledger';
import type { Decoded } from '@/schema';
import { mutableArray, mutableStruct } from '@/schema';

export const registries: Record<LedgerManager, string> = {
	cargo: registryLabel('cargo'),
	pypi: registryLabel('pypi'),
	npm: registryLabel('npm'),
};
export const leaseDuration = 15 * 60_000;
export const rateLimitAttempts = 5;

const status = Schema.Union([
	mutableStruct({ state: Schema.Literal('planned') }),
	mutableStruct({ state: Schema.Literal('claimed'), holder: Schema.String, leaseUntil: Schema.Finite }),
	mutableStruct({
		state: Schema.Literal('uploaded'),
		holder: Schema.String,
		since: Schema.Finite,
		checkedAt: Schema.Finite,
	}),
	mutableStruct({ state: Schema.Literal('published'), url: Schema.String }),
	mutableStruct({ state: Schema.Literal('reused'), url: Schema.String }),
	mutableStruct({ state: Schema.Literal('rate-limited'), holder: Schema.String, retryAfter: Schema.Finite }),
	mutableStruct({ state: Schema.Literal('failed-retryable'), holder: Schema.String, error: Schema.String }),
	mutableStruct({ state: Schema.Literal('failed-permanent'), error: Schema.String }),
]);
export type LedgerStatus = Decoded<typeof status>;

const attempt = mutableStruct({
	holder: Schema.String,
	at: Schema.Finite,
	event: Schema.Literals(['claimed', 'uploaded', 'published', 'reused', 'rate-limited', 'failed']),
	detail: Schema.optional(Schema.String),
});
export type LedgerAttempt = Decoded<typeof attempt>;

const record = mutableStruct({
	purl: Schema.String,
	id: Schema.String,
	manager: Schema.Literals(ledgerManagers),
	name: Schema.String,
	version: Schema.String,
	manifest: Schema.String,
	required: Schema.Boolean,
	dependencies: mutableArray(Schema.String),
	generated: Schema.optional(Schema.Boolean),
	channel: Schema.optional(Schema.String),
	digest: Schema.optional(Schema.String),
	reservation: Schema.optional(Schema.Literals(['new', 'update'])),
	notBefore: Schema.optional(Schema.Finite),
	status,
	attempts: mutableArray(attempt),
});
export type LedgerRecord = Decoded<typeof record>;

export const ledgerSchema = mutableStruct({
	executionId: Schema.String,
	sourceSha: Schema.String,
	records: mutableArray(record),
});
export type Ledger = Decoded<typeof ledgerSchema>;

export type Availability =
	| { kind: 'open' }
	| { kind: 'held' }
	| { kind: 'uploaded'; since: number; checkedAt: number }
	| { kind: 'settled' }
	| { kind: 'wait'; until: number; reason: string };

export function label(record: LedgerRecord): string {
	return `${record.name} ${record.version}`;
}

export function availability(record: LedgerRecord, holder: string, now: number): Availability {
	const status = record.status;
	switch (status.state) {
		case 'published':
		case 'reused':
		case 'failed-permanent':
			return { kind: 'settled' };
		case 'failed-retryable':
			return status.holder === holder ? { kind: 'settled' } : { kind: 'open' };
		case 'uploaded':
			return { kind: 'uploaded', since: status.since, checkedAt: status.checkedAt };
		case 'claimed':
			if (status.holder === holder) return { kind: 'held' };
			return status.leaseUntil > now
				? { kind: 'wait', until: status.leaseUntil, reason: `Another run is publishing ${label(record)}` }
				: { kind: 'open' };
		case 'rate-limited':
			return status.retryAfter > now
				? {
					kind: 'wait',
					until: status.retryAfter,
					reason: `${registries[record.manager]} rate limits ${label(record)} until ${
						new Date(status.retryAfter).toISOString()
					}`,
				}
				: { kind: 'open' };
		case 'planned':
			return (record.notBefore ?? 0) > now
				? {
					kind: 'wait',
					until: record.notBefore ?? now,
					reason: `${registries[record.manager]} allows ${label(record)} at ${
						new Date(record.notBefore ?? now).toISOString()
					}`,
				}
				: { kind: 'open' };
	}
}

function settle(
	record: LedgerRecord,
	holder: string,
	now: number,
	next: LedgerStatus,
	event: LedgerAttempt['event'],
	detail?: string,
): LedgerRecord {
	return {
		...record,
		status: next,
		attempts: [...record.attempts, { holder, at: now, event, ...(detail === undefined ? {} : { detail }) }],
	};
}

export function claim(
	record: LedgerRecord,
	holder: string,
	digest: string,
	now: number,
): Result.Result<LedgerRecord, DomainError> {
	const state = availability(record, holder, now).kind;
	if (state === 'held') {
		return record.digest === digest
			? Result.succeed(record)
			: Result.fail(precondition(`The artifact for ${label(record)} changed after this run claimed it`));
	}
	if (state !== 'open') return Result.fail(precondition(`${label(record)} cannot be claimed now`));
	return Result.succeed(
		settle(
			{ ...record, digest },
			holder,
			now,
			{ state: 'claimed', holder, leaseUntil: now + leaseDuration },
			'claimed',
		),
	);
}

export function reuse(record: LedgerRecord, holder: string, url: string, now: number): LedgerRecord {
	return settle(record, holder, now, { state: 'reused', url }, 'reused');
}

export function publish(record: LedgerRecord, holder: string, url: string, now: number): LedgerRecord {
	return settle(record, holder, now, { state: 'published', url }, 'published');
}

export function rateLimit(record: LedgerRecord, holder: string, retryAfter: number, now: number): LedgerRecord {
	const limited = record.attempts.filter(entry => entry.holder === holder && entry.event === 'rate-limited').length;
	if (limited + 1 >= rateLimitAttempts) {
		return fail(record, holder, `${registries[record.manager]} kept rate limiting ${label(record)}`, false, now);
	}
	return settle(
		record,
		holder,
		now,
		{ state: 'rate-limited', holder, retryAfter },
		'rate-limited',
		new Date(retryAfter).toISOString(),
	);
}

export function fail(
	record: LedgerRecord,
	holder: string,
	error: string,
	permanent: boolean,
	now: number,
): LedgerRecord {
	return settle(
		record,
		holder,
		now,
		permanent ? { state: 'failed-permanent', error } : { state: 'failed-retryable', holder, error },
		'failed',
		error,
	);
}

export function released(record: LedgerRecord): boolean {
	return ['uploaded', 'published', 'reused'].includes(record.status.state);
}

export function entry(record: LedgerRecord): LedgerEntry {
	const status = record.status;
	return {
		purl: record.purl,
		required: record.required,
		state: status.state,
		...('error' in status ? { error: status.error } : {}),
	};
}

export function view(record: LedgerRecord): LedgerPackage {
	return {
		purl: record.purl,
		id: record.id,
		manager: record.manager,
		name: record.name,
		version: record.version,
		manifest: record.manifest,
		required: record.required,
		...(record.generated ? { generated: true } : {}),
		...(record.channel ? { channel: record.channel } : {}),
	};
}

export function publicationOf(record: LedgerRecord): Publication | undefined {
	const fields = {
		id: record.id,
		manager: record.manager,
		name: record.name,
		version: record.version,
		required: record.required,
	};
	const status = record.status;
	switch (status.state) {
		case 'published':
		case 'reused':
			return {
				...fields,
				...(record.digest ? { digest: record.digest } : {}),
				url: status.url,
				outcome: 'succeeded',
			};
		case 'uploaded':
			return { ...fields, ...(record.digest ? { digest: record.digest } : {}), outcome: 'succeeded' };
		case 'failed-retryable':
		case 'failed-permanent':
			return { ...fields, outcome: 'failed' };
		case 'rate-limited':
			return { ...fields, outcome: 'rate-limited', retryAfter: new Date(status.retryAfter).toISOString() };
		case 'planned':
		case 'claimed':
			return undefined;
	}
}

export function pacedPublication(record: LedgerRecord, until: number): Publication {
	return {
		id: record.id,
		manager: record.manager,
		name: record.name,
		version: record.version,
		required: record.required,
		outcome: 'rate-limited',
		retryAfter: new Date(until).toISOString(),
	};
}

export function reservation(publicationStatus: string | undefined): PublishKind {
	return publicationStatus === 'missing' ? 'new' : 'update';
}
