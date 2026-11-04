import { z } from 'zod';
import type { RepositoryGateway } from '@/automation/github';
import { documentRow } from '@/automation/schemas';
import type { Store } from '@/automation/store';
import type { RepositoryRecord } from '@/automation/types';
import { generateManifests, renderManifests } from '@/distribution/winget/generate';
import { readiness } from '@/domain/repository';
import { array, integer, record, sha, text } from '@/model';

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
export async function planDigest(value: unknown): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
		.map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export class WinGetService {
	constructor(readonly store: Store, readonly gateway: RepositoryGateway, readonly env: WinGetBindings) {}
	setup(): boolean {
		return !!this.env.WINGET_GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(this.env.WINGET_FORK ?? '');
	}
	private policy(repo: RepositoryRecord) {
		const state = readiness(repo);
		if (state.kind !== 'ready' || !state.repository.configuration.winget) {
			throw Error('Repository is not enabled for WinGet');
		}
		return state.repository.configuration.winget;
	}
	async releases(repo: RepositoryRecord) {
		const policy = this.policy(repo);
		const token = await this.gateway.token(repo.name, repo.id, { contents: 'read' });
		return array(await this.gateway.call(`/repos/${repo.name}/releases?per_page=30`, token)).map(record)
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
			}));
	}
	async plan(repo: RepositoryRecord, releaseId: number): Promise<WinGetPlan> {
		const policy = this.policy(repo);
		const token = await this.gateway.token(repo.name, repo.id, { contents: 'read' });
		const metadata = record(await this.gateway.call(`/repos/${repo.name}`, token));
		if (metadata.private !== false) throw Error('WinGet installers must come from a public repository');
		const release = record(await this.gateway.call(`/repos/${repo.name}/releases/${releaseId}`, token));
		if (release.id !== releaseId || release.draft || release.prerelease || !release.published_at) {
			throw Error('Select a published stable release');
		}
		const tag = text(release.tag_name);
		if (!tag.startsWith(policy.tagPrefix)) throw Error('Release tag does not match the configured prefix');
		const version = tag.slice(policy.tagPrefix.length);
		const snapshot = await this.gateway.snapshot(repo.name, repo.id, tag, [policy.config]);
		const configuration = JSON.parse(text(snapshot.files[policy.config]));
		const assets = array(
			await this.gateway.call(`/repos/${repo.name}/releases/${releaseId}/assets?per_page=100`, token),
		).map(record);
		if (assets.length === 100) throw Error('Release asset limit exceeded');
		const checksums = assets.filter(asset =>
			typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
		)
			.map(asset => `${String(asset.digest).slice(7)}  ${text(asset.name)}`).join('\n');
		const manifests = generateManifests({
			configuration,
			version,
			tag,
			checksums,
			releaseDate: text(release.published_at).slice(0, 10),
			releaseNotes: String(release.body ?? ''),
		});
		for (const installer of manifests.installer.Installers) {
			const asset = assets.find(asset => asset.browser_download_url === installer.InstallerUrl);
			if (
				asset?.state !== 'uploaded'
				|| String(asset.digest).toUpperCase() !== `SHA256:${installer.InstallerSha256}`
			) {
				throw Error('Installer must match an uploaded release asset and its GitHub SHA-256 digest');
			}
		}
		const packageIdentifier = manifests.version.PackageIdentifier;
		if (!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9_-]+)+$/.test(packageIdentifier)) throw Error('Invalid WinGet package path');
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
			configurationSha: await planDigest(policy),
			files,
			releaseUrl: text(release.html_url),
		};
		return { ...base, digest: await planDigest(base) };
	}
	async list(): Promise<WinGetSubmission[]> {
		const rows = await this.store.db.prepare(
			'SELECT document FROM winget_submissions ORDER BY updated_at DESC LIMIT 100',
		).all();
		return rows.results.map(row => parseSubmission(documentRow.parse(row).document));
	}
	async latestByRepository(): Promise<Map<number, WinGetSubmission>> {
		const rows = await this.store.db.prepare(
			"SELECT document FROM (SELECT document,ROW_NUMBER() OVER (PARTITION BY json_extract(document,'$.plan.repositoryId') ORDER BY json_extract(document,'$.plan.releaseId') DESC) AS position FROM winget_submissions) WHERE position=1",
		).all();
		const submissions = rows.results.map(row => parseSubmission(documentRow.parse(row).document));
		return new Map(submissions.map(submission => [submission.plan.repositoryId, submission]));
	}
	async get(id: string): Promise<WinGetSubmission | undefined> {
		const row = documentRow.nullable().parse(
			await this.store.db.prepare('SELECT document FROM winget_submissions WHERE id=?').bind(id).first(),
		);
		return row ? parseSubmission(row.document) : undefined;
	}
	private async save(value: WinGetSubmission, lease: string) {
		await this.store.db.prepare('UPDATE winget_submissions SET document=?,updated_at=? WHERE id=? AND lease=?')
			.bind(JSON.stringify(value), value.updatedAt, value.plan.id, lease).run();
	}
	private async replaceFailedPlan(saved: WinGetSubmission, pending: WinGetSubmission, lease: string): Promise<void> {
		if (saved.state !== 'failed' || saved.number || saved.url || saved.head) {
			throw Error('The previous plan is already submitted or in progress; it cannot be replaced');
		}
		const token = text(this.env.WINGET_GITHUB_TOKEN);
		const fork = text(this.env.WINGET_FORK);
		const forkInfo = record(await this.gateway.call(`/repos/${fork}`, token));
		if (!forkInfo.fork || record(forkInfo.parent).full_name !== upstream) {
			throw Error('Cannot verify the previous submission fork');
		}
		const old = saved.plan;
		const branch = `winget/${old.packageIdentifier}/${old.version}/${old.digest.slice(0, 16)}`;
		const pulls = array(
			await this.gateway.call(
				`/repos/${upstream}/pulls?state=all&head=${encodeURIComponent(`${fork.split('/')[0]}:${branch}`)}&per_page=100`,
				token,
			),
		);
		const ref = await this.gateway.call(`/repos/${fork}/git/ref/heads/${branch}`, token);
		if (pulls.length || ref) {
			throw Error('The previous plan has a branch or pull request; inspect it before changing the submission');
		}
		const updated = await this.store.db.prepare(
			'UPDATE winget_submissions SET package=?,version=?,document=?,updated_at=? WHERE id=? AND lease=? AND lease_until>?',
		).bind(
			pending.plan.packageIdentifier,
			pending.plan.version,
			JSON.stringify(pending),
			pending.updatedAt,
			pending.plan.id,
			lease,
			Date.now(),
		).run();
		if (!updated.meta.changes) throw Error('Submission lease expired; preview again');
	}
	async submit(repo: RepositoryRecord, releaseId: number, expectedDigest: string): Promise<WinGetSubmission> {
		if (!this.setup()) throw Error('Configure the WinGet bot token and fork before submitting');
		const plan = await this.plan(repo, releaseId);
		if (plan.digest !== expectedDigest) throw Error('Release or configuration changed; preview again');
		const pending: WinGetSubmission = { plan, state: 'pending', updatedAt: Date.now() };
		await this.store.db.prepare(
			'INSERT OR IGNORE INTO winget_submissions(id,package,version,document,updated_at) VALUES(?,?,?,?,?)',
		)
			.bind(plan.id, plan.packageIdentifier, plan.version, JSON.stringify(pending), pending.updatedAt).run();
		let saved = await this.get(plan.id);
		if (!saved) {
			throw Error('This package version already has a different submission; inspect its existing PR');
		}
		const lease = crypto.randomUUID();
		const locked = await this.store.db.prepare(
			'UPDATE winget_submissions SET lease=?,lease_until=? WHERE id=? AND lease_until<?',
		)
			.bind(lease, Date.now() + 600_000, plan.id, Date.now()).run();
		if (!locked.meta.changes) throw Error('Submission is already in progress; refresh shortly');
		let attempted = false;
		try {
			// Re-read under the lease so a concurrent completed attempt cannot be overwritten.
			saved = await this.get(plan.id);
			if (!saved) throw Error('Submission record disappeared');
			if (saved.plan.digest !== plan.digest) {
				await this.replaceFailedPlan(saved, pending, lease);
				saved = pending;
			}
			if (saved.state === 'merged' || saved.state === 'closed') return saved;
			attempted = true;
			const token = text(this.env.WINGET_GITHUB_TOKEN);
			const fork = text(this.env.WINGET_FORK);
			const call = (path: string, method = 'GET', body?: unknown) => this.gateway.call(path, token, method, body);
			const forkInfo = record(await call(`/repos/${fork}`));
			if (!forkInfo.fork || record(forkInfo.parent).full_name !== upstream) {
				throw Error('Configured repository must be a fork of microsoft/winget-pkgs');
			}
			const target = record(await call(`/repos/${upstream}`));
			const baseBranch = text(target.default_branch);
			const branch = `winget/${plan.packageIdentifier}/${plan.version}/${plan.digest.slice(0, 16)}`;
			const pulls = array(
				await call(
					`/repos/${upstream}/pulls?state=all&head=${
						encodeURIComponent(`${fork.split('/')[0]}:${branch}`)
					}&per_page=100`,
				),
			).map(record);
			if (pulls.length > 1) throw Error('Multiple matching WinGet pull requests');
			let pull = pulls[0];
			if (!pull) {
				let ref = await call(`/repos/${fork}/git/ref/heads/${branch}`);
				if (!ref) {
					const base = record(await call(`/repos/${upstream}/git/ref/heads/${encodeURIComponent(baseBranch)}`));
					const parent = sha(record(base.object).sha);
					const commit = record(await call(`/repos/${upstream}/git/commits/${parent}`));
					const tree = record(
						await call(`/repos/${fork}/git/trees`, 'POST', {
							base_tree: sha(record(commit.tree).sha),
							tree: Object.entries(plan.files).map(([path, content]) => ({
								path,
								mode: '100644',
								type: 'blob',
								content,
							})),
						}),
					);
					const bot = await this.gateway.botIdentity();
					const submitter = record(await call('/user'));
					const login = text(submitter.login);
					const created = record(
						await call(`/repos/${fork}/git/commits`, 'POST', {
							message: `New version: ${plan.packageIdentifier} ${plan.version}\n\nCo-authored-by: ${login} <${
								integer(submitter.id)
							}+${login}@users.noreply.github.com>`,
							author: { name: bot.login, email: bot.email },
							tree: sha(tree.sha),
							parents: [parent],
						}),
					);
					ref = await call(`/repos/${fork}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: sha(created.sha) });
				}
				// Verify a recovered branch before opening a PR after an interrupted attempt.
				const head = sha(record(record(ref).object).sha);
				const comparison = record(
					await call(
						`/repos/${upstream}/compare/${encodeURIComponent(baseBranch)}...${
							encodeURIComponent(`${fork.split('/')[0]}:${branch}`)
						}`,
					),
				);
				const changed = array(comparison.files).map(record);
				if (
					changed.length !== Object.keys(plan.files).length
					|| changed.some(file => file.status !== 'added' || !Object.hasOwn(plan.files, text(file.filename)))
				) throw Error('Submission branch contains unexpected changes');
				for (const [path, content] of Object.entries(plan.files)) {
					const file = record(await call(`/repos/${fork}/contents/${path}?ref=${head}`));
					const bytes = Uint8Array.from(atob(text(file.content).replaceAll('\n', '')), c => c.charCodeAt(0));
					if (new TextDecoder().decode(bytes) !== content) throw Error('Submission branch content changed');
				}
				pull = record(
					await call(`/repos/${upstream}/pulls`, 'POST', {
						title: `New version: ${plan.packageIdentifier} ${plan.version}`,
						base: baseBranch,
						head: `${fork.split('/')[0]}:${branch}`,
						maintainer_can_modify: true,
						body:
							`Release: ${plan.releaseUrl}\nSource commit: ${plan.sourceSha}\n\nInstaller SHA-256 values verified against GitHub release assets.`,
					}),
				);
			}
			const result = this.pullState(plan, pull);
			await this.save(result, lease);
			await this.store.audit('winget', 'winget.submit', result.url ?? plan.id);
			return result;
		} catch (error) {
			if (attempted && saved) {
				await this.save({
					...saved,
					state: 'failed',
					reason: error instanceof Error ? error.message : 'Submission failed',
					updatedAt: Date.now(),
				}, lease);
			}
			throw error;
		} finally {
			await this.store.db.prepare('UPDATE winget_submissions SET lease_until=0 WHERE id=? AND lease=?').bind(
				plan.id,
				lease,
			).run();
		}
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
	private async *openSubmissions(): AsyncGenerator<WinGetSubmission> {
		let after: string | null = null;
		while (true) {
			const rows: { id: string; document: string }[] = z.array(submissionRow).parse(
				(await this.store.db.prepare(
					"SELECT id,document FROM winget_submissions WHERE json_extract(document,'$.state')='open' AND (? IS NULL OR id>?) ORDER BY id LIMIT 100",
				).bind(after, after).all()).results,
			);
			if (!rows.length) return;
			for (const row of rows) {
				// Use the stable ID: reconciliation changes both state and updated_at.
				after = row.id;
				yield parseSubmission(row.document);
			}
		}
	}
	async reconcile(): Promise<void> {
		if (!this.setup()) return;
		for await (const saved of this.openSubmissions()) {
			if (!saved.number || saved.state !== 'open') continue;
			try {
				const token = text(this.env.WINGET_GITHUB_TOKEN);
				const pull = record(await this.gateway.call(`/repos/${upstream}/pulls/${saved.number}`, token));
				const next = this.pullState(saved.plan, pull);
				const checks = record(
					await this.gateway.call(`/repos/${upstream}/commits/${next.head}/check-runs?per_page=100`, token),
				);
				const runs = array(checks.check_runs).map(record);
				const statuses = record(await this.gateway.call(`/repos/${upstream}/commits/${next.head}/status`, token));
				const reviews = array(
					await this.gateway.call(`/repos/${upstream}/pulls/${saved.number}/reviews?per_page=100`, token),
				).map(record);
				const latestReviews = new Map<string, string>();
				for (const review of reviews) {
					if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(String(review.state))) {
						latestReviews.set(text(record(review.user).login), String(review.state));
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
				await this.store.db.prepare(
					'UPDATE winget_submissions SET document=?,updated_at=? WHERE id=? AND lease_until<?',
				)
					.bind(JSON.stringify(next), next.updatedAt, saved.plan.id, Date.now()).run();
			} catch { /* Preserve the last known status; retry on the next scheduled pass. */ }
		}
	}
	async watch(repo: RepositoryRecord): Promise<void> {
		if (repo.configuration?.winget?.automatic) {
			await this.store.db.prepare('INSERT OR IGNORE INTO winget_watches(repository_id,since) VALUES(?,?)').bind(
				repo.id,
				Date.now(),
			).run();
		} else await this.store.db.prepare('DELETE FROM winget_watches WHERE repository_id=?').bind(repo.id).run();
	}
	async automatic(repo: RepositoryRecord): Promise<void> {
		if (
			readiness(repo).kind !== 'ready' || !repo.configuration?.winget?.automatic || !this.setup()
		) return;
		await this.watch(repo);
		const watch = z.object({ since: z.number() }).nullable().parse(
			await this.store.db.prepare('SELECT since FROM winget_watches WHERE repository_id=?').bind(repo.id).first(),
		);
		for (const release of await this.releases(repo)) {
			if (!watch || release.publishedAt <= watch.since) continue;
			// Enabling automation must not submit historical releases without review.
			const existing = await this.get(`${repo.id}:${release.id}`);
			if (!existing || existing.state === 'failed' || existing.state === 'pending') {
				try {
					const plan = await this.plan(repo, release.id);
					await this.submit(repo, release.id, plan.digest);
				} catch (error) {
					await this.store.audit(
						'winget',
						'winget.failed',
						`${repo.name}: ${error instanceof Error ? error.message : 'Submission failed'}`,
					);
				}
			}
		}
	}
}
