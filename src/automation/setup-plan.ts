import { Effect, Schema } from 'effect';
import { publicationSchema } from '@/automation/package-publication';
import type { SetupOperation, SetupPlan, SetupWorkflow, WorkflowEvidence } from '@/automation/setup-types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { startChannel, versionBump } from '@/contract/release-start';
import { binaries, binaryBuild, binaryTargets } from '@/contract/setup';
import { versionPrMerge } from '@/contract/setup-terms';
import { versionFileSchema } from '@/contract/version-files';
import { stringsSchema as strings } from '@/model';
import { mapped, mutableArray, mutableStruct, safeDecode, schemaIssues, strictStruct } from '@/schema';

const workflowShape = mutableStruct({
	file: Schema.String,
	job: Schema.optional(Schema.String),
	triggers: Schema.Literals(['review', 'dispatchOnly', 'preserve']).annotate({ message: 'Invalid workflow triggers' }),
	commands: Schema.String,
	publicationSteps: Schema.Record(Schema.String, Schema.String),
	credentials: Schema.optional(Schema.Record(Schema.String, Schema.String)),
	tagPrefix: Schema.optional(Schema.String),
	binaries: Schema.optional(binaries),
});
const workflow: Schema.Codec<SetupWorkflow, unknown> = strictStruct(workflowShape.fields);
const operation: Schema.Codec<SetupOperation, unknown> = strictStruct(
	mutableStruct({
		...workflowShape.fields,
		...{
			name: Schema.String,
			needs: strings,
			needsJobs: Schema.optional(Schema.Record(Schema.String, strings)),
			publications: strings,
		},
	}).fields,
);
const publication = publicationSchema({
	publication: 'Invalid package publication',
	reason: 'Invalid exclusion reason',
});
const evidence: Schema.Codec<WorkflowEvidence, unknown> = mutableStruct({
	tagPatterns: Schema.optional(strings),
	file: Schema.String,
	jobs: strings,
	steps: mutableArray(mutableStruct({ job: Schema.String, id: Schema.String, label: Schema.String })),
	events: strings,
	roles: mutableArray(mutableStruct({ job: Schema.String, stream: Schema.String, operation: Schema.String })),
	preparationJobs: strings,
	reportingJobs: strings,
	jobObstacles: Schema.optional(Schema.Record(Schema.String, strings)),
	prepares: Schema.Boolean,
	reports: Schema.Boolean,
	publishes: Schema.Boolean,
});
const setupPlan: Schema.Codec<SetupPlan, unknown> = mutableStruct({
	publishingChecks: Schema.optional(mutableArray(mutableStruct({
		file: Schema.String,
		subject: Schema.String,
		status: Schema.Literals(['passed', 'action-required', 'failed']),
		message: Schema.String,
	}))),
	repository: Schema.String,
	sourceSha: Schema.String,
	planId: Schema.String,
	setupHead: Schema.NullOr(Schema.String),
	choices: strictStruct(
		mutableStruct({
			streams: mutableArray(strictStruct(
				mutableStruct({
					name: Schema.String,
					packages: strings,
					versioning: Schema.Literals(['workspace', 'independent', 'none']).annotate({ message: 'Invalid versioning' }),
					approval: Schema.optional(Schema.Literals(['required', 'merge', 'push'])),
					start: Schema.optional(mutableArray(startChannel)),
					bump: Schema.optional(versionBump),
					versionPrMerge: Schema.optional(versionPrMerge),
					required: strings,
					versionSource: Schema.optional(mutableStruct({ kind: Schema.Literal('tags'), prefix: Schema.String })),
					versionFiles: Schema.optional(mutableArray(versionFileSchema)),
					companionModules: Schema.optional(strings),
					observe: Schema.optional(mutableArray(strictStruct(
						mutableStruct({
							name: Schema.String,
							file: Schema.String,
							ref: Schema.optional(Schema.String),
							publications: strings,
							needs: Schema.optional(strings),
						}).fields,
					))),
					needs: Schema.optional(Schema.Record(Schema.String, mutableArray(Schema.String))),
					prepare: Schema.optional(workflow),
					promote: Schema.optional(workflow),
					operations: Schema.optional(mutableArray(operation)),
				}).fields,
			)),
			actionsRevision: Schema.optional(Schema.String),
		}).fields,
	),
	inventory: mutableStruct({
		packages: mutableArray(mutableStruct({
			name: Schema.String,
			manifest: Schema.String,
			publication,
			versionSource: Schema.optional(Schema.String),
			manager: Schema.optional(Schema.String),
		})),
		publicationOrder: Schema.optional(strings),
	}),
	preparation: Schema.optional(
		mutableStruct({ lockfiles: strings, versionFileStreams: strings, workflowStreams: strings }),
	),
	packageIds: strings,
	workflows: mutableArray(evidence),
	edits: mutableArray(mutableStruct({ path: Schema.String, before: Schema.String, after: Schema.String })),
	blockers: strings,
	notes: strings,
	adoption: Schema.optional(strings),
	binaryCandidates: Schema.optional(mutableArray(mutableStruct({
		package: Schema.String,
		build: binaryBuild,
		targets: mutableArray(Schema.Literals(binaryTargets)),
		reason: Schema.optional(Schema.String),
	}))),
	branchConflict: mapped(Schema.Unknown, Schema.Boolean, value => value === true, value => value),
	prior: Schema.optional(mutableStruct({ url: Schema.String, superseded: Schema.Boolean })),
});

export function parseSetupPlan(value: unknown): Effect.Effect<SetupPlan, DomainError> {
	const parsed = safeDecode(setupPlan, value);
	if (parsed.success) return Effect.succeed(parsed.data);
	const unknown =
		schemaIssues(parsed.error).flatMap(issue =>
			issue.code === 'unrecognized_keys' && issue.path[0] === 'choices' ? [issue] : []
		)[0];
	return Effect.fail(precondition(
		unknown
			? `The setup choices contain ${
				(unknown.keys ?? []).join(', ')
			}, which this beepboop version does not support. Upgrade beepboop and run the command again.`
			: schemaIssues(parsed.error)[0]?.message ?? 'Invalid setup plan',
	));
}
