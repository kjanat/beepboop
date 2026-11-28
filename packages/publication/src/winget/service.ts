import { Clock, Effect, Schema } from 'effect';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import { repositorySnapshot } from '@/automation/snapshot';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import { readiness } from '@/domain/repository';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import {
	checkRunsSchema,
	commitStatusSchema,
	createdSchema,
	gitCommitSchema,
	gitRefSchema,
} from '@/github/resources.ts';
import { fromPromise, fromSync, recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import { sha256Hex } from '@/kernel/schema/ids.ts';
import { countSchema, decode, looseSchema, record, shaSchema, text, textSchema } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import { AuditStore } from '@/persistence/d1/audit';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { sql } from '@/persistence/d1/database';
import { WinGetSubmissions } from '@/publication/adapters/d1/winget-submissions.ts';
import { generateManifests, renderManifests, wingetConfiguration } from '@/publication/distribution/winget/generate.ts';
import type { WinGetPlan, WinGetRelease, WinGetSubmission } from '@/publication/winget/submission.ts';
import { parseSubmission, submissionBranch } from '@/publication/winget/submission.ts';

const releaseListing = mutableArray(mutableStruct({
	id: looseSchema,
	tag_name: looseSchema,
	name: looseSchema,
	draft: looseSchema,
	prerelease: looseSchema,
	published_at: looseSchema,
}));
const publicRepository = mutableStruct({ private: looseSchema });
const stableRelease = mutableStruct({
	id: looseSchema,
	draft: looseSchema,
	prerelease: looseSchema,
	published_at: Schema.optional(Schema.NullOr(Schema.String)),
	tag_name: textSchema,
	html_url: textSchema,
	body: looseSchema,
});
const releaseAssets = mutableArray(
	mutableStruct({ name: textSchema, digest: looseSchema, state: looseSchema, browser_download_url: looseSchema }),
);
const forkRepository = mutableStruct({
	fork: looseSchema,
	parent: Schema.optional(mutableStruct({ full_name: looseSchema })),
});
const upstreamRepository = mutableStruct({ default_branch: textSchema });
const winGetPull = mutableStruct({
	number: Schema.Finite,
	html_url: textSchema,
	head: mutableStruct({ sha: shaSchema }),
	merged_at: looseSchema,
	state: looseSchema,
});
type WinGetPull = Decoded<typeof winGetPull>;
const submitter = mutableStruct({ login: textSchema, id: countSchema });
const branchComparison = mutableStruct({
	files: mutableArray(mutableStruct({ status: looseSchema, filename: looseSchema })),
});
const fileContent = mutableStruct({ content: textSchema });
const reviewList = mutableArray(mutableStruct({ state: looseSchema, user: looseSchema }));

export interface WinGetBindings {
	WINGET_GITHUB_TOKEN?: string;
	WINGET_FORK?: string;
}
const upstream = 'microsoft/winget-pkgs';
function planDigest(value: unknown): Effect.Effect<string, DomainError> {
	return fromPromise(() => sha256Hex(JSON.stringify(value)));
}
export class WinGetService {
	private readonly submissions: WinGetSubmissions;
	private readonly audit: AuditStore;
	constructor(db: SqlDatabase | Sql, readonly gateway: RepositoryGateway, readonly env: WinGetBindings) {
		const statements = sql(db);
		this.submissions = new WinGetSubmissions(statements);
		this.audit = new AuditStore(statements);
	}
	setup(): boolean {
		return !!this.env.WINGET_GITHUB_TOKEN && repositoryNamePattern.test(this.env.WINGET_FORK ?? '');
	}
	private verifiedFork(failure: string): Effect.Effect<{ token: string; fork: string }, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const token = yield* Effect.fromResult(text(self.env.WINGET_GITHUB_TOKEN));
			const fork = yield* Effect.fromResult(text(self.env.WINGET_FORK));
			const forkInfo = yield* self.gateway.read(forkRepository, `/repos/${fork}`, token);
			if (!forkInfo.fork || forkInfo.parent?.full_name !== upstream) return yield* precondition(failure);
			return { token, fork };
		});
	}
	private submissionPull(head: string, token: string) {
		return this.gateway.read(
			mutableArray(winGetPull),
			`/repos/${upstream}/pulls?state=all&head=${encodeURIComponent(head)}&per_page=100`,
			token,
		).pipe(Effect.flatMap(pulls =>
			pulls.length > 1
				? Effect.fail(precondition('Multiple matching WinGet pull requests'))
				: Effect.succeed(pulls[0])
		));
	}
	private policy(repo: RepositoryRecord) {
		const state = readiness(repo);
		if (state.kind !== 'ready' || !state.repository.configuration.winget) {
			return Effect.fail(precondition('Repository is not enabled for WinGet'));
		}
		return Effect.succeed(state.repository.configuration.winget);
	}
	releases(repo: RepositoryRecord): Effect.Effect<WinGetRelease[], DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const policy = yield* self.policy(repo);
			const token = yield* self.gateway.token(repo.name, repo.id, { contents: 'read' });
			const releases = yield* self.gateway.read(releaseListing, `/repos/${repo.name}/releases?per_page=30`, token);
			return releases.flatMap(release => {
				const tag = release.tag_name;
				return !release.draft && !release.prerelease && typeof tag === 'string' && tag.startsWith(policy.tagPrefix)
						&& /^\d+\.\d+\.\d+$/.test(tag.slice(policy.tagPrefix.length))
					? [{
						id: Number(release.id),
						tag,
						name: String(release.name || tag),
						publishedAt: Date.parse(String(release.published_at)),
					}]
					: [];
			});
		});
	}
	plan(repo: RepositoryRecord, releaseId: number): Effect.Effect<WinGetPlan, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const policy = yield* self.policy(repo);
			const token = yield* self.gateway.token(repo.name, repo.id, { contents: 'read' });
			const metadata = yield* self.gateway.read(publicRepository, `/repos/${repo.name}`, token);
			if (metadata.private !== false) {
				return yield* precondition('WinGet installers must come from a public repository');
			}
			const release = yield* self.gateway.read(stableRelease, `/repos/${repo.name}/releases/${releaseId}`, token);
			const publishedAt = release.published_at;
			if (release.id !== releaseId || release.draft || release.prerelease || !publishedAt) {
				return yield* precondition('Select a published stable release');
			}
			const tag = release.tag_name;
			if (!tag.startsWith(policy.tagPrefix)) {
				return yield* precondition('Release tag does not match the configured prefix');
			}
			const version = tag.slice(policy.tagPrefix.length);
			const snapshot = yield* repositorySnapshot(self.gateway, repo.name, repo.id, tag, [policy.config]);
			const source = yield* Effect.fromResult(text(snapshot.files[policy.config]));
			const configuration = yield* Effect.fromResult(
				decode(wingetConfiguration, yield* fromSync((): unknown => JSON.parse(source))),
			);
			const assets = yield* self.gateway.read(
				releaseAssets,
				`/repos/${repo.name}/releases/${releaseId}/assets?per_page=100`,
				token,
			);
			if (assets.length === 100) return yield* precondition('Release asset limit exceeded');
			const checksums = assets.flatMap(asset =>
				typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
					? [`${asset.digest.slice(7)}  ${asset.name}`]
					: []
			).join('\n');
			const releaseDate = publishedAt.slice(0, 10);
			const manifests = yield* generateManifests({
				configuration,
				version,
				tag,
				checksums,
				releaseDate,
				releaseNotes: String(release.body ?? ''),
			});
			for (const installer of manifests.installer.Installers) {
				const asset = assets.find(asset => asset.browser_download_url === installer.InstallerUrl);
				if (
					asset?.state !== 'uploaded'
					|| String(asset.digest).toUpperCase() !== `SHA256:${installer.InstallerSha256}`
				) {
					return yield* precondition('Installer must match an uploaded release asset and its GitHub SHA-256 digest');
				}
			}
			const packageIdentifier = manifests.version.PackageIdentifier;
			if (!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9_-]+)+$/.test(packageIdentifier)) {
				return yield* precondition('Invalid WinGet package path');
			}
			const directory = `manifests/${packageIdentifier[0]?.toLowerCase()}/${
				packageIdentifier.replaceAll('.', '/')
			}/${version}`;
			const files = Object.fromEntries(
				Object.entries(renderManifests(manifests)).map(([name, content]) => [`${directory}/${name}`, content]),
			);
			const base = {
				id: `${repo.id}:${releaseId}`,
				repositoryId: repo.id,
				repository: repo.name,
				releaseId,
				tag,
				version,
				packageIdentifier,
				sourceSha: snapshot.sha,
				configurationSha: yield* planDigest(policy),
				files,
				releaseUrl: release.html_url,
			};
			return { ...base, digest: yield* planDigest(base) };
		});
	}
	list(): Effect.Effect<WinGetSubmission[], DomainError> {
		return this.submissions.recent();
	}
	latestByRepository(): Effect.Effect<Map<number, WinGetSubmission>, DomainError> {
		return this.submissions.latestPerRepository().pipe(
			Effect.map(submissions => new Map(submissions.map(submission => [submission.plan.repositoryId, submission]))),
		);
	}
	get(id: string): Effect.Effect<WinGetSubmission | undefined, DomainError> {
		return this.submissions.get(id);
	}
	private replaceFailedPlan(
		saved: WinGetSubmission,
		pending: WinGetSubmission,
		lease: string,
	): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const clock = yield* Clock.Clock;

			if (saved.state !== 'failed' || saved.number || saved.url || saved.head) {
				return yield* precondition('The previous plan is already submitted or in progress; it cannot be replaced');
			}
			const { token, fork } = yield* self.verifiedFork('Cannot verify the previous submission fork');
			const branch = submissionBranch(saved.plan);
			const pulls = yield* self.gateway.read(
				mutableArray(Schema.Unknown),
				`/repos/${upstream}/pulls?state=all&head=${encodeURIComponent(`${fork.split('/')[0]}:${branch}`)}&per_page=100`,
				token,
			);
			const ref = yield* self.gateway.call(`/repos/${fork}/git/ref/heads/${branch}`, token);
			if (pulls.length || ref) {
				return yield* precondition(
					'The previous plan has a branch or pull request; inspect it before changing the submission',
				);
			}
			const updated = yield* self.submissions.replace(pending, lease, clock.currentTimeMillisUnsafe());
			if (!updated) return yield* precondition('Submission lease expired; preview again');
		});
	}
	submit(
		repo: RepositoryRecord,
		releaseId: number,
		expectedDigest: string,
	): Effect.Effect<WinGetSubmission, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const clock = yield* Clock.Clock;

			if (!self.setup()) return yield* precondition('Configure the WinGet bot token and fork before submitting');
			const plan = yield* self.plan(repo, releaseId);
			if (plan.digest !== expectedDigest) return yield* precondition('Release or configuration changed; preview again');
			const pending: WinGetSubmission = { plan, state: 'pending', updatedAt: clock.currentTimeMillisUnsafe() };
			yield* self.submissions.insert(pending);
			if (!(yield* self.get(plan.id))) {
				return yield* precondition('This package version already has a different submission; inspect its existing PR');
			}
			const lease = crypto.randomUUID();
			const locked = yield* self.submissions.lock(
				plan.id,
				lease,
				clock.currentTimeMillisUnsafe() + 600_000,
				clock.currentTimeMillisUnsafe(),
			);
			if (!locked) return yield* precondition('Submission is already in progress; refresh shortly');
			let attempted: WinGetSubmission | undefined;
			return yield* Effect.gen(function*() {
				// Re-read under the lease so a concurrent completed attempt cannot be overwritten.
				let saved = yield* self.get(plan.id);
				if (!saved) return yield* precondition('Submission record disappeared');
				if (saved.plan.digest !== plan.digest) {
					yield* self.replaceFailedPlan(saved, pending, lease);
					saved = pending;
				}
				if (saved.state === 'merged' || saved.state === 'closed') return saved;
				attempted = saved;
				const { token, fork } = yield* self.verifiedFork(
					'Configured repository must be a fork of microsoft/winget-pkgs',
				);
				const baseBranch = (yield* self.gateway.read(upstreamRepository, `/repos/${upstream}`, token)).default_branch;
				const branch = submissionBranch(plan);
				const head = `${fork.split('/')[0]}:${branch}`;
				let pull = yield* self.submissionPull(head, token);
				if (!pull) {
					let ref = yield* self.gateway.read(
						Schema.NullOr(gitRefSchema),
						`/repos/${fork}/git/ref/heads/${branch}`,
						token,
					);
					const recovered = ref !== null;
					if (!ref) {
						const base = yield* self.gateway.read(
							gitRefSchema,
							`/repos/${upstream}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
							token,
						);
						const parent = base.object.sha;
						const commit = yield* self.gateway.read(gitCommitSchema, `/repos/${upstream}/git/commits/${parent}`, token);
						const tree = yield* self.gateway.read(createdSchema, `/repos/${fork}/git/trees`, token, 'POST', {
							base_tree: commit.tree.sha,
							tree: Object.entries(plan.files).map(([path, content]) => ({
								path,
								mode: '100644',
								type: 'blob',
								content,
							})),
						});
						const bot = yield* self.gateway.botIdentity;
						const { login, id: submitterId } = yield* self.gateway.read(submitter, '/user', token);
						const created = yield* self.gateway.read(createdSchema, `/repos/${fork}/git/commits`, token, 'POST', {
							message:
								`New version: ${plan.packageIdentifier} ${plan.version}\n\nCo-authored-by: ${login} <${submitterId}+${login}@users.noreply.github.com>`,
							author: { name: bot.login, email: bot.email },
							tree: tree.sha,
							parents: [parent],
						});
						ref = yield* self.gateway.read(gitRefSchema, `/repos/${fork}/git/refs`, token, 'POST', {
							ref: `refs/heads/${branch}`,
							sha: created.sha,
						});
					}
					if (recovered) {
						const headSha = ref.object.sha;
						const comparison = yield* self.gateway.read(
							branchComparison,
							`/repos/${upstream}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(head)}`,
							token,
						);
						const changed = comparison.files;
						if (
							changed.length !== Object.keys(plan.files).length
							|| changed.some(file => file.status !== 'added' || !Object.hasOwn(plan.files, String(file.filename)))
						) return yield* precondition('Submission branch contains unexpected changes');
						for (const [path, content] of Object.entries(plan.files)) {
							const file = yield* self.gateway.read(
								fileContent,
								`/repos/${fork}/contents/${path}?ref=${headSha}`,
								token,
							);
							const decoded = yield* fromSync(() =>
								new TextDecoder().decode(
									Uint8Array.from(atob(file.content.replaceAll('\n', '')), c => c.charCodeAt(0)),
								)
							);
							if (decoded !== content) return yield* precondition('Submission branch content changed');
						}
					}
					pull = yield* self.gateway.read(winGetPull, `/repos/${upstream}/pulls`, token, 'POST', {
						title: `New version: ${plan.packageIdentifier} ${plan.version}`,
						base: baseBranch,
						head,
						maintainer_can_modify: true,
						body:
							`Release: ${plan.releaseUrl}\nSource commit: ${plan.sourceSha}\n\nInstaller SHA-256 values verified against GitHub release assets.`,
					});
				}
				const result = self.pullState(plan, pull, clock.currentTimeMillisUnsafe());
				attempted = result;
				yield* self.submissions.save(result, lease).pipe(
					logRecovered('winget.save-failed', { submissionId: plan.id, url: result.url }),
				);
				yield* self.audit.record('winget', 'winget.submit', result.url ?? plan.id).pipe(
					logRecovered('winget.audit-failed', { submissionId: plan.id }),
				);
				return result;
			}).pipe(
				Effect.tapError(error =>
					attempted
						? self.submissions.save({
							...attempted,
							state: 'failed',
							reason: decodeError(error),
							updatedAt: clock.currentTimeMillisUnsafe(),
						}, lease)
						: Effect.void
				),
				Effect.ensuring(self.submissions.unlock(plan.id, lease).pipe(Effect.ignore)),
			);
		});
	}
	private pullState(plan: WinGetPlan, pull: WinGetPull, now: number): WinGetSubmission {
		return {
			plan,
			number: pull.number,
			url: pull.html_url,
			head: pull.head.sha,
			state: pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'open',
			updatedAt: now,
		};
	}
	private openSubmissions(after: string | null): Effect.Effect<{ id: string; document: string }[], DomainError> {
		return Effect.clockWith(clock => this.submissions.open(after, clock.currentTimeMillisUnsafe()));
	}
	private reconcileOne(saved: WinGetSubmission): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const clock = yield* Clock.Clock;

			if (!['pending', 'open'].includes(saved.state)) return;
			const token = yield* Effect.fromResult(text(self.env.WINGET_GITHUB_TOKEN));
			if (!saved.number) {
				const fork = yield* Effect.fromResult(text(self.env.WINGET_FORK));
				const plan = saved.plan;
				const branch = submissionBranch(plan);
				const recovered = yield* self.submissionPull(`${fork.split('/')[0]}:${branch}`, token);
				if (!recovered) return;
				yield* self.submissions.settle(
					self.pullState(plan, recovered, clock.currentTimeMillisUnsafe()),
					clock.currentTimeMillisUnsafe(),
					clock.currentTimeMillisUnsafe(),
				);
				return;
			}
			const pull = yield* self.gateway.read(winGetPull, `/repos/${upstream}/pulls/${saved.number}`, token);
			const next = self.pullState(saved.plan, pull, clock.currentTimeMillisUnsafe());
			const checks = yield* self.gateway.read(
				checkRunsSchema,
				`/repos/${upstream}/commits/${next.head}/check-runs?per_page=100`,
				token,
			);
			const runs = checks.check_runs;
			const statuses = yield* self.gateway.read(
				commitStatusSchema,
				`/repos/${upstream}/commits/${next.head}/status`,
				token,
			);
			const reviews = yield* self.gateway.read(
				reviewList,
				`/repos/${upstream}/pulls/${saved.number}/reviews?per_page=100`,
				token,
			);
			const latestReviews = new Map<string, string>();
			for (const review of reviews) {
				if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(String(review.state))) {
					const user = yield* Effect.fromResult(record(review.user));
					latestReviews.set(String(user.login), String(review.state));
				}
			}
			next.reviews = [...latestReviews.values()].includes('CHANGES_REQUESTED')
				? 'Changes requested'
				: 'Awaiting review';
			next.checks =
				(Number(checks.total_count) > 100 || statuses.state === 'pending' && Number(statuses.total_count) > 0)
					? 'pending'
					: statuses.state === 'failure' || statuses.state === 'error'
					? 'failed'
					: runs.some(run => run.status !== 'completed')
					? 'pending'
					: runs.some(run => !['success', 'neutral', 'skipped'].includes(String(run.conclusion)))
					? 'failed'
					: runs.length || statuses.state === 'success' && Number(statuses.total_count) > 0
					? 'passed'
					: 'pending';
			yield* self.submissions.settle(next, next.updatedAt, clock.currentTimeMillisUnsafe());
		});
	}
	reconcile(): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (!self.setup()) return;
			let after: string | null = null;
			while (true) {
				const rows: { id: string; document: string }[] = yield* self.openSubmissions(after);
				if (!rows.length) return;
				for (const row of rows) {
					// Use the stable ID: reconciliation changes both state and updated_at.
					after = row.id;
					const saved = yield* fromSync(() => parseSubmission(row.document));
					yield* self.reconcileOne(saved).pipe(logRecovered('winget.status-failed', { id: saved.plan.id }));
				}
			}
		});
	}
	watch(repo: RepositoryRecord): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock =>
			repo.configuration?.winget?.automatic
				? this.submissions.watch(repo.id, clock.currentTimeMillisUnsafe())
				: this.submissions.unwatch(repo.id)
		);
	}
	automatic(repo: RepositoryRecord): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (
				readiness(repo).kind !== 'ready' || !repo.configuration?.winget?.automatic || !self.setup()
			) return;
			yield* self.watch(repo);
			const since = yield* self.submissions.watchedSince(repo.id);
			for (const release of yield* self.releases(repo)) {
				if (since === undefined || release.publishedAt <= since) continue;
				// Enabling automation must not submit historical releases without review.
				const existing = yield* self.get(`${repo.id}:${release.id}`);
				if (!existing || existing.state === 'failed' || existing.state === 'pending') {
					yield* self.plan(repo, release.id).pipe(
						Effect.flatMap(plan => self.submit(repo, release.id, plan.digest)),
						recover(error => self.audit.record('winget', 'winget.failed', `${repo.name}: ${decodeError(error)}`)),
					);
				}
			}
		});
	}
}
