import { Effect, Schema, Struct } from 'effect';
import { binaries } from '@/contract/binary-platforms';
import { tagPrefixPattern, validTagPrefix, workflowFilePattern } from '@/contract/catalog';
import { existingTriggers, existingTriggersDescription, triggersOfExistingTriggers } from '@/contract/setup-terms';
import { credentialAliasPattern, githubSecretNamePattern } from '@/kernel/schema/ids.ts';
import type { Decoded, Encoded } from '@/kernel/schema/structs.ts';
import {
	mapped,
	matchesPattern,
	mutableRecord,
	mutableStruct,
	refined,
	strictStruct,
} from '@/kernel/schema/structs.ts';

export const workflowTriggers = ['review', 'dispatchOnly', 'preserve'] as const;
const workflow = strictStruct(
	mutableStruct({
		file: Schema.String.check(matchesPattern(workflowFilePattern)),
		job: Schema.optional(Schema.String),
		triggers: Schema.Literals(workflowTriggers).pipe(Schema.withDecodingDefault(Effect.succeed('review'))),
		commands: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(''))),
		/** Map publication identities to existing step IDs, for accurate outcome reporting. */
		publicationSteps: mutableRecord(Schema.String, Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
		/** Environment variable name to stored credential alias, for the setup commands step. */
		credentials: Schema.optional(
			mutableRecord(
				Schema.String.check(matchesPattern(githubSecretNamePattern)),
				Schema.String.check(matchesPattern(credentialAliasPattern)),
			),
		),
		/** Prefix of the version tag the publication workflow pushes, such as `v` or `cli-v`. */
		tagPrefix: Schema.optional(
			refined(Schema.String.check(matchesPattern(tagPrefixPattern)), validTagPrefix, 'Invalid tag prefix'),
		),
		binaries: Schema.optional(binaries),
	}).fields,
);
export const workflowSetupValue = Schema.toType(strictStruct({
	...Struct.omit(workflow.fields, ['file', 'triggers']),
	triggers: Schema.Literals(workflowTriggers),
}));
export const workflowSetup = mapped(
	strictStruct({
		...Struct.omit(workflow.fields, ['file', 'triggers']),
		...{
			existingTriggers: Schema.optional(existingTriggers).annotate({ description: existingTriggersDescription }),
			triggers: Schema.optional(Schema.Literals(workflowTriggers)).annotate({ deprecated: true }),
		},
	}),
	workflowSetupValue,
	({ existingTriggers: handover, triggers, ...rest }) => ({
		...rest,
		triggers: handover ? triggersOfExistingTriggers[handover] : triggers ?? 'review',
	}),
	value => value,
).annotate({
	identifier: 'workflowSetup',
	description: 'Setup input that generates this workflow file. Change it through a setup update PR.',
});
export type WorkflowSetup = Decoded<typeof workflowSetup>;
export type WorkflowSetupInput = Encoded<typeof workflowSetup>;
export const actionsRevisionPattern = /^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/;
export const setupWorkflow = workflow;
