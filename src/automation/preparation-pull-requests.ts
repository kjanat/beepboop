import { Effect, Schema } from 'effect';
import type { RepositoryGateway } from '@/automation/github';
import {
	comparisonSchema,
	createdSchema,
	gitCommitSchema,
	gitRefSchema,
	namedSchema,
	pullSchema,
	ruleSchema,
} from '@/automation/github-resources';
import { placeBlock, setupBlock } from '@/automation/setup-body';
import { setupBranches } from '@/automation/setup-changes';
import { previousRender } from '@/automation/setup-pull-requests';
import { repositorySnapshot } from '@/automation/snapshot';
import type { AutoMerge, PreparationResult } from '@/automation/types';
import type { Edit, Snapshot } from '@/domain/inventory.ts';
import type { AutoMergeMethod } from '@/domain/setup-terms.ts';
import { rateLimited } from '@/github/transport.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition, upstream } from '@/kernel/errors/domain-error.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import { sha } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

const coAuthor = 'Co-authored-by: kjanat <6353477+kjanat@users.noreply.github.com>';
const autoMergeSchema = mutableStruct({
	data: Schema.optional(Schema.NullOr(mutableStruct({
		enablePullRequestAutoMerge: Schema.NullOr(mutableStruct({
			pullRequest: mutableStruct({ autoMergeRequest: Schema.NullOr(mutableStruct({ mergeMethod: Schema.String })) }),
		})),
	}))),
	errors: Schema.optional(
		mutableArray(mutableStruct({ type: Schema.optional(Schema.String), message: Schema.String })),
	),
});
function preparationPullNumber(repository: string, url: string): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const parsed = URL.parse(url);
		const prefix = `/${repository}/pull/`;
		if (
			parsed?.origin !== 'https://github.com' || !parsed.pathname.startsWith(prefix)
			|| !/^[1-9][0-9]*$/.test(parsed.pathname.slice(prefix.length))
		) return yield* precondition('Invalid preparation PR identity');
		return parsed.pathname.slice(prefix.length);
	});
}
export interface PullRequestDraft<R = never> {
	readonly snapshot: Snapshot;
	readonly branch: string;
	readonly title: string;
	readonly body: string;
	readonly edits: Edit[];
	readonly expectedHead?: string | undefined;
	readonly checkpoint?: ((head: string) => Effect.Effect<void, DomainError, R>) | undefined;
	readonly setupEdits?: Edit[] | undefined;
	readonly existingPull?: number | undefined;
	readonly takeOver?: boolean;
	readonly coAuthored?: boolean;
}
export function pullRequest<R = never>(
	gateway: RepositoryGateway,
	draft: PullRequestDraft<R>,
): Effect.Effect<{ url: string; head: string }, DomainError, R> {
	const {
		snapshot,
		branch,
		title,
		body,
		edits,
		expectedHead,
		checkpoint,
		setupEdits,
		existingPull,
		takeOver = false,
		coAuthored = false,
	} = draft;
	return Effect.gen(function*() {
		const { name, id } = snapshot.repository;
		const token = yield* gateway.token(name, id, {
			contents: 'write',
			pull_requests: 'write',
			...(edits.some(edit => edit.path.startsWith('.github/workflows/'))
					|| setupEdits?.some(edit => edit.path.startsWith('.github/workflows/'))
				? { workflows: 'write' as const }
				: {}),
		});
		const existing = yield* gateway.read(
			Schema.NullOr(gitRefSchema),
			`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`,
			token,
		);
		const base = existing ? existing.object.sha : snapshot.sha;
		if (existing && (!expectedHead || expectedHead !== base)) {
			return yield* precondition('Branch changed; preserve user edits and review the conflict');
		}
		if (existing && setupEdits && !takeOver) {
			const changed = (yield* gateway.read(comparisonSchema, `/repos/${name}/compare/${snapshot.sha}...${base}`, token))
				.files;
			if (changed.length >= 300 || changed.some(file => !setupEdits.some(edit => edit.path === file.filename))) {
				return yield* precondition('Setup branch contains unrelated changes; review it before refreshing');
			}
			for (const edit of setupEdits) {
				if ((yield* gateway.file(name, edit.path, base, token)) !== edit.after) {
					return yield* precondition(`Setup branch was edited: ${edit.path}`);
				}
			}
		}
		const head = yield* editCommit(
			gateway,
			name,
			token,
			setupEdits ? snapshot.sha : base,
			edits,
			coAuthored ? `${title}\n\n${coAuthor}` : title,
		);
		const rules = yield* gateway.read(
			Schema.NullOr(mutableArray(ruleSchema)),
			`/repos/${name}/rules/branches/${encodeURIComponent(branch)}`,
			token,
		);
		if (rules === null) {
			return yield* precondition('Branch rules unavailable; publication of the preparation branch stopped');
		}
		if (rules.some((rule) => rule.type === 'required_signatures')) {
			const { verification } = yield* gateway.read(gitCommitSchema, `/repos/${name}/git/commits/${head}`, token);
			if (verification.verified !== true) {
				return yield* precondition('Preparation commit does not satisfy the branch signature requirement');
			}
		}
		if (existingPull !== undefined) {
			const pull = yield* gateway.read(pullSchema, `/repos/${name}/pulls/${existingPull}`, token);
			if (
				pull.state !== 'open' || pull.head.sha !== base || pull.head.ref !== branch || pull.head.repo.id !== id
			) return yield* precondition('Setup pull request changed during refresh');
		}
		if (checkpoint) yield* checkpoint(head);
		if (existing) {
			yield* gateway.call(
				`/repos/${name}/git/refs/heads/${encodeURIComponent(branch)}`,
				token,
				'PATCH',
				{ sha: head, force: setupEdits !== undefined },
			);
		} else {
			yield* gateway.call(`/repos/${name}/git/refs`, token, 'POST', {
				ref: `refs/heads/${branch}`,
				sha: head,
			});
		}
		return yield* finishPullRequest(gateway, snapshot, branch, title, body, head, token);
	});
}
function editCommit(
	gateway: RepositoryGateway,
	name: string,
	token: string,
	base: string,
	edits: Edit[],
	message: string,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const commit = yield* gateway.read(gitCommitSchema, `/repos/${name}/git/commits/${base}`, token);
		for (const edit of edits) {
			const current = yield* gateway.file(name, edit.path, base, token);
			if ((current ?? '') !== edit.before) return yield* precondition(`File changed: ${edit.path}`);
			if (
				edit.path.startsWith('/')
				|| edit.path.split('/').some((p) => p === '..' || p === '.git')
			) {
				return yield* precondition('Unsafe edit path');
			}
		}
		const tree = yield* gateway.read(createdSchema, `/repos/${name}/git/trees`, token, 'POST', {
			base_tree: commit.tree.sha,
			tree: edits.map((edit) => ({
				path: edit.path,
				mode: '100644',
				type: 'blob',
				content: edit.after,
			})),
		});
		const { sha: head } = yield* gateway.read(createdSchema, `/repos/${name}/git/commits`, token, 'POST', {
			message,
			tree: tree.sha,
			parents: [base],
		});
		return head;
	});
}
/** Fast-forward the default branch to a signed bot commit that applies the version bump. */
export function commitVersion<R = never>(
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	message: string,
	edits: Edit[],
	head: string | undefined,
	checkpoint: (head: string) => Effect.Effect<void, DomainError, R>,
): Effect.Effect<PreparationResult, DomainError, R> {
	return Effect.gen(function*() {
		const { name, id, defaultBranch } = snapshot.repository;
		const token = yield* gateway.token(name, id, {
			contents: 'write',
			...(edits.some(edit => edit.path.startsWith('.github/workflows/')) ? { workflows: 'write' as const } : {}),
		});
		const branch = encodeURIComponent(defaultBranch);
		let commit = head;
		if (!commit) {
			commit = yield* editCommit(gateway, name, token, snapshot.sha, edits, message);
			yield* checkpoint(commit);
		}
		const current = yield* gateway.read(gitRefSchema, `/repos/${name}/git/ref/heads/${branch}`, token);
		const landed = current.object.sha === commit
			|| (current.object.sha !== snapshot.sha
				&& (yield* gateway.read(comparisonSchema, `/repos/${name}/compare/${commit}...${current.object.sha}`, token))
					.status === 'ahead');
		if (!landed) {
			if (current.object.sha !== snapshot.sha) {
				return yield* precondition(
					`${defaultBranch} moved to ${
						current.object.sha.slice(0, 12)
					} before the version commit landed. Start the release again.`,
				);
			}
			yield* gateway.call(`/repos/${name}/git/refs/heads/${branch}`, token, 'PATCH', { sha: commit, force: false })
				.pipe(
					Effect.catchIf(
						error => error.problem.code === 'precondition',
						error =>
							precondition(
								`GitHub refused the version commit on ${defaultBranch}: ${error.message}. Let the Beepboop app push to ${defaultBranch}, or set prepare.versionLands to "via-version-pr".`,
							),
					),
				);
		}
		return { url: `https://github.com/${name}/commit/${commit}`, head: commit, kind: 'commit' as const };
	});
}
/** Bind release execution to the merged preparation pull request. */
function mergedPreparationPull(
	gateway: RepositoryGateway,
	repository: string,
	repositoryId: number,
	result: { url: string; head: string },
	token: string,
): Effect.Effect<{ mergeSha: string; base: string; defaultBranch: string; head: string }, DomainError> {
	return Effect.gen(function*() {
		const number = yield* preparationPullNumber(repository, result.url);
		const pull = yield* gateway.read(pullSchema, `/repos/${repository}/pulls/${number}`, token);
		const base = pull.base;
		const mergeSha = pull.merged === true ? yield* gateway.mergeCommit(repository, number, token) : undefined;
		if (!mergeSha || base.repo.id !== repositoryId) {
			return yield* precondition('The preparation PR is not merged');
		}
		return { mergeSha, base: base.ref, defaultBranch: base.repo.default_branch, head: pull.head.sha };
	});
}
export function preparedSnapshot(
	gateway: RepositoryGateway,
	repository: string,
	repositoryId: number,
	result: { url: string; head: string },
	target: string,
	extraPaths: string[] = [],
): Effect.Effect<Snapshot, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(repository, repositoryId, { contents: 'read', pull_requests: 'read' });
		const pull = yield* mergedPreparationPull(gateway, repository, repositoryId, result, token);
		if (pull.head !== result.head) return yield* precondition('The preparation PR is not merged');
		if (pull.mergeSha !== (yield* Effect.fromResult(sha(target)))) {
			return yield* precondition('Target is not the merged preparation revision');
		}
		const snapshot = yield* repositorySnapshot(gateway, repository, repositoryId, target, extraPaths);
		if (pull.base !== snapshot.repository.defaultBranch) {
			return yield* precondition('Preparation was merged into a different branch');
		}
		return snapshot;
	});
}
export function preparationMerge(
	gateway: RepositoryGateway,
	repository: string,
	repositoryId: number,
	result: { url: string; head: string },
	target: string,
): Effect.Effect<{ sha: string; extended: boolean } | undefined, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(repository, repositoryId, { contents: 'read', pull_requests: 'read' });
		const pull = yield* mergedPreparationPull(gateway, repository, repositoryId, result, token);
		if (pull.base !== pull.defaultBranch) return undefined;
		const extended = pull.head !== result.head;
		if (extended) {
			const carried = yield* gateway.read(
				comparisonSchema,
				`/repos/${repository}/compare/${yield* Effect.fromResult(sha(result.head))}...${yield* Effect.fromResult(
					sha(pull.head),
				)}`,
				token,
			);
			if (carried.status !== 'ahead') {
				return yield* precondition('The merged preparation PR no longer carries its version commit');
			}
		}
		const comparison = yield* gateway.read(
			comparisonSchema,
			`/repos/${repository}/compare/${pull.mergeSha}...${yield* Effect.fromResult(sha(target))}`,
			token,
		);
		return comparison.status === 'identical' || comparison.status === 'ahead'
			? { sha: pull.mergeSha, extended }
			: undefined;
	});
}
/** Resume only the exact commit checkpointed before branch publication. */
export function resumePreparation(
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	branch: string,
	title: string,
	body: string,
	head: string,
): Effect.Effect<{ url: string; head: string }, DomainError> {
	return Effect.gen(function*() {
		const { name, id } = snapshot.repository;
		const token = yield* gateway.token(name, id, { contents: 'write', pull_requests: 'write' });
		const commit = yield* gateway.read(
			gitCommitSchema,
			`/repos/${name}/git/commits/${yield* Effect.fromResult(sha(head))}`,
			token,
		);
		const parents = commit.parents;
		if (parents.length !== 1 || parents[0]?.sha !== snapshot.sha) {
			return yield* precondition('Preparation commit ancestry changed');
		}
		const rules = yield* gateway.read(
			Schema.NullOr(mutableArray(ruleSchema)),
			`/repos/${name}/rules/branches/${encodeURIComponent(branch)}`,
			token,
		);
		if (rules === null) return yield* precondition('Branch rules unavailable');
		if (rules.some(rule => rule.type === 'required_signatures') && commit.verification.verified !== true) {
			return yield* precondition('Preparation commit signature is not verified');
		}
		const existing = yield* gateway.read(
			Schema.NullOr(gitRefSchema),
			`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`,
			token,
		);
		if (existing && existing.object.sha !== head) {
			return yield* precondition('Preparation branch changed');
		}
		if (!existing) {
			yield* gateway.call(`/repos/${name}/git/refs`, token, 'POST', { ref: `refs/heads/${branch}`, sha: head });
		}
		return yield* finishPullRequest(gateway, snapshot, branch, title, body, head, token);
	});
}
/** Refresh setup documentation without creating an empty commit or overwriting branch edits. */
export function refreshPullRequest(
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	branch: string,
	title: string,
	body: string,
	expectedHead: string,
): Effect.Effect<{ url: string; head: string }, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(snapshot.repository.name, snapshot.repository.id, {
			contents: 'read',
			pull_requests: 'write',
		});
		const current = yield* gateway.read(
			Schema.NullOr(gitRefSchema),
			`/repos/${snapshot.repository.name}/git/ref/heads/${encodeURIComponent(branch)}`,
			token,
		);
		if (!current || current.object.sha !== expectedHead) {
			return yield* precondition('Branch changed; preserve user edits and review the conflict');
		}
		return yield* finishPullRequest(gateway, snapshot, branch, title, body, expectedHead, token);
	});
}
export function enableAutoMerge(
	gateway: RepositoryGateway,
	repository: string,
	repositoryId: number,
	url: string,
	method: AutoMergeMethod,
	subject: 'version PR' | 'setup PR',
): Effect.Effect<AutoMerge, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(repository, repositoryId, { contents: 'write', pull_requests: 'write' });
		const number = yield* preparationPullNumber(repository, url);
		const pull = yield* gateway.read(pullSchema, `/repos/${repository}/pulls/${number}`, token);
		const response = yield* gateway.read(autoMergeSchema, '/graphql', token, 'POST', {
			query:
				'mutation($id:ID!,$method:PullRequestMergeMethod!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method}){pullRequest{autoMergeRequest{mergeMethod}}}}',
			variables: { id: pull.node_id, method: method.toUpperCase() },
		}).pipe(
			Effect.catchIf(
				error => error.problem.code === 'precondition' || error.problem.code === 'forbidden',
				error => Effect.succeed<Decoded<typeof autoMergeSchema>>({ data: null, errors: [{ message: error.message }] }),
			),
		);
		if (response.data?.enablePullRequestAutoMerge?.pullRequest.autoMergeRequest) {
			return { method, state: 'enabled' as const };
		}
		const reason = response.errors?.map(error => error.message).join('; ') || 'GitHub returned no auto-merge request';
		if (response.errors?.some(error => rateLimited(error.message, error.type))) {
			return yield* upstream('github', `GitHub rate-limited auto-merge for ${repository}#${number}: ${reason}`);
		}
		const note =
			`Beepboop could not turn on ${method} auto-merge for this ${subject}. GitHub said: ${reason}. The PR stays open until you merge it.`;
		yield* gateway.call(`/repos/${repository}/issues/${number}/comments`, token, 'POST', { body: note }).pipe(
			Effect.ignore,
		);
		return { method, state: 'refused' as const, note };
	});
}
export function restatePreparation(
	gateway: RepositoryGateway,
	repository: string,
	repositoryId: number,
	url: string,
	previous: string,
	next: string,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(repository, repositoryId, { pull_requests: 'write' });
		const number = yield* preparationPullNumber(repository, url);
		const pull = yield* gateway.read(pullSchema, `/repos/${repository}/pulls/${number}`, token);
		const body = typeof pull.body === 'string' ? pull.body : '';
		if (pull.state !== 'open' || !body.includes(previous)) return;
		yield* gateway.call(`/repos/${repository}/pulls/${number}`, token, 'PATCH', { body: body.replace(previous, next) });
	});
}
function finishPullRequest(
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	branch: string,
	title: string,
	body: string,
	head: string,
	token: string,
): Effect.Effect<{ url: string; head: string }, DomainError> {
	return Effect.gen(function*() {
		const { name } = snapshot.repository;
		const owner = name.split('/')[0];
		const unmerged = (yield* gateway.read(
			mutableArray(pullSchema),
			`/repos/${name}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`,
			token,
		)).filter(pull => pull.merged !== true && typeof pull.merged_at !== 'string');
		const setup = setupBranches.includes(branch);
		const pulls = setup ? unmerged.filter(pull => pull.state === 'open') : unmerged;
		if (pulls.length > 1) {
			return yield* precondition(`Several unmerged pull requests use ${branch}; keep one of them`);
		}
		if (pulls[0] && pulls[0].state !== 'open') {
			return yield* precondition(
				`The preparation PR #${pulls[0].number} was closed without merging. Reopen it to continue this release.`,
			);
		}
		const existing = pulls[0];
		const validBase = (pull: Decoded<typeof pullSchema>) =>
			pull.base.ref === snapshot.repository.defaultBranch ? Effect.void : precondition(
				`The preparation PR #${pull.number} targets ${pull.base.ref}; retarget it to ${snapshot.repository.defaultBranch} to continue this release.`,
			);
		if (existing) yield* validBase(existing);
		const previousBody = typeof existing?.body === 'string' ? existing.body : '';
		const pull = existing
			? yield* gateway.read(pullSchema, `/repos/${name}/pulls/${existing.number}`, token, 'PATCH', {
				title,
				body: setup
					? placeBlock(
						previousBody,
						setupBlock(body),
						yield* previousRender(gateway, name, existing.number, previousBody, token),
					)
					: body,
			})
			: yield* gateway.read(pullSchema, `/repos/${name}/pulls`, token, 'POST', {
				title,
				body: setup ? `${setupBlock(body)}\n` : body,
				head: branch,
				base: snapshot.repository.defaultBranch,
			});
		yield* validBase(pull);
		const metadata = Effect.gen(function*() {
			const available = yield* gateway.read(mutableArray(namedSchema), `/repos/${name}/labels?per_page=100`, token);
			let labels = available
				.map((label) => label.name)
				.filter((name) =>
					['maintenance', 'type:maintenance', 'area:release', 'release', 'dependencies'].includes(
						name,
					)
				);
			labels = labels.filter((name) => name !== 'dependencies');
			if (!labels.length) {
				yield* gateway.call(`/repos/${name}/labels`, token, 'POST', {
					name: 'maintenance',
					color: '527a67',
					description: 'Repository maintenance and release automation',
				});
				labels = ['maintenance'];
			}
			yield* gateway.read(
				mutableArray(namedSchema),
				`/repos/${name}/issues/${pull.number}/labels`,
				token,
				'POST',
				{ labels },
			);
			const maintainer = yield* gateway.ownerLogin();
			if (!pull.assignees?.some(assignee => assignee.login === maintainer)) {
				yield* gateway.call(`/repos/${name}/issues/${pull.number}/assignees`, token, 'POST', {
					assignees: [maintainer],
				});
			}
			if (!pull.requested_reviewers?.some(reviewer => reviewer.login === maintainer)) {
				yield* gateway.call(`/repos/${name}/pulls/${pull.number}/requested_reviewers`, token, 'POST', {
					reviewers: [maintainer],
				});
			}
		}).pipe(logRecovered('pull-request.metadata-failed', { repository: name, number: pull.number }));
		if (gateway.defer) gateway.defer(Effect.runPromiseWith(yield* Effect.context())(metadata));
		else yield* metadata;
		return { url: pull.html_url, head };
	});
}
