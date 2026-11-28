import { Schema } from 'effect';
import { textSchema as text } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

export const ledgerManagers = ['cargo', 'pypi', 'npm'] as const;
export const publishWaitMinutes = 30;
export type LedgerManager = (typeof ledgerManagers)[number];

const releasedLedgerStates = ['uploaded', 'published', 'reused'] as const;
const failedLedgerStates = ['failed-retryable', 'failed-permanent'] as const;
const openLedgerStates = ['planned', 'claimed', ...releasedLedgerStates, 'rate-limited'] as const;
export const ledgerStates = [...openLedgerStates, ...failedLedgerStates] as const;
export type LedgerState = (typeof ledgerStates)[number];

export function releasedState(state: LedgerState): boolean {
	return releasedLedgerStates.some(released => released === state);
}

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
	force: Schema.optional(Schema.Boolean),
});
export type LedgerPackage = Decoded<typeof ledgerPackage>;

export const ledgerEntry = Schema.Union([
	mutableStruct({ purl: text, required: Schema.Boolean, state: Schema.Literals(openLedgerStates) }),
	mutableStruct({ purl: text, required: Schema.Boolean, state: Schema.Literals(failedLedgerStates), error: text }),
]);
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
