import { z } from 'zod';
import { countSchema, looseSchema, shaSchema, textSchema } from '@/model';

const identified = z.object({ id: z.number() });
const verification = z.object({ verified: looseSchema });

export const appSchema = z.object({ slug: textSchema });
export const userSchema = z.object({ login: looseSchema, type: looseSchema, id: countSchema });
export const installationSchema = z.object({
	id: countSchema,
	account: z.object({ id: countSchema, login: textSchema }),
	suspended_at: looseSchema,
});
export const accessTokenSchema = z.object({ token: textSchema });
export const repositorySchema = z.object({
	id: countSchema,
	full_name: z.string(),
	owner: identified,
	default_branch: textSchema,
});
export const commitSchema = z.object({ sha: shaSchema, commit: z.object({ verification }) });
export const gitObjectSchema = z.object({ sha: shaSchema, type: z.string() });
export const gitRefSchema = z.object({ object: gitObjectSchema });
export const gitTagSchema = z.object({
	object: gitObjectSchema,
	tag: looseSchema,
	verification: verification.optional(),
});
export const gitCommitSchema = z.object({
	tree: z.object({ sha: shaSchema }),
	parents: z.array(z.object({ sha: looseSchema })),
	verification,
});
export const createdSchema = z.object({ sha: shaSchema });
export const treeSchema = z.object({
	truncated: looseSchema,
	tree: z.array(z.object({ path: textSchema, type: textSchema, mode: textSchema })),
});
export const contentSchema = z.object({ encoding: looseSchema, content: looseSchema, size: looseSchema });
export const namedSchema = z.object({ name: textSchema });
export const matchingRefSchema = z.object({ ref: textSchema });
export const ruleSchema = z.object({ type: looseSchema });
export const comparisonSchema = z.object({
	status: looseSchema,
	ahead_by: looseSchema,
	merge_base_commit: z.object({ sha: shaSchema }),
	commits: z.array(z.object({ sha: looseSchema, author: identified, commit: z.object({ verification }) })),
	files: z.array(z.object({ filename: looseSchema })),
});
export const pullSchema = z.object({
	number: countSchema,
	html_url: textSchema,
	state: looseSchema,
	merged: looseSchema,
	merged_at: looseSchema,
	body: looseSchema,
	head: z.object({ ref: z.string(), sha: shaSchema, repo: identified }),
	base: z.object({ ref: textSchema, repo: z.object({ id: z.number(), default_branch: textSchema }) }),
});
export const issueEventSchema = z.object({ event: looseSchema, commit_id: looseSchema });
export const workflowRunSchema = z.object({
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
export const workflowRunsSchema = z.object({ workflow_runs: z.array(workflowRunSchema) });
export const dispatchSchema = z.object({ workflow_run_id: countSchema.optional() }).nullable();
const assetSchema = z.object({ id: countSchema, name: textSchema, state: looseSchema, content_type: textSchema });
export const releaseSchema = z.object({
	id: countSchema,
	tag_name: looseSchema,
	target_commitish: looseSchema,
	draft: looseSchema,
	prerelease: looseSchema,
	html_url: looseSchema,
	author: identified,
	assets: z.array(assetSchema),
});
export type GitHubRelease = z.output<typeof releaseSchema>;
export const artifactSchema = z.object({
	workflow_run: identified,
	expired: looseSchema,
	name: looseSchema,
	digest: looseSchema,
	expires_at: looseSchema,
});
export const checkRunsSchema = z.object({
	total_count: looseSchema,
	check_runs: z.array(
		z.object({ name: looseSchema, status: looseSchema, conclusion: looseSchema, details_url: looseSchema }),
	),
});
export const commitStatusSchema = z.object({ state: looseSchema, total_count: looseSchema });
