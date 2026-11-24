import { Schema } from 'effect';
import { inboxEvent } from '@/github/webhooks.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { JournalLayout } from '@/persistence/durable/journal.ts';
import { journalSequence, outboxEntry } from '@/persistence/durable/journal.ts';
import { Keyspace, Singleton } from '@/persistence/durable/keyspace.ts';
import { ledgerSchema } from '@/publication/ledger.ts';
import { decodeEventV1, decodeExecutionV1 } from '@/release/domain/execution/codec-v1.ts';

export interface ReleaseSetRecord {
	target: string;
	ids: string[];
	workflowId?: string;
	started?: boolean;
	completed?: boolean;
}
const releaseSetRecord: Schema.Codec<ReleaseSetRecord, unknown> = mutableStruct({
	target: Schema.String,
	ids: mutableArray(Schema.String),
	workflowId: Schema.optional(Schema.String),
	started: Schema.optional(Schema.Boolean),
	completed: Schema.optional(Schema.Boolean),
});
const observation = mutableStruct({
	repositoryId: Schema.Finite,
	runId: Schema.Finite,
	due: Schema.optional(Schema.Finite),
	attempts: Schema.optional(Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
	error: Schema.optional(Schema.String),
});
export type Observation = Decoded<typeof observation>;
const releaseWake = Schema.Union([
	Schema.Literal(true),
	mutableStruct({ members: Schema.optional(mutableArray(Schema.String)), due: Schema.Finite }),
]);
export type ReleaseWake = Decoded<typeof releaseWake>;
export function wakeDue(wake: ReleaseWake): number {
	return wake === true ? 0 : wake.due;
}
const inboxEntry = mutableStruct({
	delivery: Schema.String.check(Schema.isMinLength(1)),
	repositoryId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	event: inboxEvent,
	attempts: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
	due: Schema.Finite,
	error: Schema.optional(Schema.String),
});
export type InboxEntry = Decoded<typeof inboxEntry>;
const quarantine = mutableStruct({ error: Schema.String, at: Schema.Finite });
const marker = Schema.Literal(true);

function decoder<S extends Schema.ConstraintDecoder<unknown>>(schema: S): (value: unknown) => S['Type'] {
	return value => decodeSync(schema, value);
}

export const Keys = {
	execution: Keyspace.make('execution:', decodeExecutionV1),
	releaseSet: Keyspace.make('release-set:', decoder(releaseSetRecord)),
	release: Keyspace.make('release:', decodeEventV1),
	outbox: Keyspace.make('outbox:', decoder(outboxEntry)),
	sequence: Singleton.make('journal:seq', decoder(journalSequence)),
	ledger: Keyspace.make('ledger:', decoder(ledgerSchema)),
	releaseWake: Keyspace.make('release-wake:', decoder(releaseWake)),
	releaseEvent: Keyspace.make('release-event:', decodeEventV1),
	releaseEmitted: Keyspace.make('release-emitted:', decoder(marker)),
	subscriptionIssue: Keyspace.make('subscription-issue:', decoder(marker)),
	observe: Keyspace.make('observe:', decoder(observation)),
	track: Keyspace.make('track:', decoder(observation)),
	observeDead: Keyspace.make('observe-dead:', decoder(observation)),
	trackDead: Keyspace.make('track-dead:', decoder(observation)),
	inbox: Keyspace.make('inbox:', decoder(inboxEntry)),
	inboxDead: Keyspace.make('inbox-dead:', decoder(inboxEntry)),
	quarantine: Keyspace.make('quarantine:', decoder(quarantine)),
	reconcileAt: Singleton.make('reconcile-at', decoder(Schema.NullOr(Schema.Finite))),
	setupEdit: Singleton.make('setup-edit', (value: unknown) => value),
};

export const journalLayout: JournalLayout = {
	entities: { execution: Keys.execution, 'release-set': Keys.releaseSet, release: Keys.release },
	outbox: Keys.outbox,
	sequence: Keys.sequence,
};
