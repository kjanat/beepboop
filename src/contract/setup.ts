import { z } from 'zod';
import {
	jobKeyPattern,
	refPattern,
	tagPrefixPattern,
	validRef,
	validTagPrefix,
	workflowFilePattern,
} from '@/contract/catalog';
import { credentialAliasPattern } from '@/contract/ids';
import { versionFileSchema } from '@/contract/version-files';

export const binaryTargets = [
	'linux-amd64',
	'linux-arm64',
	'darwin-amd64',
	'darwin-arm64',
	'windows-amd64',
	'windows-arm64',
] as const;
export type BinaryTarget = (typeof binaryTargets)[number];
const directory = z.string().regex(/^(?:\.|[\w.-]+(?:\/[\w.-]+)*)$/).refine(
	value => !value.split('/').includes('..'),
	'Invalid directory',
);
const binaryName = z.string().regex(/^[A-Za-z0-9][\w.-]*$/);
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
const asset = z.string().regex(/^(?:[\w.-]|\{[\w.]+\})+$/).refine(
	value =>
		[...value.matchAll(/\{([\w.]+)\}/g)].every(([, key]) => assetPlaceholders.some(placeholder => placeholder === key)),
	'Unknown asset placeholder',
);
const binaryBuild = z.discriminatedUnion('toolchain', [
	z.object({
		toolchain: z.literal('go'),
		name: binaryName,
		module: directory,
		package: z.string().regex(/^\.(?:\/[\w.-]+)*$/).refine(value => !value.split('/').includes('..'), 'Invalid package')
			.default('.'),
		asset: asset.default('{name}-{go.os}-{go.arch}{ext}'),
	}).strict(),
	z.object({
		toolchain: z.literal('cargo'),
		name: binaryName,
		manifest: z.string().regex(/^(?:[\w.-]+\/)*Cargo\.toml$/).refine(
			value => !value.split('/').includes('..'),
			'Invalid manifest',
		),
		asset: asset.default('{name}-{rust.target}{ext}'),
	}).strict(),
]);
export type BinaryBuild = z.infer<typeof binaryBuild>;
export const binaries = z.object({
	builds: z.array(binaryBuild).min(1).refine(
		builds => new Set(builds.map(build => build.name)).size === builds.length,
		'Binary names must be unique',
	),
	targets: z.array(z.enum(binaryTargets)).min(1).refine(
		targets => new Set(targets).size === targets.length,
		'Targets must be unique',
	).default([...binaryTargets]),
}).strict();
export type BinaryRelease = z.infer<typeof binaries>;
const workflow = z.object({
	file: z.string().regex(workflowFilePattern),
	job: z.string().optional(),
	triggers: z.enum(['review', 'dispatchOnly', 'preserve']).default('review'),
	commands: z.string().default(''),
	/** Map publication identities to existing step IDs, for accurate outcome reporting. */
	publicationSteps: z.record(z.string(), z.string()).default({}),
	/** Environment variable name to stored credential alias, for the setup commands step. */
	credentials: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().regex(credentialAliasPattern)).optional(),
	/** Prefix of the version tag the publication workflow pushes, such as `v` or `cli-v`. */
	tagPrefix: z.string().regex(tagPrefixPattern).refine(validTagPrefix, 'Invalid tag prefix').optional(),
	binaries: binaries.optional(),
}).strict();
const observed = z.object({
	name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
	file: z.string().regex(workflowFilePattern),
	ref: z.string().regex(refPattern).refine(validRef, 'Invalid workflow ref').optional(),
	publications: z.array(z.string()).default([]),
	needs: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).optional(),
}).strict();
const operation = workflow.extend({
	name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).refine(
		name => name !== 'prepare' && name !== 'promote',
		'prepare and promote are reserved operation names',
	),
	needs: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(1),
	needsJobs: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), z.array(z.string().regex(jobKeyPattern)).min(1))
		.optional(),
	publications: z.array(z.string()).default([]),
}).strict();
export const setupChoicesSchema = z.object({
	streams: z.array(
		z.object({
			name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
			packages: z.array(z.string()),
			versioning: z.enum(['workspace', 'independent', 'none']),
			approval: z.enum(['required', 'merge', 'push']).optional(),
			required: z.array(z.string()),
			versionSource: z.object({
				kind: z.literal('tags'),
				prefix: z.string().regex(tagPrefixPattern).refine(validTagPrefix, 'Invalid tag prefix'),
			}).strict()
				.optional(),
			versionFiles: z.array(versionFileSchema).optional(),
			observe: z.array(observed).optional(),
			needs: z.record(z.string(), z.array(z.string())).optional(),
			prepare: workflow.optional(),
			promote: workflow.optional(),
			operations: z.array(operation).optional(),
		}).strict(),
	),
	/** Full commit of the published Actions distribution, required for external actions. */
	actionsRevision: z.string().regex(/^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/).optional(),
}).strict();
export type SetupChoices = z.infer<typeof setupChoicesSchema>;
