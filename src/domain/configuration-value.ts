import { Effect, Schema } from 'effect';
import { inputSchema, outputSchema, platformSchema } from '@/automation/outputs';
import { managerNames } from '@/contract/catalog';
import { releaseStart, versionBump } from '@/contract/release-start';
import { workflowSetupValue } from '@/contract/setup';
import { versionPrMerges } from '@/contract/setup-terms';
import { versionFileSchema } from '@/contract/version-files';
import { stringsSchema as strings } from '@/model';
import { mutableArray, mutableRecord, mutableStruct } from '@/schema';

const managerName = Schema.Literals(managerNames);

export const refPolicyValue = mutableStruct({
	phase: Schema.Literals(['version', 'aliases']),
	prefix: Schema.String,
	aliases: mutableArray(Schema.Literals(['major', 'minor'])),
	signed: Schema.Boolean,
});
const binding = {
	outputs: Schema.optional(mutableArray(outputSchema)),
	artifactInputs: Schema.optional(mutableArray(inputSchema)),
	platform: Schema.optional(platformSchema),
	refs: Schema.optional(refPolicyValue),
	mode: Schema.optional(Schema.Literals(['observe', 'dispatch'])),
	each: Schema.optional(Schema.Literal('package')),
	needs: Schema.optional(strings),
	needsJobs: Schema.optional(mutableRecord(Schema.String, strings)),
	publications: Schema.optional(strings),
	schedule: Schema.optional(Schema.String),
	file: Schema.String,
	ref: Schema.optional(Schema.String),
	inputs: mutableRecord(Schema.String, Schema.Union([Schema.String, Schema.Boolean, Schema.Finite])).pipe(
		Schema.withDecodingDefault(Effect.succeed({})),
	),
	required: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
	setup: Schema.optional(workflowSetupValue),
};
export const bindingValue = mutableStruct(binding);
export const streamValue = mutableStruct({
	versionFiles: Schema.optional(mutableArray(versionFileSchema)),
	versionSource: Schema.optional(mutableStruct({ kind: Schema.Literal('tags'), prefix: Schema.String })),
	packages: Schema.optional(strings),
	companionModules: Schema.optional(strings),
	versioning: Schema.Literals(['workspace', 'independent', 'none']),
	concurrency: Schema.Literals(['queue', 'supersede-pending']),
	prepare: mutableStruct({
		strategy: Schema.optional(Schema.Literals(['managed', 'workflow'])),
		version: Schema.Literal('manual'),
		workflow: Schema.optional(bindingValue),
		bump: Schema.optional(versionBump),
		versionPrMerge: Schema.optional(Schema.Literals(versionPrMerges)),
	}),
	promote: mutableStruct({
		approval: Schema.Literals(['required', 'merge', 'push']),
		workflow: Schema.optional(bindingValue),
	}),
	start: Schema.optional(mutableArray(releaseStart)),
	workflows: mutableRecord(Schema.String, bindingValue),
	required: strings,
	needs: Schema.optional(mutableRecord(Schema.String, strings)),
	credentials: strings,
	channels: mutableStruct({ stable: Schema.String, prerelease: Schema.String }),
});
export const subscriptionValue = mutableStruct({
	id: Schema.String,
	sourceStream: Schema.optional(Schema.String),
	sourceGroup: Schema.optional(Schema.String),
	publication: Schema.optional(Schema.String),
	source: Schema.String,
	event: Schema.Literals(['release', 'package.version.changed', 'workflow_run']),
	stream: Schema.String,
	operation: Schema.String,
	workflow: Schema.optional(Schema.String),
});
export const wingetValue = mutableStruct({
	config: Schema.String,
	tagPrefix: Schema.String,
	automatic: Schema.Boolean,
});
export const configurationValue = mutableStruct({
	actionsRevision: Schema.optional(Schema.String),
	winget: Schema.optional(wingetValue),
	extends: strings,
	managers: mutableArray(managerName),
	streams: mutableRecord(Schema.String, streamValue),
	subscriptions: mutableArray(subscriptionValue),
});
