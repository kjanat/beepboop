import type { CLIError, Out } from '@kjanat/dreamcli';
import { Effect, Schema } from 'effect';
import type { Look } from '@/cli/render/look';
import { registryOf, table } from '@/cli/render/look';
import { failure } from '@/cli/render/output';
import type { ResponseOf, routes } from '@/contract/routes';
import { packageLabel } from '@/domain/package-label';
import { approvalPolicies, versionBump } from '@/domain/release-start.ts';
import type { AutoMergeMethod, VersionPrMerge } from '@/domain/setup-terms.ts';
import {
	publishWhenNames,
	publishWhenSentences,
	streamVersioning,
	versionPrMerge,
	versionPrMergeSentences,
} from '@/domain/setup-terms.ts';
import { decodeWith } from '@/kernel/schema/decode.ts';
import { shaSchema } from '@/kernel/schema/result.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableArray, mutableStruct, schemaIssues } from '@/kernel/schema/structs.ts';

export const streamSchema = looseStruct({
	versioning: Schema.Literals(streamVersioning),
	packages: Schema.optional(mutableArray(Schema.String)),
	versionSource: Schema.optional(mutableStruct({ kind: Schema.Literal('tags') })),
	versionFiles: Schema.optional(mutableArray(Schema.Unknown)),
	prepare: looseStruct({
		strategy: Schema.optional(Schema.String),
		workflow: Schema.optional(mutableStruct({ file: Schema.String })),
		bump: Schema.optional(versionBump),
		versionPrMerge: Schema.optional(versionPrMerge),
	}),
	promote: looseStruct({
		approval: Schema.Literals(approvalPolicies),
		workflow: Schema.optional(mutableStruct({ file: Schema.String })),
	}),
});
export const summarySchema = looseStruct({
	version: Schema.String.check(Schema.isMinLength(1)),
	sourceSha: shaSchema,
	planId: Schema.String.check(Schema.isMinLength(1)),
	packages: Schema.optional(
		mutableArray(
			mutableStruct({ name: Schema.String, manager: Schema.String, version: Schema.optional(Schema.String) }),
		),
	),
	blockers: Schema.optional(mutableArray(Schema.String)),
});
export function decodeRelease<S extends Contract>(schema: S, value: unknown): Effect.Effect<Decoded<S>, CLIError> {
	return decodeWith(
		schema,
		value,
		error =>
			failure('Server returned an invalid release description', 'INVALID_RESPONSE', schemaIssues(error)[0]?.message),
	);
}

export interface ReleaseOptions {
	repository?: string;
	stream?: string;
	version?: string;
	yes: boolean;
	dryRun: boolean;
	force: boolean;
	auto?: boolean | undefined;
	merge?: AutoMergeMethod | undefined;
}

export function versionPrMergeOf(
	options: ReleaseOptions,
	configured: VersionPrMerge | undefined,
): Effect.Effect<VersionPrMerge | undefined, CLIError> {
	if (options.auto === false) {
		return options.merge
			? Effect.fail(failure('--no-auto turns auto-merge off, and --merge turns it on', 'INVALID_FLAGS'))
			: Effect.succeed('manual');
	}
	if (options.merge) return Effect.succeed(options.merge);
	if (options.auto) return Effect.succeed(configured && configured !== 'manual' ? configured : 'squash');
	return Effect.undefined;
}

interface ReleasePreview {
	repository: { name: string; defaultBranch: string };
	stream: string;
	config: Decoded<typeof streamSchema>;
	summary: Decoded<typeof summarySchema>;
	plan: ResponseOf<typeof routes.releasesPlan>;
	release: { summary: string };
	started: boolean;
	pending: boolean;
	direct: boolean;
	committing: boolean;
	merging: VersionPrMerge | undefined;
}

export function printPreview(out: Out, look: Look, preview: ReleasePreview): void {
	const { repository, stream: selected, config: stream, summary, plan, release } = preview;
	const { started, pending, direct, committing, merging } = preview;
	const policy = stream.promote.approval;
	const after = committing
		? `After Beepboop commits it to ${repository.defaultBranch}`
		: 'After the version PR merges';
	const publishing = `\`publishWhen: ${publishWhenNames[policy]}\`: ${publishWhenSentences[policy]}`;
	out.log(
		look.heading(
			`Release ${look.pkg(repository.name)} / ${selected} → ${look.version(summary.version)}`,
		),
	);
	if (!started && pending && stream.versionSource?.kind !== 'tags') {
		out.log(`This prepares ${look.version(summary.version)}. ${after}, ${publishing}`);
	}
	out.log(`Source: ${repository.defaultBranch} at ${look.sha(summary.sourceSha)}`);
	out.log(
		look.note(
			'The server plans from the repository default branch. Local branch commits and uncommitted files are not included.',
		),
	);
	if (summary.packages?.length) {
		table(
			out,
			summary.packages.map(pkg => ({
				package: look.pkg(pkg.name),
				registry: registryOf(pkg.manager),
				current: pkg.version ?? 'unknown',
				release: look.version(summary.version),
			})),
		);
	} else if (stream.packages?.length) {
		table(
			out,
			stream.packages.map(id => ({
				package: look.pkg(packageLabel(id)),
				current: direct ? 'read from tags' : 'determined by preparation workflow',
				release: look.version(summary.version),
			})),
		);
	} else if (!direct) out.log('The configured preparation workflow determines the package versions.');
	for (const note of plan.diagnostics ?? []) out.log(look.note(note));
	for (const edit of plan.edits) out.log(`\n${edit.path}\nCurrent:\n${edit.before}\nProposed:\n${edit.after}`);
	if (merging) out.log(`Version PR: ${versionPrMergeSentences[merging].replaceAll('`', '')}`);
	if (direct) out.log(release.summary);
	else if (!pending) {
		out.log(
			`${repository.defaultBranch} already carries ${look.version(summary.version)}. ${
				started ? 'Starting publishes it.' : 'This creates its publication run.'
			}`,
		);
	}
}
