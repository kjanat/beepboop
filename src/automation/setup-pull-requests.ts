import { Effect, Schema } from 'effect';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import { enableAutoMerge } from '@/automation/preparation-pull-requests';
import type { Edit } from '@/domain/inventory.ts';
import { setupBranches } from '@/domain/setup-branches.ts';
import { autoMergeMethods } from '@/domain/setup-terms.ts';
import { comparisonSchema, gitRefSchema, pullSchema, repositorySchema } from '@/github/resources.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { ioConcurrency } from '@/kernel/http/retry.ts';
import { decode, textSchema } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import { marked, placeBlock, setupBlock, withStatus } from '@/setup/body.ts';

const contentEditsSchema = mutableStruct({
	data: mutableStruct({
		repository: mutableStruct({
			pullRequest: mutableStruct({
				userContentEdits: mutableStruct({
					nodes: mutableArray(
						mutableStruct({
							editor: Schema.NullOr(mutableStruct({ login: Schema.String })),
							diff: Schema.NullOr(Schema.String),
						}),
					),
				}),
			}),
		}),
	}),
});
export function previousRender(
	gateway: RepositoryGateway,
	name: string,
	number: number,
	current: string,
	token: string,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		if (marked(current) || !current.trim()) return current;
		const [owner = '', repository = ''] = name.split('/');
		const { data } = yield* gateway.read(
			contentEditsSchema,
			'/graphql',
			token,
			'POST',
			{
				query:
					'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){userContentEdits(first:100){nodes{editor{login} diff}}}}}',
				variables: { owner, name: repository, number },
			},
		);
		const edits = data.repository.pullRequest.userContentEdits.nodes;
		const bot = (yield* gateway.botIdentity).login.replace(/\[bot\]$/, '');
		const render = edits.find(edit => edit.editor?.login === bot && typeof edit.diff === 'string');
		return typeof render?.diff === 'string' ? render.diff : current;
	});
}
function generatedComparison(gateway: RepositoryGateway, name: string, head: string, token: string) {
	return Effect.gen(function*() {
		const base = (yield* gateway.read(repositorySchema, `/repos/${name}`, token)).default_branch;
		const comparison = yield* gateway.read(
			comparisonSchema,
			`/repos/${name}/compare/${encodeURIComponent(base)}...${head}`,
			token,
		);
		const commits = comparison.commits;
		if (!commits.length || commits.length !== Number(comparison.ahead_by) || commits.at(-1)?.sha !== head) {
			return undefined;
		}
		const bot = yield* gateway.botIdentity;
		const generated = commits.every(commit =>
			commit.author.id === bot.id && commit.commit.verification.verified === true
		);
		return generated ? comparison : undefined;
	});
}
export function generatedFiles(
	gateway: RepositoryGateway,
	name: string,
	id: number,
	head: string,
): Effect.Effect<Edit[] | undefined, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(name, id, { contents: 'read' });
		const comparison = yield* generatedComparison(gateway, name, head, token);
		if (!comparison) return undefined;
		const files = comparison.files;
		if (files.length >= 300) return undefined;
		const mergeBase = comparison.merge_base_commit.sha;
		const paths = yield* Effect.fromResult(decode(mutableArray(textSchema), files.map(file => file.filename)));
		return yield* Effect.forEach(paths, path => {
			return Effect.all({
				path: Effect.succeed(path),
				before: gateway.file(name, path, mergeBase, token).pipe(Effect.map(content => content ?? '')),
				after: gateway.file(name, path, head, token).pipe(Effect.map(content => content ?? '')),
			});
		}, { concurrency: ioConcurrency });
	});
}
export function setupHead(
	gateway: RepositoryGateway,
	name: string,
	id: number,
	branch: string,
): Effect.Effect<string | null, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(name, id);
		const ref = yield* gateway.read(
			Schema.NullOr(gitRefSchema),
			`/repos/${name}/git/ref/heads/${branch}`,
			token,
		);
		return ref ? ref.object.sha : null;
	});
}
/** Inspect the existing setup proposal; automatic maintenance never opens a replacement PR. */
export function openSetupPull(gateway: RepositoryGateway, name: string, id: number): Effect.Effect<
	{ number: number; head: string; branch: string; url: string; body: string } | undefined,
	DomainError
> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(name, id, { contents: 'read', pull_requests: 'read' });
		const rows: Decoded<typeof pullSchema>[] = [];
		for (const branch of setupBranches) {
			rows.push(
				...yield* gateway.read(
					mutableArray(pullSchema),
					`/repos/${name}/pulls?state=open&head=${encodeURIComponent(`${name.split('/')[0]}:${branch}`)}`,
					token,
				),
			);
		}
		if (rows.length > 1) return yield* precondition('Multiple open setup pull requests');
		const pull = rows[0];
		if (!pull) return;
		if (pull.head.repo.id !== id || !setupBranches.includes(pull.head.ref)) {
			return yield* precondition('Setup pull request repository mismatch');
		}
		return {
			number: pull.number,
			head: pull.head.sha,
			branch: pull.head.ref,
			url: pull.html_url,
			body: typeof pull.body === 'string' ? pull.body : '',
		};
	});
}
export function setupMerge(
	gateway: RepositoryGateway,
	name: string,
	id: number,
	url: string,
): Effect.Effect<{ sha: string; body: string } | undefined, DomainError> {
	return Effect.gen(function*() {
		const prefix = `https://github.com/${name}/pull/`;
		const number = url.startsWith(prefix) ? url.slice(prefix.length) : '';
		if (!/^[1-9][0-9]*$/.test(number)) return undefined;
		const token = yield* gateway.token(name, id, { contents: 'read', pull_requests: 'read' });
		const pull = yield* gateway.read(pullSchema, `/repos/${name}/pulls/${number}`, token);
		if (pull.merged !== true || pull.head.repo.id !== id || !setupBranches.includes(pull.head.ref)) {
			return undefined;
		}
		const sha = yield* gateway.mergeCommit(name, number, token);
		return sha === undefined ? undefined : { sha, body: typeof pull.body === 'string' ? pull.body : '' };
	});
}
const configurationPath = '.github/beepboop.json';
export const setupAutoMerge = {
	workflows: 'This setup PR edits workflows, so it waits for your review. Beepboop left auto-merge off.',
	revoked:
		'Beepboop turned off auto-merge. The updated proposal changes more than the file format, so it waits for your review.',
	settings:
		'This setup PR changes settings beyond the file format, so it waits for your review. Beepboop left auto-merge off.',
	disallowed: "Auto-merge is off in this repository's settings. Merge this setup PR yourself.",
	enabled: (method: string) =>
		`Beepboop turned on ${method} auto-merge. GitHub merges this setup PR once its required checks pass.`,
};
export function proposalScope(
	edits: Edit[],
	format: unknown,
): Effect.Effect<'format' | 'workflows' | 'settings', DomainError> {
	return Effect.gen(function*() {
		if (edits.some(edit => edit.path !== configurationPath)) return 'workflows';
		const rewritten = yield* fromSync((): unknown => JSON.parse(edits[0]?.after ?? 'null'));
		return JSON.stringify(rewritten) === JSON.stringify(format) ? 'format' : 'settings';
	});
}
const disableSchema = mutableStruct({
	data: Schema.NullOr(mutableStruct({
		disablePullRequestAutoMerge: Schema.NullOr(mutableStruct({
			pullRequest: mutableStruct({ autoMergeRequest: Schema.NullOr(mutableStruct({ mergeMethod: Schema.String })) }),
		})),
	})),
	errors: Schema.optional(mutableArray(mutableStruct({ message: Schema.String }))),
});
export function revokeAutoMerge(
	gateway: RepositoryGateway,
	name: string,
	id: number,
	number: number,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(name, id, { contents: 'write', pull_requests: 'write' });
		const pull = yield* gateway.read(pullSchema, `/repos/${name}/pulls/${number}`, token);
		const bot = yield* gateway.botIdentity;
		if (pull.auto_merge?.enabled_by?.login !== bot.login) return;
		const response = yield* gateway.read(disableSchema, '/graphql', token, 'POST', {
			query:
				'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){pullRequest{autoMergeRequest{mergeMethod}}}}',
			variables: { id: pull.node_id },
		});
		if (
			!response.data?.disablePullRequestAutoMerge
			|| response.data.disablePullRequestAutoMerge.pullRequest.autoMergeRequest
		) {
			return yield* precondition(
				`Auto-merge stays on for ${name}#${number}: ${
					response.errors?.map(error => error.message).join('; ') || 'GitHub kept the auto-merge request'
				}`,
			);
		}
		yield* gateway.call(`/repos/${name}/issues/${number}/comments`, token, 'POST', { body: setupAutoMerge.revoked })
			.pipe(
				Effect.ignore,
			);
	});
}
export function autoMergeSetup(
	gateway: RepositoryGateway,
	name: string,
	id: number,
	url: string,
	edits: Edit[],
	format: unknown,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const prefix = `https://github.com/${name}/pull/`;
		const number = url.startsWith(prefix) ? url.slice(prefix.length) : '';
		if (!/^[1-9][0-9]*$/.test(number)) return yield* precondition('Invalid setup PR identity');
		const token = yield* gateway.token(name, id, { contents: 'write', pull_requests: 'write' });
		const comment = (body: string) =>
			gateway.call(`/repos/${name}/issues/${number}/comments`, token, 'POST', { body }).pipe(Effect.ignore);
		const scope = yield* proposalScope(edits, format);
		if (scope !== 'format') return yield* comment(setupAutoMerge[scope]);
		const settings = yield* gateway.read(repositorySchema, `/repos/${name}`, token);
		const allowed = {
			squash: settings.allow_squash_merge,
			merge: settings.allow_merge_commit,
			rebase: settings.allow_rebase_merge,
		};
		const method = autoMergeMethods.find(entry => allowed[entry] === true);
		if (settings.allow_auto_merge !== true || !method) return yield* comment(setupAutoMerge.disallowed);
		const result = yield* enableAutoMerge(gateway, name, id, url, method, 'setup PR');
		if (result.state === 'enabled') yield* comment(setupAutoMerge.enabled(method));
	});
}
/** Update only the bot's status section, including when a human changed the proposal branch. */
export function setupStatus(
	gateway: RepositoryGateway,
	name: string,
	id: number,
	number: number,
	status: string,
	proposal?: { title: string; body: string },
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const token = yield* gateway.token(name, id, { pull_requests: 'write' });
		const pull = yield* gateway.read(pullSchema, `/repos/${name}/pulls/${number}`, token);
		if (pull.state !== 'open' || !setupBranches.includes(pull.head.ref) || pull.head.repo.id !== id) return;
		const current = typeof pull.body === 'string' ? pull.body : '';
		const body = proposal === undefined
			? withStatus(current, status)
			: placeBlock(
				current,
				setupBlock(proposal.body, status),
				yield* previousRender(gateway, name, number, current, token),
			);
		const title = proposal && proposal.title !== pull.title ? { title: proposal.title } : {};
		if (body !== current || 'title' in title) {
			yield* gateway.call(`/repos/${name}/pulls/${number}`, token, 'PATCH', { body, ...title });
		}
	});
}
