import { Context, Effect, Layer, Schema } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import { requireImmutableReleases, verifyImmutableRelease } from '@/automation/immutable-release.ts';
import { RefPublication } from '@/automation/ref-publication.ts';
import { Automation } from '@/automation/service.ts';
import { semVer } from '@/domain/version.ts';
import { releaseNotes } from '@/github/release-notes.ts';
import type { GitHubRelease } from '@/github/resources.ts';
import { gitRefSchema, releaseNotesSchema, releaseSchema } from '@/github/resources.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { decodeSync, mutableArray } from '@/kernel/schema/structs.ts';
import { observedDistribution } from '@/release/distribution/observation.ts';
import { mergePublications, publishedAfterFailure, recoverable, settle } from '@/release/domain/execution/execution.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import type { ReleaseTarget } from '@/release/domain/github-release.ts';
import { githubRelease, publishesGithubRelease } from '@/release/domain/github-release.ts';
import { refsLanded, releaseCommit, versionTagged } from '@/release/domain/refs.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';
import { RunBinder } from '@/release/services/coordinator/run-binder.ts';

export class GitHubReleases extends Context.Service<GitHubReleases, {
	readonly publish: (id: string, identity: RunIdentity) => Effect.Effect<Execution, DomainError>;
	readonly published: (execution: Execution) => Effect.Effect<Execution, DomainError>;
	readonly releasePublished: (tag: string) => Effect.Effect<void, DomainError>;
	readonly draft: (execution: Execution) => Effect.Effect<Execution['draftRelease'], DomainError>;
}>()('beepboop/automation/GitHubReleases') {
	static readonly layer = Layer.effect(
		GitHubReleases,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const executions = yield* Executions;
			const binder = yield* RunBinder;
			const refPublication = yield* RefPublication;

			const released = (execution: Execution, release: GitHubRelease, tag: string) =>
				mergePublications(execution.publications, [{
					id: `github-release:${execution.repository}`,
					manager: 'github-release',
					name: execution.repository,
					version: tag,
					outcome: 'succeeded',
					required: true,
					...(typeof release.html_url === 'string' ? { url: release.html_url } : {}),
				}]).pipe(Effect.map((publications): Execution => ({
					...execution,
					publications,
					release: {
						id: `github:${execution.repositoryId}:${release.id}`,
						repository: { id: execution.repositoryId, name: execution.repository },
						stream: execution.stream,
						commit: releaseCommit(execution),
						version: execution.version ?? tag.replace(/^v/, ''),
						tag,
						releaseId: release.id,
						artifacts: [],
						publications: [],
					},
				})));

			const releaseBody = (execution: Execution, tag: string, token: string) =>
				automation.gateway.read(
					releaseNotesSchema,
					`/repos/${execution.repository}/releases/generate-notes`,
					token,
					'POST',
					{ tag_name: tag, target_commitish: releaseCommit(execution) },
				).pipe(Effect.map(generated => releaseNotes(generated.body)));

			const publishDraft = Effect.fnUntraced(function*(
				execution: Execution,
				draft: { id: number; tag: string },
				target: ReleaseTarget,
				token: string,
			) {
				const gateway = automation.gateway;
				const path = `/repos/${execution.repository}/releases/${draft.id}`;
				const release = yield* gateway.read(Schema.NullOr(releaseSchema), path, token);
				if (release === null) return yield* precondition('Draft GitHub release no longer exists');
				if (draft.tag !== target.tag || release.tag_name !== target.tag || release.prerelease !== target.prerelease) {
					return yield* precondition('Draft GitHub release does not match the release operation');
				}
				if (release.draft !== true) return release;
				const bot = yield* gateway.botIdentity;
				const listed = yield* gateway.read(
					mutableArray(releaseSchema),
					`/repos/${execution.repository}/releases?per_page=100`,
					token,
				);
				const siblings = listed.filter(other =>
					other.draft === true && other.tag_name === target.tag && other.id !== draft.id && other.author.id === bot.id
				);
				const names = new Set(release.assets.map(asset => asset.name));
				for (const other of siblings) {
					for (const asset of other.assets) {
						if (asset.state !== 'uploaded' || names.has(asset.name)) continue;
						yield* gateway.copyReleaseAsset(
							execution.repository,
							{ id: asset.id, name: asset.name, contentType: asset.content_type },
							draft.id,
							token,
						);
						names.add(asset.name);
					}
					yield* gateway.call(`/repos/${execution.repository}/releases/${other.id}`, token, 'DELETE');
				}
				return yield* gateway.read(releaseSchema, path, token, 'PATCH', {
					draft: false,
					body: yield* releaseBody(execution, target.tag, token),
				});
			});

			const published = Effect.fnUntraced(function*(input: Execution) {
				let execution = input;
				const policy = execution.workflow?.refs;
				const version = execution.version;
				const target = yield* fromSync(() => githubRelease(execution));
				const tagged = !policy
					|| execution.publications.some(p => p.id === `refs:${execution.operation}` && p.outcome === 'succeeded');
				if (
					!['failed', 'blocked', 'cancelled'].includes(execution.state) || execution.runId === undefined || !version
					|| !target
					|| !publishesGithubRelease(execution)
				) return execution;
				const { tag, prerelease } = target;
				const gateway = automation.gateway;
				const refs = yield* gateway.tagRefs(execution.repository, execution.repositoryId);
				const modulePrefixes = yield* refPublication.modulePrefixes(execution);
				let native = false;
				if (policy?.distribution && !execution.refPlan?.distribution) {
					const plan = yield* observedDistribution(gateway, execution, refs, modulePrefixes);
					if (!plan) return input;
					execution = { ...execution, refPlan: plan };
					native = true;
				}
				if (execution.refPlan && (yield* refPublication.distributionProblem(execution, execution.refPlan, refs))) {
					return input;
				}
				if (
					!refs.some(ref =>
						ref.name === tag && ref.commit === releaseCommit(execution) && (native || ref.oid !== ref.commit)
					)
				) {
					return input;
				}
				const read = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
				const release = yield* gateway.read(
					Schema.NullOr(releaseSchema),
					`/repos/${execution.repository}/releases/tags/${encodeURIComponent(tag)}`,
					read,
				);
				if (!release || release.tag_name !== tag || release.draft !== false || release.prerelease !== prerelease) {
					return input;
				}
				yield* verifyImmutableRelease(release, execution.workflow?.refs?.immutable);
				const fresh = yield* gateway.read(
					Schema.NullOr(gitRefSchema),
					`/repos/${execution.repository}/git/ref/tags/${encodeURIComponent(tag)}`,
					read,
				);
				if (!fresh || !refs.some(ref => ref.name === tag && ref.oid === fresh.object.sha)) return input;
				const pinned = yield* gateway.peelTag(execution.repository, fresh.object, read);
				if (pinned.type !== 'commit' || pinned.sha !== releaseCommit(execution)) return input;
				if (native) {
					for (const change of execution.refPlan?.changes ?? []) {
						if (change.name === tag) continue;
						const companion = yield* gateway.read(
							Schema.NullOr(gitRefSchema),
							`/repos/${execution.repository}/git/ref/tags/${encodeURIComponent(change.name)}`,
							read,
						);
						if (!companion || companion.object.sha !== change.expected) return input;
						const pinnedCompanion = yield* gateway.peelTag(execution.repository, companion.object, read);
						if (pinnedCompanion.type !== 'commit' || pinnedCompanion.sha !== releaseCommit(execution)) return input;
					}
				}
				let next = yield* released(execution, release, tag);
				const landed = !policy || (native
					? versionTagged(
						policy,
						yield* fromSync(() => decodeSync(semVer, version)),
						releaseCommit(execution),
						refs,
						modulePrefixes,
					)
					: (yield* refsLanded(
						policy,
						version,
						releaseCommit(execution),
						refs,
						modulePrefixes,
					)));
				if (!landed) return native ? input : next;
				if (policy && !tagged) {
					next = {
						...next,
						publications: yield* mergePublications(next.publications, [{
							id: `refs:${next.operation}`,
							manager: 'workflow',
							name: next.repository,
							version,
							outcome: 'succeeded',
							required: true,
						}]),
					};
				}
				if (native || next.state === 'cancelled' || next.state === 'blocked') {
					const settled = settle(next, true);
					if (settled.state !== 'succeeded') return input;
					delete settled.reason;
					return settled;
				}
				return publishedAfterFailure(next) ?? next;
			});

			return GitHubReleases.of({
				publish: Effect.fnUntraced(function*(id: string, identity: RunIdentity) {
					const { execution, workflow } = yield* binder.bind(id, identity, {
						_tag: 'SameRunAndName',
						mismatch: 'Release operation identity mismatch',
					});
					if (!publishesGithubRelease(execution)) {
						return yield* precondition(`Add github-release:${execution.repository} to this operation's publications`);
					}
					if (!(yield* refPublication.releaseCompleted(execution))) {
						return yield* precondition('Release operation requires a completed release');
					}
					if (
						workflow.refs?.distribution
						&& (!execution.refPlan?.distribution
							|| !execution.publications.some(publication =>
								publication.id === `refs:${execution.operation}` && publication.outcome === 'succeeded'
							))
					) {
						return yield* precondition('Confirm distribution refs and ancestry before publishing the release');
					}
					const target = yield* fromSync(() => githubRelease(execution));
					if (!target) return yield* precondition('Release operation has no version');
					const { tag, prerelease } = target;
					const gateway = automation.gateway;
					if (execution.refPlan?.distribution) {
						const refs = yield* gateway.tagRefs(execution.repository, execution.repositoryId);
						const problem = yield* refPublication.distributionProblem(execution, execution.refPlan, refs);
						if (problem) return yield* precondition(problem);
					}
					const repository = `/repos/${execution.repository}`;
					const read = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
					yield* requireImmutableReleases({
						gateway,
						repository: execution.repository,
						token: read,
						required: workflow.refs?.immutable,
					});
					const ref = yield* gateway.read(
						Schema.NullOr(gitRefSchema),
						`${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
						read,
					);
					if (ref === null) return yield* precondition('Publish the release tag before the release');
					const object = ref.object;
					if (object.type !== 'tag') return yield* precondition('Release tag must be annotated');
					const pinned = yield* gateway.peelTag(execution.repository, object, read);
					if (pinned.type !== 'commit' || pinned.sha !== releaseCommit(execution)) {
						return yield* precondition('Release tag points to another commit');
					}
					const write = yield* gateway.token(execution.repository, execution.repositoryId, {
						contents: 'write',
						workflows: 'write',
					});
					const release = execution.draftRelease
						? yield* publishDraft(execution, execution.draftRelease, target, write)
						: (yield* gateway.read(
							Schema.NullOr(releaseSchema),
							`${repository}/releases/tags/${encodeURIComponent(tag)}`,
							read,
						))
							?? (yield* gateway.read(releaseSchema, `${repository}/releases`, write, 'POST', {
								tag_name: tag,
								target_commitish: releaseCommit(execution),
								name: tag,
								body: yield* releaseBody(execution, tag, write),
								prerelease,
							}));
					if (release.tag_name !== tag || release.draft !== false || release.prerelease !== prerelease) {
						return yield* precondition('Existing GitHub release does not match the release operation');
					}
					yield* verifyImmutableRelease(release, workflow.refs?.immutable);
					const next = yield* released(execution, release, tag);
					yield* executions.put(next);
					return next;
				}),
				published,
				releasePublished: Effect.fnUntraced(function*(tag: string) {
					for (const execution of yield* executions.all) {
						if (!recoverable(execution) || !execution.version) continue;
						if ((yield* fromSync(() => githubRelease(execution)))?.tag !== tag) continue;
						const next = yield* published(execution);
						if (next !== execution) yield* executions.put(next);
					}
				}),
				draft: Effect.fnUntraced(function*(execution: Execution) {
					const target = yield* fromSync(() => githubRelease(execution));
					if (!target || !publishesGithubRelease(execution)) return execution.draftRelease;
					if (execution.workflow?.refs?.distribution && !execution.refPlan?.distribution) return undefined;
					const gateway = automation.gateway;
					const write = yield* gateway.token(execution.repository, execution.repositoryId, {
						contents: 'write',
						workflows: 'write',
					});
					if (execution.draftRelease) {
						const kept = yield* gateway.call(
							`/repos/${execution.repository}/releases/${execution.draftRelease.id}`,
							write,
						);
						if (kept !== null) return execution.draftRelease;
					}
					const bot = yield* gateway.botIdentity;
					const drafts = (yield* gateway.read(
						mutableArray(releaseSchema),
						`/repos/${execution.repository}/releases?per_page=100`,
						write,
					)).filter(release => release.draft === true && release.tag_name === target.tag);
					const matches = (release: GitHubRelease) =>
						release.target_commitish === releaseCommit(execution) && release.prerelease === target.prerelease;
					for (const stale of drafts.filter(release => !matches(release) && release.author.id === bot.id)) {
						yield* gateway.call(`/repos/${execution.repository}/releases/${stale.id}`, write, 'DELETE');
					}
					const existing = drafts.find(matches);
					const release = existing ?? (yield* gateway.read(
						releaseSchema,
						`/repos/${execution.repository}/releases`,
						write,
						'POST',
						{
							tag_name: target.tag,
							target_commitish: releaseCommit(execution),
							name: target.tag,
							prerelease: target.prerelease,
							draft: true,
						},
					));
					return { id: release.id, tag: target.tag };
				}),
			});
		}),
	);
}
