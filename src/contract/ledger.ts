import { Schema } from 'effect';
import { textSchema as text } from '@/model';
import type { Decoded } from '@/schema';
import { mutableArray, mutableStruct } from '@/schema';

export const ledgerManagers = ['cargo', 'pypi', 'npm'] as const;
export const publishWaitMinutes = 30;
export type LedgerManager = (typeof ledgerManagers)[number];

export const ledgerStates = [
	'planned',
	'claimed',
	'uploaded',
	'published',
	'reused',
	'rate-limited',
	'failed-retryable',
	'failed-permanent',
] as const;
export type LedgerState = (typeof ledgerStates)[number];

export const ledgerPackage = mutableStruct({
	purl: text,
	id: text,
	manager: Schema.Literals(ledgerManagers),
	name: text,
	version: text,
	manifest: text,
	required: Schema.Boolean,
	generated: Schema.optional(Schema.Boolean),
	channel: Schema.optional(text),
});
export type LedgerPackage = Decoded<typeof ledgerPackage>;

export const ledgerEntry = mutableStruct({
	purl: text,
	required: Schema.Boolean,
	state: Schema.Literals(ledgerStates),
	error: Schema.optional(text),
});
export type LedgerEntry = Decoded<typeof ledgerEntry>;

const publish = mutableStruct({ kind: Schema.Literal('publish'), package: ledgerPackage });
const wait = mutableStruct({ kind: Schema.Literal('wait'), until: Schema.Finite, reason: text });
const settled = mutableStruct({
	kind: Schema.Literal('settled'),
	entry: ledgerEntry,
	until: Schema.optional(Schema.Finite),
});
const done = mutableStruct({ kind: Schema.Literal('done'), entries: mutableArray(ledgerEntry) });

export const nextStep = Schema.Union([publish, wait, done]);
export type NextStep = Decoded<typeof nextStep>;
export const claimStep = Schema.Union([publish, wait, settled]);
export type ClaimStep = Decoded<typeof claimStep>;
export const settledStep = settled;
export const reportStep = Schema.Union([wait, settled]);
export type ReportStep = Decoded<typeof reportStep>;

export const publishNextRequest = mutableStruct({ executionId: text });
export const publishClaimRequest = mutableStruct({ executionId: text, purl: text, digest: text });
export const publishReportRequest = Schema.Union([
	mutableStruct({
		executionId: text,
		purl: text,
		outcome: Schema.Literal('published'),
		moveOn: Schema.optional(Schema.Literal(true)),
	}),
	mutableStruct({ executionId: text, purl: text, outcome: Schema.Literal('failed'), message: text }),
	mutableStruct({
		executionId: text,
		purl: text,
		outcome: Schema.Literal('rate-limited'),
		retryAfter: Schema.optional(text),
	}),
]);
export type PublishReport = Decoded<typeof publishReportRequest>;
