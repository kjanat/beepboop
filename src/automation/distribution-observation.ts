import { Effect, Schema } from 'effect';
import type { RepositoryGateway } from '@/automation/github';
import { gitCommitSchema, gitRefSchema, repositorySchema, workflowRunSchema } from '@/automation/github-resources';
import type { RefPlan, RefState } from '@/automation/refs';
import type { Execution } from '@/automation/types';
import { shaSchema } from '@/model';

const tree = Schema.Struct({
	truncated: Schema.Boolean,
	tree: Schema.Array(Schema.Struct({
		path: Schema.String,
		type: Schema.String,
		mode: Schema.String,
		sha: shaSchema,
		size: Schema.optional(Schema.Finite),
	})),
});
const comparison = Schema.Struct({
	status: Schema.String,
	merge_base_commit: Schema.Struct({ sha: shaSchema }),
	commits: Schema.Array(Schema.Struct({
		sha: shaSchema,
		parents: Schema.Array(Schema.Struct({ sha: shaSchema })),
		commit: Schema.Struct({ tree: Schema.Struct({ sha: shaSchema }) }),
	})),
});

/** Observe a distribution already published by the execution's completed, bound workflow. */
export function observedDistribution(
	gateway: RepositoryGateway,
	execution: Execution,
	refs: RefState[],
	modulePrefixes: readonly string[] = [],
) {
	return Effect.gen(function*() {
		const workflow = execution.workflow;
		const policy = workflow?.refs;
		if (
			!workflow || !policy?.distribution || policy.phase !== 'version' || !execution.version
			|| execution.runId === undefined || execution.runAttempt === undefined
			|| !execution.workflowSha
		) return undefined;
		const name = `${policy.prefix}${execution.version}`;
		const ref = refs.find(ref => ref.name === name);
		if (!ref || ref.commit === execution.sourceSha) return undefined;
		const names = [...new Set([name, ...modulePrefixes.map(prefix => `${prefix}${execution.version}`)])];
		const publicationRefs: RefState[] = [];
		for (const name of names) {
			const required = refs.find(candidate => candidate.name === name);
			if (!required || required.commit !== ref.commit) return undefined;
			publicationRefs.push(required);
		}
		const token = yield* gateway.token(execution.repository, execution.repositoryId, {
			contents: 'read',
			actions: 'read',
		});
		const base = `/repos/${execution.repository}`;
		const run = yield* gateway.read(workflowRunSchema, `${base}/actions/runs/${execution.runId}`, token);
		if (
			run.status !== 'completed' || run.conclusion !== 'success' || run.repository.id !== execution.repositoryId
			|| run.path !== `.github/workflows/${workflow.file}` || run.head_sha !== execution.workflowSha
			|| run.run_attempt !== execution.runAttempt
		) return undefined;
		const source = yield* gateway.read(gitCommitSchema, `${base}/git/commits/${execution.sourceSha}`, token);
		const commit = yield* gateway.read(gitCommitSchema, `${base}/git/commits/${ref.commit}`, token);
		if (
			commit.parents.length !== 1 || commit.parents[0]?.sha !== execution.sourceSha
			|| (policy.signed && commit.verification.verified !== true)
		) return undefined;
		const author = yield* gateway.read(
			Schema.Struct({ author: Schema.NullOr(Schema.Struct({ id: Schema.Finite })) }),
			`${base}/commits/${ref.commit}`,
			token,
		);
		const bot = yield* gateway.botIdentity;
		if (author.author?.id !== bot.id) return undefined;
		const before = yield* gateway.read(tree, `${base}/git/trees/${source.tree.sha}?recursive=1`, token);
		const after = yield* gateway.read(tree, `${base}/git/trees/${commit.tree.sha}?recursive=1`, token);
		if (before.truncated || after.truncated) return undefined;
		const paths = policy.distribution.files;
		if (
			!paths.length || new Set(paths).size !== paths.length
			|| paths.some(path =>
				!path || path.startsWith('/') || path.includes('\\')
				|| path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
				|| path.toLowerCase() === '.github' || path.toLowerCase() === '.github/workflows'
				|| path.toLowerCase().startsWith('.github/workflows/')
			)
		) return undefined;
		const old = new Map(before.tree.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
		const current = new Map(after.tree.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
		for (const path of paths) {
			const file = current.get(path);
			if (file?.type !== 'blob' || !['100644', '100755'].includes(file.mode) || !file.size || file.size < 0) {
				return undefined;
			}
		}
		for (const path of new Set([...old.keys(), ...current.keys()])) {
			const a = old.get(path), b = current.get(path);
			if (!paths.includes(path) && (a?.sha !== b?.sha || a?.mode !== b?.mode || a?.type !== b?.type)) return undefined;
		}
		const repository = yield* gateway.read(repositorySchema, base, token);
		if (
			repository.id !== execution.repositoryId
			|| repository.full_name.toLowerCase() !== execution.repository.toLowerCase()
		) return undefined;
		const branch = repository.default_branch;
		const head = yield* gateway.read(gitRefSchema, `${base}/git/ref/heads/${encodeURIComponent(branch)}`, token);
		if (head.object.type !== 'commit') return undefined;
		let ancestry: typeof comparison.Type.commits[number] | undefined;
		for (let page = 1;; page++) {
			const compared = yield* gateway.read(
				comparison,
				`${base}/compare/${execution.sourceSha}...${head.object.sha}?per_page=100&page=${page}`,
				token,
			);
			if (compared.status !== 'ahead' || compared.merge_base_commit.sha !== execution.sourceSha) return undefined;
			ancestry = compared.commits.find(candidate =>
				candidate.parents.length === 2
				&& candidate.parents[0]?.sha === execution.sourceSha && candidate.parents[1]?.sha === ref.commit
				&& candidate.commit.tree.sha === source.tree.sha
			);
			if (ancestry || compared.commits.length < 100) break;
		}
		if (!ancestry) return undefined;
		const verified = yield* gateway.read(gitCommitSchema, `${base}/git/commits/${ancestry.sha}`, token);
		if (
			verified.tree.sha !== source.tree.sha || verified.parents.length !== 2
			|| verified.parents[0]?.sha !== execution.sourceSha || verified.parents[1]?.sha !== ref.commit
		) return undefined;
		return {
			repository: execution.repository,
			executionId: execution.id,
			version: execution.version,
			changes: publicationRefs.map(ref => ({
				name: ref.name,
				expected: ref.oid,
				commit: ref.commit,
				annotated: ref.oid !== ref.commit,
				signed: false,
			})),
			distribution: {
				sourceSha: execution.sourceSha,
				commit: ref.commit,
				tree: commit.tree.sha,
				ancestryCommit: ancestry.sha,
				branch,
				expected: execution.sourceSha,
			},
		} satisfies RefPlan;
	});
}
