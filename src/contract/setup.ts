import { Effect, Schema, Struct } from 'effect';
import { supportedTargets } from '@/contract/binary-platforms';
import {
	jobKeyPattern,
	refPattern,
	tagPrefixPattern,
	validRef,
	validTagPrefix,
	workflowFilePattern,
} from '@/contract/catalog';
import { credentialAliasPattern, githubSecretNamePattern, identifierPattern } from '@/contract/ids';
import { approvalPolicies, startChannel, versionBump } from '@/contract/release-start';
import {
	existingTriggers,
	existingTriggersDescription,
	triggersOfExistingTriggers,
	versionPrMerge,
} from '@/contract/setup-terms';
import { versionFileSchema } from '@/contract/version-files';
import type { Decoded, Encoded } from '@/schema';
import {
	mapped,
	matchesPattern,
	mutableArray,
	mutableRecord,
	mutableStruct,
	refined,
	strictStruct,
	withValidation,
} from '@/schema';

export const defaultBinaryTargets = [
	'linux-amd64',
	'linux-arm64',
	'darwin-amd64',
	'darwin-arm64',
	'windows-amd64',
	'windows-arm64',
] as const;
export const binaryTargets = [
	...defaultBinaryTargets,
	'android-amd64',
	'android-arm64',
	'android-arm',
	'android-386',
	'freebsd-amd64',
	'freebsd-386',
	'freebsd-arm64',
	'netbsd-amd64',
	'netbsd-arm64',
	'openbsd-amd64',
	'openbsd-arm64',
	'dragonfly-amd64',
	'solaris-amd64',
	'illumos-amd64',
	'aix-ppc64',
] as const;
export type BinaryTarget = (typeof binaryTargets)[number];
const identifier = Schema.String.check(matchesPattern(identifierPattern));
const directory = refined(
	Schema.String.check(matchesPattern(/^(?:\.|[\w.-]+(?:\/[\w.-]+)*)$/)),
	value => !value.split('/').includes('..'),
	'Invalid directory',
);
const binaryName = Schema.String.check(matchesPattern(/^[A-Za-z0-9][\w.-]*$/));
export const assetPlaceholders = [
	'name',
	'version',
	'ext',
	'go.os',
	'go.arch',
	'rust.target',
	'node.platform',
	'node.arch',
	'uname.os',
	'uname.arch',
] as const;
export type AssetPlaceholder = (typeof assetPlaceholders)[number];
const asset = refined(
	Schema.String.check(matchesPattern(/^(?:[\w.-]|\{[\w.]+\})+$/)),
	value =>
		[...value.matchAll(/\{([\w.]+)\}/g)].every(([, key]) => assetPlaceholders.some(placeholder => placeholder === key)),
	'Unknown asset placeholder',
);
export const binaryBuild = Schema.Union([
	strictStruct(
		mutableStruct({
			toolchain: Schema.Literal('go'),
			name: binaryName,
			module: directory,
			package: refined(
				Schema.String.check(matchesPattern(/^\.(?:\/[\w.-]+)*$/)),
				value => !value.split('/').includes('..'),
				'Invalid package',
			).pipe(Schema.withDecodingDefault(Effect.succeed('.'))),
			asset: asset.pipe(Schema.withDecodingDefault(Effect.succeed('{name}-{go.os}-{go.arch}{ext}'))),
		}).fields,
	),
	strictStruct(
		mutableStruct({
			toolchain: Schema.Literal('cargo'),
			name: binaryName,
			manifest: refined(
				Schema.String.check(matchesPattern(/^(?:[\w.-]+\/)*Cargo\.toml$/)),
				value => !value.split('/').includes('..'),
				'Invalid manifest',
			),
			asset: asset.pipe(Schema.withDecodingDefault(Effect.succeed('{name}-{rust.target}{ext}'))),
		}).fields,
	),
]);
export type BinaryBuild = Decoded<typeof binaryBuild>;
export const binaries = withValidation(
	strictStruct(
		mutableStruct({
			builds: refined(
				mutableArray(binaryBuild).check(Schema.isMinLength(1)),
				builds => new Set(builds.map(build => build.name)).size === builds.length,
				'Binary names must be unique',
			),
			targets: refined(
				mutableArray(Schema.Literals(binaryTargets)).check(Schema.isMinLength(1)),
				targets => new Set(targets).size === targets.length,
				'Targets must be unique',
			).pipe(Schema.withDecodingDefault(Effect.succeed([...defaultBinaryTargets]))),
		}).fields,
	),
	(release, context) => {
		for (const build of release.builds) {
			for (const target of release.targets) {
				if (!supportedTargets(build.toolchain).includes(target)) {
					context.addIssue({
						code: 'custom',
						path: ['targets'],
						message: `${build.toolchain} has no build recipe for ${target}`,
					});
				}
			}
		}
	},
);
export type BinaryRelease = Decoded<typeof binaries>;
export interface BinaryCandidate {
	package: string;
	build: BinaryBuild;
	targets: BinaryTarget[];
	reason?: string;
}
export function leftOut(candidate: BinaryCandidate): string | undefined {
	return candidate.reason && `${candidate.build.name} leaves out Windows: ${candidate.reason}.`;
}
export function unbuildable(candidate: BinaryCandidate, targets: readonly BinaryTarget[]): BinaryTarget[] {
	return targets.filter(target => !candidate.targets.includes(target));
}
export const workflowTriggers = ['review', 'dispatchOnly', 'preserve'] as const;
export const streamVersionings = ['workspace', 'independent', 'none'] as const;
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
export const workflowSetup = mapped(
	strictStruct({
		...Struct.omit(workflow.fields, ['file', 'triggers']),
		...{
			existingTriggers: Schema.optional(existingTriggers).annotate({ description: existingTriggersDescription }),
			triggers: Schema.optional(Schema.Literals(workflowTriggers)).annotate({ deprecated: true }),
		},
	}),
	({ existingTriggers: handover, triggers, ...rest }) => ({
		...rest,
		triggers: handover ? triggersOfExistingTriggers[handover] : triggers ?? 'review',
	}),
).annotate({
	identifier: 'workflowSetup',
	description: 'Setup input that generates this workflow file. Change it through a setup update PR.',
});
export type WorkflowSetup = Decoded<typeof workflowSetup>;
export type WorkflowSetupInput = Encoded<typeof workflowSetup>;
export const actionsRevisionPattern = /^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/;
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
		...workflow.fields,
		...{
			name: refined(
				identifier,
				name => name !== 'prepare' && name !== 'promote',
				'prepare and promote are reserved operation names',
			),
			needs: mutableArray(identifier).check(Schema.isMinLength(1)),
			needsJobs: Schema.optional(
				mutableRecord(
					identifier,
					mutableArray(Schema.String.check(matchesPattern(jobKeyPattern))).check(Schema.isMinLength(1)),
				),
			),
			publications: mutableArray(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
		},
	}).fields,
);
export const setupWorkflow = workflow;
export const setupStream = strictStruct(
	mutableStruct({
		name: identifier,
		packages: mutableArray(Schema.String),
		versioning: Schema.Literals(streamVersionings),
		approval: Schema.optional(Schema.Literals(approvalPolicies)),
		start: Schema.optional(mutableArray(startChannel)),
		bump: Schema.optional(versionBump),
		versionPrMerge: Schema.optional(versionPrMerge),
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
		prepare: Schema.optional(workflow),
		promote: Schema.optional(workflow),
		operations: Schema.optional(mutableArray(operation)),
	}).fields,
);
type SetupStream = Decoded<typeof setupStream>;
export function bumpable(stream: SetupStream): boolean {
	return !!stream.promote && stream.versionSource?.kind !== 'tags';
}
export function startable(stream: SetupStream): boolean {
	return bumpable(stream) && stream.versioning !== 'independent';
}
export const setupChoicesSchema = strictStruct(
	mutableStruct({
		streams: mutableArray(setupStream),
		/** Full commit of the published Actions distribution, required for external actions. */
		actionsRevision: Schema.optional(Schema.String.check(matchesPattern(actionsRevisionPattern))),
	}).fields,
);
export type SetupChoices = Decoded<typeof setupChoicesSchema>;
