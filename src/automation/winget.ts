import { Effect } from 'effect';
import { z } from 'zod';
import type { RepositoryGateway } from '@/automation/github';
import { documentRow } from '@/automation/schemas';
import { decodeError, type Store } from '@/automation/store';
import type { RepositoryRecord } from '@/automation/types';
import { type DomainError, precondition } from '@/contract/errors';
import { generateManifests, renderManifests } from '@/distribution/winget/generate';
import { readiness } from '@/domain/repository';
import { fromPromise, fromSync, recover } from '@/failure';
import { array, integer, record, sha, text } from '@/model';
import { parse, type Sql, sql } from '@/persistence/d1/database';

export interface WinGetPlan {
	id: string;
	repositoryId: number;
	repository: string;
	releaseId: number;
	tag: string;
	version: string;
	packageIdentifier: string;
	sourceSha: string;
	configurationSha: string;
	files: Record<string, string>;
	digest: string;
	releaseUrl: string;
}
export interface WinGetSubmission {
	plan: WinGetPlan;
	state: 'pending' | 'open' | 'merged' | 'closed' | 'failed';
	number?: number;
	url?: string;
	head?: string;
	checks?: string;
	reviews?: string;
	reason?: string;
	updatedAt: number;
}
export interface WinGetRelease {
	id: number;
	tag: string;
	name: string;
	publishedAt: number;
}
const submissionSchema: z.ZodType<WinGetSubmission> = z.object({
	plan: z.object({
		id: z.string(),
		repositoryId: z.number(),
		repository: z.string(),
		releaseId: z.number(),
		tag: z.string(),
		version: z.string(),
		packageIdentifier: z.string(),
		sourceSha: z.string(),
		configurationSha: z.string(),
		files: z.record(z.string(), z.string()),
		releaseUrl: z.string(),
		digest: z.string(),
	}),
	state: z.enum(['pending', 'open', 'merged', 'closed', 'failed']),
	number: z.number().optional(),
	url: z.string().optional(),
	head: z.string().optional(),
	checks: z.string().optional(),
	reviews: z.string().optional(),
	reason: z.string().optional(),
	updatedAt: z.number(),
});
function parseSubmission(document: string): WinGetSubmission {
	return submissionSchema.parse(JSON.parse(document));
}
const submissionRow = z.object({ id: z.string(), document: z.string() });
export interface WinGetBindings {
	WINGET_GITHUB_TOKEN?: string;
	WINGET_FORK?: string;
}
const upstream = 'microsoft/winget-pkgs';
function planDigest(value: unknown): Effect.Effect<string, DomainError> {
	return fromPromise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))).pipe(
		Effect.map(digest => [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')),
	);
}
export class WinGetService {
	constructor(readonly store: Store, readonly gateway: RepositoryGateway, readonly env: WinGetBindings) {}
	setup(): boolean {
		return !!this.env.WINGET_GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(this.env.WINGET_FORK ?? '');
	}
	private policy(repo: RepositoryRecord) {
		const state = readiness(repo);
		if (state.kind !== 'ready' || !state.repository.configuration.winget) {
			return Effect.fail(precondition('Repository is not enabled for WinGet'));
		}
		return Effect.succeed(state.repository.configuration.winget);
	}
	private get sql(): Sql {
		return sql(this.store.db);
	}
	private documents(rows: unknown[]): Effect.Effect<WinGetSubmission[], DomainError> {
		return fromSync(() => rows.map(row => parseSubmission(documentRow.parse(row).document)));
	}
	releases(repo: RepositoryRecord): Effect.Effect<WinGetRelease[], DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const policy = yield* self.policy(repo);
			const token = yield* self.gateway.token(repo.name, repo.id, { contents: 'read' });
			const releases = yield* self.gateway.call(`/repos/${repo.name}/releases?per_page=30`, token);
			return yield* fromSync(() =>
				array(releases).map(record)
					.filter(release =>
						!release.draft && !release.prerelease && typeof release.tag_name === 'string'
						&& release.tag_name.startsWith(policy.tagPrefix)
						&& /^\d+\.\d+\.\d+$/.test(release.tag_name.slice(policy.tagPrefix.length))
					)
					.map(release => ({
						id: Number(release.id),
						tag: text(release.tag_name),
						name: String(release.name || release.tag_name),
						publishedAt: Date.parse(String(release.published_at)),
					}))
			);
		});
	}
	plan(repo: RepositoryRecord, releaseId: number): Effect.Effect<WinGetPlan, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			const policy = yield* self.policy(repo);
			const token = yield* self.gateway.token(repo.name, repo.id, { contents: 'read' });
			const metadata = record(yield* self.gateway.call(`/repos/${repo.name}`, token));
			if (metadata.private !== false) {
				return yield* precondition('WinGet installers must come from a public repository');
			}
			const release = record(yield* self.gateway.call(`/repos/${repo.name}/releases/${releaseId}`, token));
			if (release.id !== releaseId || release.draft || release.prerelease || !release.published_at) {
				return yield* precondition('Select a published stable release');
			}
			const tag = yield* fromSync(() => text(release.tag_name));
			if (!tag.startsWith(policy.tagPrefix)) {
				return yield* precondition('Release tag does not match the configured prefix');
			}
			const version = tag.slice(policy.tagPrefix.length);
			const snapshot = yield* self.gateway.snapshot(repo.name, repo.id, tag, [policy.config]);
			const configuration = yield* fromSync(() => JSON.parse(text(snapshot.files[policy.config])));
			const assets = array(
				yield* self.gateway.call(`/repos/${repo.name}/releases/${releaseId}/assets?per_page=100`, token),
			).map(record);
			if (assets.length === 100) return yield* precondition('Release asset limit exceeded');
			const checksums = assets.filter(asset =>
				typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
			)
				.map(asset => `${String(asset.digest).slice(7)}  ${text(asset.name)}`).join('\n');
			const releaseDate = yield* fromSync(() => text(release.published_at).slice(0, 10));
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
				releaseUrl: yield* fromSync(() => text(release.html_url)),
			};
			return { ...base, digest: yield* planDigest(base) };
		});
	}
	list(): Effect.Effect<WinGetSubmission[], DomainError> {
		return this.sql.all('SELECT document FROM winget_submissions ORDER BY updated_at DESC LIMIT 100').pipe(
			Effect.flatMap(rows => this.documents(rows)),
		);
	}
	latestByRepository(): Effect.Effect<Map<number, WinGetSubmission>, DomainError> {
		return this.sql.all(
			"SELECT document FROM (SELECT document,ROW_NUMBER() OVER (PARTITION BY json_extract(document,'$.plan.repositoryId') ORDER BY json_extract(document,'$.plan.releaseId') DESC) AS position FROM winget_submissions) WHERE position=1",
		).pipe(
			Effect.flatMap(rows => this.documents(rows)),
			Effect.map(submissions => new Map(submissions.map(submission => [submission.plan.repositoryId, submission]))),
		);
	}
	get(id: string): Effect.Effect<WinGetSubmission | undefined, DomainError> {
		return this.sql.first('SELECT document FROM winget_submissions WHERE id=?', id).pipe(
			Effect.flatMap(row =>
				fromSync(() => {
					const parsed = documentRow.nullable().parse(row);
					return parsed ? parseSubmission(parsed.document) : undefined;
				})
			),
		);
	}
	private save(value: WinGetSubmission, lease: string): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'UPDATE winget_submissions SET document=?,updated_at=? WHERE id=? AND lease=?',
			JSON.stringify(value),
			value.updatedAt,
			value.plan.id,
			lease,
		).pipe(Effect.asVoid);
	}
	private replaceFailedPlan(
		saved: WinGetSubmission,
		pending: WinGetSubmission,
		lease: string,
	): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (saved.state !== 'failed' || saved.number || saved.url || saved.head) {
				return yield* precondition('The previous plan is already submitted or in progress; it cannot be replaced');
			}
			const token = yield* fromSync(() => text(self.env.WINGET_GITHUB_TOKEN));
			const fork = yield* fromSync(() => text(self.env.WINGET_FORK));
			const forkInfo = record(yield* self.gateway.call(`/repos/${fork}`, token));
			if (!forkInfo.fork || record(forkInfo.parent).full_name !== upstream) {
				return yield* precondition('Cannot verify the previous submission fork');
			}
			const old = saved.plan;
			const branch = `winget/${old.packageIdentifier}/${old.version}/${old.digest.slice(0, 16)}`;
			const pulls = array(
				yield* self.gateway.call(
					`/repos/${upstream}/pulls?state=all&head=${
						encodeURIComponent(`${fork.split('/')[0]}:${branch}`)
					}&per_page=100`,
					token,
				),
			);
			const ref = yield* self.gateway.call(`/repos/${fork}/git/ref/heads/${branch}`, token);
			if (pulls.length || ref) {
				return yield* precondition(
					'The previous plan has a branch or pull request; inspect it before changing the submission',
				);
			}
			const updated = yield* self.sql.run(
				'UPDATE winget_submissions SET package=?,version=?,document=?,updated_at=? WHERE id=? AND lease=? AND lease_until>?',
				pending.plan.packageIdentifier,
				pending.plan.version,
				JSON.stringify(pending),
				pending.updatedAt,
				pending.plan.id,
				lease,
				Date.now(),
			);
			if (!updated.meta.changes) return yield* precondition('Submission lease expired; preview again');
		});
	}
	submit(
		repo: RepositoryRecord,
		releaseId: number,
		expectedDigest: string,
	): Effect.Effect<WinGetSubmission, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (!self.setup()) return yield* precondition('Configure the WinGet bot token and fork before submitting');
			const plan = yield* self.plan(repo, releaseId);
			if (plan.digest !== expectedDigest) return yield* precondition('Release or configuration changed; preview again');
			const pending: WinGetSubmission = { plan, state: 'pending', updatedAt: Date.now() };
			yield* self.sql.run(
				'INSERT OR IGNORE INTO winget_submissions(id,package,version,document,updated_at) VALUES(?,?,?,?,?)',
				plan.id,
				plan.packageIdentifier,
				plan.version,
				JSON.stringify(pending),
				pending.updatedAt,
			);
			if (!(yield* self.get(plan.id))) {
				return yield* precondition('This package version already has a different submission; inspect its existing PR');
			}
			const lease = crypto.randomUUID();
			const locked = yield* self.sql.run(
				'UPDATE winget_submissions SET lease=?,lease_until=? WHERE id=? AND lease_until<?',
				lease,
				Date.now() + 600_000,
				plan.id,
				Date.now(),
			);
			if (!locked.meta.changes) return yield* precondition('Submission is already in progress; refresh shortly');
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
				const token = yield* fromSync(() => text(self.env.WINGET_GITHUB_TOKEN));
				const fork = yield* fromSync(() => text(self.env.WINGET_FORK));
				const call = (path: string, method = 'GET', body?: unknown) =>
					self.gateway.call(path, token, method, body).pipe(Effect.map(record));
				const forkInfo = yield* call(`/repos/${fork}`);
				if (!forkInfo.fork || record(forkInfo.parent).full_name !== upstream) {
					return yield* precondition('Configured repository must be a fork of microsoft/winget-pkgs');
				}
				const target = yield* call(`/repos/${upstream}`);
				const baseBranch = yield* fromSync(() => text(target.default_branch));
				const branch = `winget/${plan.packageIdentifier}/${plan.version}/${plan.digest.slice(0, 16)}`;
				const head = `${fork.split('/')[0]}:${branch}`;
				const pulls = array(
					yield* self.gateway.call(
						`/repos/${upstream}/pulls?state=all&head=${encodeURIComponent(head)}&per_page=100`,
						token,
					),
				).map(record);
				if (pulls.length > 1) return yield* precondition('Multiple matching WinGet pull requests');
				let pull = pulls[0];
				if (!pull) {
					let ref = yield* self.gateway.call(`/repos/${fork}/git/ref/heads/${branch}`, token);
					if (!ref) {
						const base = yield* call(`/repos/${upstream}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
						const parent = yield* fromSync(() => sha(record(base.object).sha));
						const commit = yield* call(`/repos/${upstream}/git/commits/${parent}`);
						const baseTree = yield* fromSync(() => sha(record(commit.tree).sha));
						const tree = yield* call(`/repos/${fork}/git/trees`, 'POST', {
							base_tree: baseTree,
							tree: Object.entries(plan.files).map(([path, content]) => ({
								path,
								mode: '100644',
								type: 'blob',
								content,
							})),
						});
						const bot = yield* self.gateway.botIdentity;
						const submitter = yield* call('/user');
						const login = yield* fromSync(() => text(submitter.login));
						const submitterId = yield* fromSync(() => integer(submitter.id));
						const treeSha = yield* fromSync(() => sha(tree.sha));
						const created = yield* call(`/repos/${fork}/git/commits`, 'POST', {
							message:
								`New version: ${plan.packageIdentifier} ${plan.version}\n\nCo-authored-by: ${login} <${submitterId}+${login}@users.noreply.github.com>`,
							author: { name: bot.login, email: bot.email },
							tree: treeSha,
							parents: [parent],
						});
						const createdSha = yield* fromSync(() => sha(created.sha));
						ref = yield* call(`/repos/${fork}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: createdSha });
					}
					// Verify a recovered branch before opening a PR after an interrupted attempt.
					const recovered = ref;
					const headSha = yield* fromSync(() => sha(record(record(recovered).object).sha));
					const comparison = yield* call(
						`/repos/${upstream}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(head)}`,
					);
					const changed = array(comparison.files).map(record);
					if (
						changed.length !== Object.keys(plan.files).length
						|| changed.some(file => file.status !== 'added' || !Object.hasOwn(plan.files, String(file.filename)))
					) return yield* precondition('Submission branch contains unexpected changes');
					for (const [path, content] of Object.entries(plan.files)) {
						const file = yield* call(`/repos/${fork}/contents/${path}?ref=${headSha}`);
						const decoded = yield* fromSync(() =>
							new TextDecoder().decode(
								Uint8Array.from(atob(text(file.content).replaceAll('\n', '')), c => c.charCodeAt(0)),
							)
						);
						if (decoded !== content) return yield* precondition('Submission branch content changed');
					}
					pull = yield* call(`/repos/${upstream}/pulls`, 'POST', {
						title: `New version: ${plan.packageIdentifier} ${plan.version}`,
						base: baseBranch,
						head,
						maintainer_can_modify: true,
						body:
							`Release: ${plan.releaseUrl}\nSource commit: ${plan.sourceSha}\n\nInstaller SHA-256 values verified against GitHub release assets.`,
					});
				}
				const opened = pull;
				const result = yield* fromSync(() => self.pullState(plan, opened));
				yield* self.save(result, lease);
				yield* self.store.audit('winget', 'winget.submit', result.url ?? plan.id);
				return result;
			}).pipe(
				Effect.tapError(error =>
					attempted
						? self.save({ ...attempted, state: 'failed', reason: decodeError(error), updatedAt: Date.now() }, lease)
						: Effect.void
				),
				Effect.ensuring(
					self.sql.run('UPDATE winget_submissions SET lease_until=0 WHERE id=? AND lease=?', plan.id, lease).pipe(
						Effect.ignore,
					),
				),
			);
		});
	}
	private pullState(plan: WinGetPlan, pull: Record<string, unknown>): WinGetSubmission {
		return {
			plan,
			number: Number(pull.number),
			url: text(pull.html_url),
			head: sha(record(pull.head).sha),
			state: pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'open',
			updatedAt: Date.now(),
		};
	}
	private openSubmissions(after: string | null): Effect.Effect<{ id: string; document: string }[], DomainError> {
		return this.sql.all(
			"SELECT id,document FROM winget_submissions WHERE json_extract(document,'$.state')='open' AND (? IS NULL OR id>?) ORDER BY id LIMIT 100",
			after,
			after,
		).pipe(Effect.flatMap(rows => parse(z.array(submissionRow), rows)));
	}
	private reconcileOne(saved: WinGetSubmission): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (!saved.number || saved.state !== 'open') return;
			const token = yield* fromSync(() => text(self.env.WINGET_GITHUB_TOKEN));
			const call = (path: string) => self.gateway.call(path, token);
			const pull = record(yield* call(`/repos/${upstream}/pulls/${saved.number}`));
			const next = yield* fromSync(() => self.pullState(saved.plan, pull));
			const checks = record(yield* call(`/repos/${upstream}/commits/${next.head}/check-runs?per_page=100`));
			const runs = array(checks.check_runs).map(record);
			const statuses = record(yield* call(`/repos/${upstream}/commits/${next.head}/status`));
			const reviews = array(yield* call(`/repos/${upstream}/pulls/${saved.number}/reviews?per_page=100`)).map(record);
			const latestReviews = new Map<string, string>();
			for (const review of reviews) {
				if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(String(review.state))) {
					latestReviews.set(String(record(review.user).login), String(review.state));
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
			yield* self.sql.run(
				'UPDATE winget_submissions SET document=?,updated_at=? WHERE id=? AND lease_until<?',
				JSON.stringify(next),
				next.updatedAt,
				saved.plan.id,
				Date.now(),
			);
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
					yield* self.reconcileOne(saved).pipe(
						recover(error =>
							Effect.sync(() =>
								console.error(
									JSON.stringify({ event: 'winget.status-failed', id: saved.plan.id, error: decodeError(error) }),
								)
							)
						),
					);
				}
			}
		});
	}
	watch(repo: RepositoryRecord): Effect.Effect<void, DomainError> {
		return (repo.configuration?.winget?.automatic
			? this.sql.run('INSERT OR IGNORE INTO winget_watches(repository_id,since) VALUES(?,?)', repo.id, Date.now())
			: this.sql.run('DELETE FROM winget_watches WHERE repository_id=?', repo.id)).pipe(Effect.asVoid);
	}
	automatic(repo: RepositoryRecord): Effect.Effect<void, DomainError> {
		const self = this;
		return Effect.gen(function*() {
			if (
				readiness(repo).kind !== 'ready' || !repo.configuration?.winget?.automatic || !self.setup()
			) return;
			yield* self.watch(repo);
			const watch = yield* parse(
				z.object({ since: z.number() }).nullable(),
				yield* self.sql.first('SELECT since FROM winget_watches WHERE repository_id=?', repo.id),
			);
			for (const release of yield* self.releases(repo)) {
				if (!watch || release.publishedAt <= watch.since) continue;
				// Enabling automation must not submit historical releases without review.
				const existing = yield* self.get(`${repo.id}:${release.id}`);
				if (!existing || existing.state === 'failed' || existing.state === 'pending') {
					yield* self.plan(repo, release.id).pipe(
						Effect.flatMap(plan => self.submit(repo, release.id, plan.digest)),
						recover(error => self.store.audit('winget', 'winget.failed', `${repo.name}: ${decodeError(error)}`)),
					);
				}
			}
		});
	}
}
