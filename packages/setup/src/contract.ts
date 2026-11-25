import { Effect, Schema } from 'effect';
import {
	jobKeyPattern,
	refPattern,
	tagPrefixPattern,
	validRef,
	validTagPrefix,
	workflowFilePattern,
} from '@/domain/catalog.ts';
import { approvalPolicies, startChannel, versionBump } from '@/domain/release-start.ts';
import { versionPrMerge } from '@/domain/setup-terms.ts';
import { versionFileSchema } from '@/domain/version-files.ts';
import { actionsRevisionPattern, setupWorkflow } from '@/domain/workflow-setup.ts';
import { identifierPattern } from '@/kernel/schema/ids.ts';
import { textSchema as text } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import {
	looseStruct,
	matchesPattern,
	mutableArray,
	mutableRecord,
	mutableStruct,
	refined,
	strictStruct,
} from '@/kernel/schema/structs.ts';

const identifier = Schema.String.check(matchesPattern(identifierPattern));
export const streamVersionings = ['workspace', 'independent', 'none'] as const;
const observed = strictStruct(
	mutableStruct({
		name: identifier,
		file: Schema.String.check(matchesPattern(workflowFilePattern)),
		ref: Schema.optional(refined(Schema.String.check(matchesPattern(refPattern)), validRef, 'Invalid workflow ref')),
		publications: mutableArray(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
		needs: Schema.optional(mutableArray(identifier)),
	}).fields,
);
const operation = strictStruct(
	mutableStruct({
		...setupWorkflow.fields,
		...{
			name: refined(
				identifier,
				name => name !== 'prepare' && name !== 'promote',
				'prepare and promote are reserved operation names',
			),
			backfill: Schema.optional(Schema.Literal(true)),
			needs: mutableArray(identifier),
			needsJobs: Schema.optional(
				mutableRecord(
					identifier,
					mutableArray(Schema.String.check(matchesPattern(jobKeyPattern))).check(Schema.isMinLength(1)),
				),
			),
			publications: mutableArray(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
		},
	}).fields,
).check(Schema.makeFilter(operation =>
	operation.backfill
		? (operation.needs.length === 0 && !operation.needsJobs
			? undefined
			: 'A backfill cannot depend on release operations')
		: (operation.needs.length > 0 ? undefined : 'Select a dependency or enable backfill')
));
/** Opt in to immutable patch releases and mutable major/minor action refs. */
export const actionRelease = Schema.Union([
	strictStruct({ kind: Schema.Literal('source') }),
	strictStruct({
		kind: Schema.Literal('distribution'),
		files: mutableArray(refined(
			Schema.String,
			value =>
				/^(?:[\w.-]+\/)*[\w.-]+$/.test(value)
				&& !value.split('/').some(part => part === '.' || part === '..' || part === '.git'),
			'Use exact repository-relative distribution file paths',
		)).check(Schema.isMinLength(1)),
	}),
]);
export const setupStream = strictStruct(
	mutableStruct({
		name: identifier,
		packages: mutableArray(Schema.String),
		versioning: Schema.Literals(streamVersionings),
		approval: Schema.optional(Schema.Literals(approvalPolicies)),
		start: Schema.optional(mutableArray(startChannel)),
		bump: Schema.optional(versionBump),
		versionPrMerge: Schema.optional(versionPrMerge),
		actionRelease: Schema.optional(actionRelease),
		required: mutableArray(Schema.String),
		versionSource: Schema.optional(strictStruct(
			mutableStruct({
				kind: Schema.Literal('tags'),
				prefix: refined(Schema.String.check(matchesPattern(tagPrefixPattern)), validTagPrefix, 'Invalid tag prefix'),
			}).fields,
		)),
		versionFiles: Schema.optional(mutableArray(versionFileSchema)),
		companionModules: Schema.optional(mutableArray(Schema.String)),
		observe: Schema.optional(mutableArray(observed)),
		needs: Schema.optional(mutableRecord(Schema.String, mutableArray(Schema.String))),
		prepare: Schema.optional(setupWorkflow),
		promote: Schema.optional(setupWorkflow),
		operations: Schema.optional(mutableArray(operation)),
	}).fields,
);
type SetupStream = Decoded<typeof setupStream>;
export function bumpable(stream: SetupStream): boolean {
	return !!stream.promote && stream.versionSource?.kind !== 'tags';
}
export function startable(stream: SetupStream): boolean {
	return !!stream.promote && stream.versioning !== 'independent';
}
export const setupChoicesSchema = strictStruct(
	mutableStruct({
		streams: mutableArray(setupStream),
		/** Full commit of the published Actions distribution, required for external actions. */
		actionsRevision: Schema.optional(Schema.String.check(matchesPattern(actionsRevisionPattern))),
	}).fields,
);
export type SetupChoices = Decoded<typeof setupChoicesSchema>;
export const setupPreviewRequest = mutableStruct({ repository: text, choices: Schema.optional(Schema.Unknown) });
export const setupApplyRequest = mutableStruct({
	repository: text,
	choices: Schema.optional(Schema.Unknown),
	planId: Schema.String,
	sourceSha: Schema.String,
	setupHead: Schema.NullOr(Schema.String),
	takeOver: Schema.optional(Schema.Boolean),
});
export const setupApplyResponse = looseStruct({ url: Schema.String });
