import { z } from 'zod';

export const ledgerManagers = ['cargo', 'pypi', 'npm'] as const;
export const publishWaitMinutes = 30;
export type LedgerManager = (typeof ledgerManagers)[number];

export const ledgerStates = [
	'planned',
	'claimed',
	'published',
	'reused',
	'rate-limited',
	'failed-retryable',
	'failed-permanent',
] as const;
export type LedgerState = (typeof ledgerStates)[number];

const text = z.string().min(1);

export const ledgerPackage = z.object({
	purl: text,
	id: text,
	manager: z.enum(ledgerManagers),
	name: text,
	version: text,
	manifest: text,
	required: z.boolean(),
	channel: text.optional(),
});
export type LedgerPackage = z.output<typeof ledgerPackage>;

export const ledgerEntry = z.object({
	purl: text,
	required: z.boolean(),
	state: z.enum(ledgerStates),
	error: text.optional(),
});
export type LedgerEntry = z.output<typeof ledgerEntry>;

const publish = z.object({ kind: z.literal('publish'), package: ledgerPackage });
const wait = z.object({ kind: z.literal('wait'), until: z.number(), reason: text });
const settled = z.object({ kind: z.literal('settled'), entry: ledgerEntry, until: z.number().optional() });
const done = z.object({ kind: z.literal('done'), entries: z.array(ledgerEntry) });

export const nextStep = z.discriminatedUnion('kind', [publish, wait, done]);
export type NextStep = z.output<typeof nextStep>;
export const claimStep = z.discriminatedUnion('kind', [publish, wait, settled]);
export type ClaimStep = z.output<typeof claimStep>;
export const reportStep = z.discriminatedUnion('kind', [wait, settled]);
export type ReportStep = z.output<typeof reportStep>;

export const publishNextRequest = z.object({ executionId: text });
export const publishClaimRequest = z.object({ executionId: text, purl: text, digest: text });
export const publishReportRequest = z.discriminatedUnion('outcome', [
	z.object({ executionId: text, purl: text, outcome: z.literal('published') }),
	z.object({ executionId: text, purl: text, outcome: z.literal('failed'), message: text }),
	z.object({ executionId: text, purl: text, outcome: z.literal('rate-limited'), retryAfter: text.optional() }),
]);
export type PublishReport = z.output<typeof publishReportRequest>;
