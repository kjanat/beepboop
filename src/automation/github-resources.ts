import { Schema } from 'effect';
import { countSchema, looseSchema, shaSchema, textSchema } from '@/model';
import type { Decoded } from '@/schema';
import { mutableArray, mutableStruct } from '@/schema';

const identified = mutableStruct({ id: Schema.Finite });
const verification = mutableStruct({ verified: looseSchema });

export const appSchema = mutableStruct({ slug: textSchema });
export const userSchema = mutableStruct({ login: looseSchema, type: looseSchema, id: countSchema });
export const installationSchema = mutableStruct({
	id: countSchema,
	account: mutableStruct({ id: countSchema, login: textSchema }),
	suspended_at: looseSchema,
	permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export const accessTokenSchema = mutableStruct({ token: textSchema });
export const repositorySchema = mutableStruct({
	id: countSchema,
	full_name: Schema.String,
	owner: identified,
	default_branch: textSchema,
});
export const commitSchema = mutableStruct({ sha: shaSchema, commit: mutableStruct({ verification }) });
export const gitObjectSchema = mutableStruct({ sha: shaSchema, type: Schema.String });
export type GitObject = Decoded<typeof gitObjectSchema>;
export const gitRefSchema = mutableStruct({ object: gitObjectSchema });
export const gitTagSchema = mutableStruct({
	object: gitObjectSchema,
	tag: looseSchema,
	verification: Schema.optional(verification),
});
export const gitCommitSchema = mutableStruct({
	tree: mutableStruct({ sha: shaSchema }),
	parents: mutableArray(mutableStruct({ sha: looseSchema })),
	verification,
});
export const createdSchema = mutableStruct({ sha: shaSchema });
export const treeSchema = mutableStruct({
	truncated: looseSchema,
	tree: mutableArray(mutableStruct({ path: textSchema, type: textSchema, mode: textSchema })),
});
export const contentSchema = mutableStruct({ encoding: looseSchema, content: looseSchema, size: looseSchema });
export const namedSchema = mutableStruct({ name: textSchema });
export const matchingRefSchema = mutableStruct({ ref: textSchema });
export const ruleSchema = mutableStruct({ type: looseSchema });
export const comparisonSchema = mutableStruct({
	status: looseSchema,
	ahead_by: looseSchema,
	merge_base_commit: mutableStruct({ sha: shaSchema }),
	commits: mutableArray(
		mutableStruct({ sha: looseSchema, author: identified, commit: mutableStruct({ verification }) }),
	),
	files: mutableArray(mutableStruct({ filename: looseSchema })),
});
export const pullSchema = mutableStruct({
	number: countSchema,
	node_id: textSchema,
	html_url: textSchema,
	state: looseSchema,
	merged: looseSchema,
	merged_at: looseSchema,
	title: looseSchema,
	body: looseSchema,
	assignees: Schema.optional(Schema.NullOr(mutableArray(mutableStruct({ login: Schema.String })))),
	requested_reviewers: Schema.optional(Schema.NullOr(mutableArray(mutableStruct({ login: Schema.String })))),
	head: mutableStruct({ ref: Schema.String, sha: shaSchema, repo: identified }),
	base: mutableStruct({ ref: textSchema, repo: mutableStruct({ id: Schema.Finite, default_branch: textSchema }) }),
});
export const issueEventSchema = mutableStruct({ event: looseSchema, commit_id: looseSchema });
export const workflowRunSchema = mutableStruct({
	id: countSchema,
	repository: identified,
	display_title: textSchema,
	path: textSchema,
	event: looseSchema,
	status: looseSchema,
	conclusion: looseSchema,
	head_sha: shaSchema,
	head_branch: looseSchema,
	run_attempt: countSchema,
});
export type WorkflowRun = Decoded<typeof workflowRunSchema>;
export const workflowRunsSchema = mutableStruct({ workflow_runs: mutableArray(workflowRunSchema) });
export const workflowJobsSchema = mutableStruct({
	total_count: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
	jobs: mutableArray(mutableStruct({
		name: Schema.String,
		status: Schema.String,
		conclusion: Schema.NullOr(Schema.String),
		started_at: Schema.optional(Schema.NullOr(Schema.String)),
		completed_at: Schema.optional(Schema.NullOr(Schema.String)),
	})),
});
export const dispatchSchema = Schema.NullOr(mutableStruct({ workflow_run_id: Schema.optional(countSchema) }));
const assetSchema = mutableStruct({ id: countSchema, name: textSchema, state: looseSchema, content_type: textSchema });
export const releaseSchema = mutableStruct({
	id: countSchema,
	tag_name: looseSchema,
	target_commitish: looseSchema,
	draft: looseSchema,
	prerelease: looseSchema,
	html_url: looseSchema,
	author: identified,
	assets: mutableArray(assetSchema),
});
export type GitHubRelease = Decoded<typeof releaseSchema>;
export const releaseNotesSchema = mutableStruct({ body: Schema.String });
export const artifactSchema = mutableStruct({
	workflow_run: identified,
	expired: looseSchema,
	name: looseSchema,
	digest: looseSchema,
	expires_at: looseSchema,
});
export const checkRunsSchema = mutableStruct({
	total_count: looseSchema,
	check_runs: mutableArray(
		mutableStruct({ name: looseSchema, status: looseSchema, conclusion: looseSchema, details_url: looseSchema }),
	),
});
export const commitStatusSchema = mutableStruct({ state: looseSchema, total_count: looseSchema });
