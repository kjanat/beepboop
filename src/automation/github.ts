import { importPKCS8, SignJWT } from 'jose';
import { safeVersionPath } from '@/automation/editors';
import type { Fetcher, VerificationContext } from '@/automation/managers/registry';
import { tagQueries } from '@/automation/managers/tags';
import type { RefState } from '@/automation/refs';
import type { BotIdentity } from '@/automation/token';
import type { Edit, Snapshot } from '@/automation/types';
import { array, integer, record, sha, text } from '@/model';

type Permission = Record<string, 'read' | 'write'>;
const ownerLogins = new Map<number, string>();
const botIdentities = new Map<string, BotIdentity>();
export class RepositoryGateway {
	constructor(
		private credentials: Credentials,
		private ownerId: number,
		private transport: Fetcher = fetch,
	) {}
	async call(path: string, token: string, method = 'GET', body?: unknown): Promise<unknown> {
		if (!path.startsWith('/')) throw new Error('Invalid API path');
		const transport = this.transport;
		const send = () =>
			transport(`https://api.github.com${path}`, {
				method,
				redirect: 'manual',
				signal: AbortSignal.timeout(20_000),
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2026-03-10',
					'User-Agent': 'beepboop',
					'Content-Type': 'application/json',
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		let response = await send();
		for (let attempt = 1; method === 'GET' && response.status >= 500 && attempt < 3; attempt++) {
			await new Promise(resolve => setTimeout(resolve, attempt * 500));
			response = await send();
		}
		if (response.status === 404 && method === 'GET') return null;
		if (!response.ok) throw new Error(`GitHub HTTP ${response.status} on ${method} ${path.split('?')[0]}`);
		if (response.status === 204) return null;
		return response.json();
	}
	async token(
		name: string,
		id: number | undefined,
		permissions: Permission = { contents: 'read', actions: 'read' },
	): Promise<string> {
		if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error('Invalid repository');
		const jwt = await this.appToken();
		const installation = record(await this.call(`/repos/${name}/installation`, jwt));
		if (integer(record(installation.account).id) !== this.ownerId) {
			throw new Error('Owner mismatch');
		}
		const response = record(
			await this.call(`/app/installations/${integer(installation.id)}/access_tokens`, jwt, 'POST', {
				...(id === undefined ? { repositories: [name.split('/')[1]] } : { repository_ids: [id] }),
				permissions,
			}),
		);
		const token = text(response.token),
			repository = record(await this.call(`/repos/${name}`, token));
		if (
			(id !== undefined && repository.id !== id)
			|| repository.full_name !== name
			|| record(repository.owner).id !== this.ownerId
		) {
			throw new Error('Repository mismatch');
		}
		return token;
	}
	/** JWT for the configured App, never the workflow's GITHUB_TOKEN. */
	private async appToken(): Promise<string> {
		const key = await importPKCS8(this.credentials.GITHUB_APP_PRIVATE_KEY, 'RS256');
		return new SignJWT({})
			.setProtectedHeader({ alg: 'RS256' })
			.setIssuer(this.credentials.GITHUB_APP_ID)
			.setIssuedAt(Math.floor(Date.now() / 1000) - 60)
			.setExpirationTime('9m')
			.sign(key);
	}
	async botIdentity(): Promise<BotIdentity> {
		const cached = botIdentities.get(this.credentials.GITHUB_APP_ID);
		if (cached) return cached;
		const jwt = await this.appToken();
		const app = record(await this.call('/app', jwt));
		const slug = text(app.slug);
		if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid App slug');
		const login = `${slug}[bot]`;
		const installation = await this.ownerInstallation(jwt);
		const token = text(
			record(
				await this.call(`/app/installations/${integer(installation.id)}/access_tokens`, jwt, 'POST', {
					permissions: { metadata: 'read' },
				}),
			).token,
		);
		const user = record(await this.call(`/users/${encodeURIComponent(login)}`, token));
		if (user.login !== login || user.type !== 'Bot') throw new Error('App bot identity mismatch');
		const id = integer(user.id);
		const identity = { login, id, email: `${id}+${login}@users.noreply.github.com` };
		botIdentities.set(this.credentials.GITHUB_APP_ID, identity);
		return identity;
	}
	async defaultRevision(name: string, id: number): Promise<{ ref: string; sha: string }> {
		const token = await this.token(name, id, { contents: 'read' });
		const repository = record(await this.call(`/repos/${name}`, token));
		const branch = text(repository.default_branch);
		const commit = record(await this.call(`/repos/${name}/commits/${encodeURIComponent(branch)}`, token));
		return { ref: `refs/heads/${branch}`, sha: sha(commit.sha) };
	}
	async workflowRun(name: string, id: number, runId: number): Promise<{ title: string; path: string }> {
		const token = await this.token(name, id, { actions: 'read' });
		const run = record(await this.call(`/repos/${name}/actions/runs/${runId}`, token));
		if (record(run.repository).id !== id) throw new Error('Run identity changed');
		return { title: text(run.display_title), path: text(run.path) };
	}
	async tagRefs(name: string, id: number): Promise<RefState[]> {
		const token = await this.token(name, id, { contents: 'read' });
		const result: RefState[] = [];
		for (let page = 1; page <= 100; page++) {
			const rows = array(await this.call(`/repos/${name}/tags?per_page=100&page=${page}`, token)).map(record);
			for (const row of rows) {
				const tag = text(row.name);
				const reference = record(await this.call(`/repos/${name}/git/ref/tags/${encodeURIComponent(tag)}`, token));
				const oid = sha(record(reference.object).sha);
				let target = record(reference.object);
				for (let depth = 0; target.type === 'tag' && depth < 8; depth++) {
					target = record(record(await this.call(`/repos/${name}/git/tags/${sha(target.sha)}`, token)).object);
				}
				if (target.type !== 'commit') throw new Error('Tag does not resolve to a commit');
				result.push({ name: tag, oid, commit: sha(target.sha) });
			}
			if (rows.length < 100) return result;
		}
		throw new Error('Tag discovery limit exceeded');
	}
	verification(name: string, id: number): VerificationContext {
		let token: Promise<string> | undefined;
		const installation = () => {
			token ??= this.token(name, id);
			return token;
		};
		return { repository: name, github: async path => this.call(path, await installation()) };
	}
	async identify(name: string): Promise<number> {
		const token = await this.token(name, undefined);
		return integer(record(await this.call(`/repos/${name}`, token)).id);
	}
	async file(name: string, path: string, ref: string, token: string): Promise<string | null> {
		const result = await this.call(
			`/repos/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`,
			token,
		);
		if (result === null) return null;
		const data = record(result);
		if (
			data.encoding !== 'base64'
			|| typeof data.content !== 'string'
			|| Number(data.size) > 1_048_576
		) {
			throw new Error('Unsupported file');
		}
		return new TextDecoder('utf-8', { fatal: true }).decode(
			Uint8Array.from(atob(data.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)),
		);
	}
	async snapshot(name: string, id: number, revision?: string, extraPaths: string[] = []): Promise<Snapshot> {
		const token = await this.token(name, id);
		const repository = record(await this.call(`/repos/${name}`, token));
		const defaultBranch = text(repository.default_branch);
		const commit = record(
			await this.call(
				`/repos/${name}/commits/${encodeURIComponent(revision ?? defaultBranch)}`,
				token,
			),
		);
		const commitSha = sha(commit.sha);
		const tree = record(
			await this.call(`/repos/${name}/git/trees/${commitSha}?recursive=1`, token),
		);
		if (tree.truncated) {
			throw new Error('Repository tree truncated; discovery requires complete input');
		}
		if (extraPaths.some(path => !safeVersionPath(path))) throw new Error('Unsafe version file path');
		const blobs = array(tree.tree).map(record).filter(entry => entry.type === 'blob' && entry.mode !== '120000');
		if (extraPaths.some(path => !blobs.some(entry => entry.path === path))) {
			throw new Error('Version file missing or not a regular file');
		}
		const candidates = array(tree.tree)
			.map(record)
			.filter((entry) => entry.type === 'blob' && entry.mode !== '120000')
			.map((entry) => text(entry.path))
			.filter(
				(path) =>
					extraPaths.includes(path)
					|| /^actions\/(?:begin|prepare|report)\/action\.ya?ml$/.test(path)
					|| !/(?:^|\/)(?:node_modules|vendor|target|testdata|fixtures|\.git)\//.test(path)
						&& /(?:^|\/)(?:\.pre-commit-config\.ya?ml|targets.json|Cargo.toml|Cargo.lock|package.json|jsr.json|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock|go\.mod|PKGBUILD|\.?goreleaser[^/]*\.ya?ml)$|^\.github\/(?:beepboop.json|workflows\/[^/]+\.ya?ml)$/
							.test(
								path,
							),
			);
		if (candidates.length > 400) throw new Error('Discovery file limit exceeded');
		const files: Record<string, string> = {};
		for (let offset = 0; offset < candidates.length; offset += 8) {
			await Promise.all(
				candidates.slice(offset, offset + 8).map(async (path) => {
					// Lockfiles only indicate the need for repository preparation; avoid transferring large generated files.
					if (
						!extraPaths.includes(path)
						&& /(?:Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path)
					) {
						files[path] = '';
						return;
					}
					const content = await this.file(name, path, commitSha, token);
					if (content !== null) files[path] = content;
				}),
			);
		}
		const tags = await this.tags(name, tagQueries(candidates), token);
		return { repository: { id, name, defaultBranch }, sha: commitSha, files, ...(tags ? { tags } : {}) };
	}
	private async tags(name: string, prefixes: string[], token: string): Promise<string[] | undefined> {
		if (!prefixes.length) return undefined;
		const refs = await Promise.all(prefixes.map(async prefix =>
			array(
				await this.call(
					`/repos/${name}/git/matching-refs/tags/${prefix.split('/').map(encodeURIComponent).join('/')}`,
					token,
				) ?? [],
			).map(row => text(record(row).ref).slice('refs/tags/'.length))
		));
		return [...new Set(refs.flat())].sort();
	}
	async preset(reference: string): Promise<{ value: unknown; sha: string }> {
		const [, name, preset, ref] = reference.match(/^github>([\w.-]+\/[\w.-]+):([\w-]+)(?:#([\w./-]+))?$/) ?? [];
		if (!name) throw new Error('Invalid preset');
		// Public presets need no installation grant; repository configuration cannot redirect credential-bearing requests.
		const metadata = record(await this.call(`/repos/${name}`, ''));
		const revision = record(
			await this.call(
				`/repos/${name}/commits/${encodeURIComponent(ref ?? text(metadata.default_branch))}`,
				'',
			),
		);
		const commitSha = sha(revision.sha);
		const content = await this.file(name, `${preset}.json`, commitSha, '');
		if (content === null) throw new Error('Preset missing');
		return { value: JSON.parse(content), sha: commitSha };
	}
	/** Check an already-granted installation permission without changing repository contents. */
	async canEditWorkflows(name: string, id: number): Promise<boolean> {
		try {
			await this.token(name, id, { contents: 'read', workflows: 'write' });
			return true;
		} catch (error) {
			if (error instanceof Error && /^GitHub HTTP (403|422) /.test(error.message)) return false;
			throw error;
		}
	}
	/** Read the proposal head without modifying or creating a branch. */
	private async ownerInstallation(jwt: string): Promise<Record<string, unknown>> {
		const installation = array(await this.call('/app/installations?per_page=100', jwt)).map(record)
			.find(installation => record(installation.account).id === this.ownerId);
		if (!installation) throw new Error('The GitHub App is not installed on the owner account');
		return installation;
	}
	async ownerLogin(): Promise<string> {
		const cached = ownerLogins.get(this.ownerId);
		if (cached) return cached;
		const login = text(record((await this.ownerInstallation(await this.appToken())).account).login);
		ownerLogins.set(this.ownerId, login);
		return login;
	}
	private async generatedComparison(name: string, head: string, token: string) {
		const base = text(record(await this.call(`/repos/${name}`, token)).default_branch);
		const comparison = record(await this.call(`/repos/${name}/compare/${encodeURIComponent(base)}...${head}`, token));
		const commits = array(comparison.commits).map(record);
		if (!commits.length || commits.length !== Number(comparison.ahead_by) || commits.at(-1)?.sha !== head) {
			return undefined;
		}
		const bot = await this.botIdentity();
		const generated = commits.every(commit =>
			record(commit.author).id === bot.id && record(record(commit.commit).verification).verified === true
		);
		return generated ? comparison : undefined;
	}
	async generatedHead(name: string, id: number, head: string): Promise<boolean> {
		const token = await this.token(name, id, { contents: 'read' });
		return (await this.generatedComparison(name, head, token)) !== undefined;
	}
	async generatedFiles(name: string, id: number, head: string): Promise<Edit[] | undefined> {
		const token = await this.token(name, id, { contents: 'read' });
		const comparison = await this.generatedComparison(name, head, token);
		if (!comparison) return undefined;
		const files = array(comparison.files).map(record);
		if (files.length >= 300) return undefined;
		const mergeBase = sha(record(comparison.merge_base_commit).sha);
		return Promise.all(files.map(async file => {
			const path = text(file.filename);
			return {
				path,
				before: (await this.file(name, path, mergeBase, token)) ?? '',
				after: (await this.file(name, path, head, token)) ?? '',
			};
		}));
	}
	async setupHead(name: string, id: number): Promise<string | null> {
		const token = await this.token(name, id);
		const ref = await this.call(`/repos/${name}/git/ref/heads/automation/onboarding`, token);
		return ref ? sha(record(record(ref).object).sha) : null;
	}
	async pullRequest(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		edits: Edit[],
		expectedHead?: string,
		checkpoint?: (head: string) => Promise<void>,
		setupEdits?: Edit[],
		existingPull?: number,
		takeOver = false,
	): Promise<{ url: string; head: string }> {
		const { name, id } = snapshot.repository;
		const token = await this.token(name, id, {
			contents: 'write',
			pull_requests: 'write',
			...(setupEdits !== undefined || edits.some(edit => edit.path.startsWith('.github/workflows/'))
				? { workflows: 'write' as const }
				: {}),
		});
		const existing = await this.call(
			`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`,
			token,
		);
		const base = existing ? sha(record(record(existing).object).sha) : snapshot.sha;
		if (existing && (!expectedHead || expectedHead !== base)) {
			throw new Error('Branch changed; preserve user edits and review the conflict');
		}
		if (existing && setupEdits && !takeOver) {
			const comparison = record(await this.call(`/repos/${name}/compare/${snapshot.sha}...${base}`, token));
			const changed = array(comparison.files).map(record);
			if (changed.length >= 300 || changed.some(file => !setupEdits.some(edit => edit.path === file.filename))) {
				throw new Error('Setup branch contains unrelated changes; review it before refreshing');
			}
			for (const edit of setupEdits) {
				if (await this.file(name, edit.path, base, token) !== edit.after) {
					throw new Error(`Setup branch was edited: ${edit.path}`);
				}
			}
		}
		const treeBase = setupEdits ? snapshot.sha : base;
		const commit = record(await this.call(`/repos/${name}/git/commits/${treeBase}`, token));
		for (const edit of edits) {
			const current = await this.file(name, edit.path, treeBase, token);
			if ((current ?? '') !== edit.before) throw new Error(`File changed: ${edit.path}`);
			if (
				edit.path.startsWith('/')
				|| edit.path.split('/').some((p) => p === '..' || p === '.git')
			) {
				throw new Error('Unsafe edit path');
			}
		}
		const tree = record(
			await this.call(`/repos/${name}/git/trees`, token, 'POST', {
				base_tree: sha(record(commit.tree).sha),
				tree: edits.map((edit) => ({
					path: edit.path,
					mode: '100644',
					type: 'blob',
					content: edit.after,
				})),
			}),
		);
		const next = record(
			await this.call(`/repos/${name}/git/commits`, token, 'POST', {
				message: title,
				tree: sha(tree.sha),
				parents: setupEdits ? [snapshot.sha] : [base],
			}),
		);
		const head = sha(next.sha);
		const rules = await this.call(
			`/repos/${name}/rules/branches/${encodeURIComponent(branch)}`,
			token,
		);
		if (rules === null) {
			throw new Error('Branch rules unavailable; publication of the preparation branch stopped');
		}
		if (
			array(rules)
				.map(record)
				.some((rule) => rule.type === 'required_signatures')
		) {
			const verification = record(
				record(await this.call(`/repos/${name}/git/commits/${head}`, token)).verification,
			);
			if (verification.verified !== true) {
				throw new Error('Preparation commit does not satisfy the branch signature requirement');
			}
		}
		if (existingPull !== undefined) {
			const pull = record(await this.call(`/repos/${name}/pulls/${existingPull}`, token));
			if (
				pull.state !== 'open' || record(pull.head).sha !== base || record(pull.head).ref !== branch
				|| record(record(pull.head).repo).id !== id
			) throw new Error('Setup pull request changed during refresh');
		}
		if (checkpoint) await checkpoint(head);
		if (existing) {
			await this.call(
				`/repos/${name}/git/refs/heads/${encodeURIComponent(branch)}`,
				token,
				'PATCH',
				{ sha: head, force: setupEdits !== undefined },
			);
		} else {
			await this.call(`/repos/${name}/git/refs`, token, 'POST', {
				ref: `refs/heads/${branch}`,
				sha: head,
			});
		}
		return this.finishPullRequest(snapshot, branch, title, body, head, token);
	}
	/** Bind release execution to the merged preparation pull request. */
	async preparedSnapshot(
		repository: string,
		repositoryId: number,
		result: { url: string; head: string },
		target: string,
		extraPaths: string[] = [],
	): Promise<Snapshot> {
		const url = new URL(result.url);
		const prefix = `/${repository}/pull/`;
		if (
			url.origin !== 'https://github.com' || !url.pathname.startsWith(prefix)
			|| !/^[1-9][0-9]*$/.test(url.pathname.slice(prefix.length))
		) throw new Error('Invalid preparation PR identity');
		const token = await this.token(repository, repositoryId, { contents: 'read', pull_requests: 'read' });
		const number = url.pathname.slice(prefix.length);
		const pull = record(await this.call(`/repos/${repository}/pulls/${number}`, token));
		if (
			pull.merged !== true || (await this.mergeCommit(repository, number, token)) !== sha(target)
			|| record(pull.head).sha !== result.head || record(record(pull.base).repo).id !== repositoryId
		) {
			throw new Error('Target is not the merged preparation revision');
		}
		const snapshot = await this.snapshot(repository, repositoryId, target, extraPaths);
		if (record(pull.base).ref !== snapshot.repository.defaultBranch) {
			throw new Error('Preparation was merged into a different branch');
		}
		return snapshot;
	}
	private async mergeCommit(repository: string, number: string, token: string): Promise<string | undefined> {
		for (let page = 1; page <= 10; page++) {
			const events = array(
				await this.call(`/repos/${repository}/issues/${number}/events?per_page=100&page=${page}`, token),
			).map(record);
			const merged = events.find((event) => event.event === 'merged');
			if (merged) return typeof merged.commit_id === 'string' ? merged.commit_id : undefined;
			if (events.length < 100) return undefined;
		}
		return undefined;
	}
	/** Resume only the exact commit checkpointed before branch publication. */
	async resumePreparation(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		head: string,
	): Promise<{ url: string; head: string }> {
		const { name, id } = snapshot.repository;
		const token = await this.token(name, id, { contents: 'write', pull_requests: 'write' });
		const commit = record(await this.call(`/repos/${name}/git/commits/${sha(head)}`, token));
		const parents = array(commit.parents).map(record);
		if (parents.length !== 1 || parents[0]?.sha !== snapshot.sha) {
			throw new Error('Preparation commit ancestry changed');
		}
		const rules = await this.call(`/repos/${name}/rules/branches/${encodeURIComponent(branch)}`, token);
		if (rules === null) throw new Error('Branch rules unavailable');
		if (
			array(rules).map(record).some(rule => rule.type === 'required_signatures')
			&& record(commit.verification).verified !== true
		) {
			throw new Error('Preparation commit signature is not verified');
		}
		const existing = await this.call(`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`, token);
		if (existing && sha(record(record(existing).object).sha) !== head) throw new Error('Preparation branch changed');
		if (!existing) {
			await this.call(`/repos/${name}/git/refs`, token, 'POST', { ref: `refs/heads/${branch}`, sha: head });
		}
		return this.finishPullRequest(snapshot, branch, title, body, head, token);
	}
	/** Inspect the existing setup proposal; automatic maintenance never opens a replacement PR. */
	async openSetupPull(
		name: string,
		id: number,
	): Promise<{ number: number; head: string; url: string; body: string } | undefined> {
		const token = await this.token(name, id, { contents: 'read', pull_requests: 'read' });
		const rows = array(
			await this.call(
				`/repos/${name}/pulls?state=open&head=${encodeURIComponent(`${name.split('/')[0]}:automation/onboarding`)}`,
				token,
			),
		).map(record);
		if (rows.length > 1) throw new Error('Multiple open setup pull requests');
		const pull = rows[0];
		if (!pull) return;
		if (record(record(pull.head).repo).id !== id || record(pull.head).ref !== 'automation/onboarding') {
			throw new Error('Setup pull request repository mismatch');
		}
		return {
			number: integer(pull.number),
			head: sha(record(pull.head).sha),
			url: text(pull.html_url),
			body: typeof pull.body === 'string' ? pull.body : '',
		};
	}
	/** Update only the bot's status section, including when a human changed the proposal branch. */
	async setupStatus(name: string, id: number, number: number, status: string): Promise<void> {
		const token = await this.token(name, id, { pull_requests: 'write' });
		const pull = record(await this.call(`/repos/${name}/pulls/${number}`, token));
		if (
			pull.state !== 'open' || record(pull.head).ref !== 'automation/onboarding'
			|| record(record(pull.head).repo).id !== id
		) return;
		const start = '<!-- beepboop:setup-status -->', end = '<!-- /beepboop:setup-status -->';
		const current = typeof pull.body === 'string' ? pull.body : '';
		const section = `${start}\n${status}\n${end}`;
		const from = current.indexOf(start), to = current.indexOf(end, from);
		const body = from >= 0 && to >= from
			? current.slice(0, from) + section + current.slice(to + end.length)
			: `${current}\n\n${section}`;
		if (body !== current) await this.call(`/repos/${name}/pulls/${number}`, token, 'PATCH', { body });
	}
	/** Refresh setup documentation without creating an empty commit or overwriting branch edits. */
	async refreshPullRequest(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		expectedHead: string,
	): Promise<{ url: string; head: string }> {
		const token = await this.token(snapshot.repository.name, snapshot.repository.id, {
			contents: 'read',
			pull_requests: 'write',
		});
		const current = await this.call(
			`/repos/${snapshot.repository.name}/git/ref/heads/${encodeURIComponent(branch)}`,
			token,
		);
		if (!current || sha(record(record(current).object).sha) !== expectedHead) {
			throw new Error('Branch changed; preserve user edits and review the conflict');
		}
		return this.finishPullRequest(snapshot, branch, title, body, expectedHead, token);
	}
	private async finishPullRequest(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		head: string,
		token: string,
	): Promise<{ url: string; head: string }> {
		const { name } = snapshot.repository;
		const owner = name.split('/')[0];
		const pulls = array(
			await this.call(
				`/repos/${name}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`,
				token,
			),
		);
		if (pulls.length > 1) throw new Error('Multiple matching pull requests');
		if (pulls[0] && record(pulls[0]).state !== 'open') throw new Error('Preparation pull request was closed');
		const pull = pulls[0]
			? record(
				await this.call(
					`/repos/${name}/pulls/${integer(record(pulls[0]).number)}`,
					token,
					'PATCH',
					{ title, body },
				),
			)
			: record(
				await this.call(`/repos/${name}/pulls`, token, 'POST', {
					title,
					body,
					head: branch,
					base: snapshot.repository.defaultBranch,
				}),
			);
		const available = array(await this.call(`/repos/${name}/labels?per_page=100`, token)).map(
			record,
		);
		let labels = available
			.map((label) => text(label.name))
			.filter((name) =>
				['maintenance', 'type:maintenance', 'area:release', 'release', 'dependencies'].includes(
					name,
				)
			);
		labels = labels.filter((name) => name !== 'dependencies');
		if (!labels.length) {
			await this.call(`/repos/${name}/labels`, token, 'POST', {
				name: 'maintenance',
				color: '527a67',
				description: 'Repository maintenance and release automation',
			});
			labels = ['maintenance'];
		}
		const applied = array(
			await this.call(`/repos/${name}/issues/${integer(pull.number)}/labels`, token, 'POST', {
				labels,
			}),
		)
			.map(record)
			.map((label) => text(label.name));
		if (labels.some((name) => !applied.includes(name))) {
			throw new Error('Pull request labels were not confirmed');
		}
		const actual = record(await this.call(`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`, token));
		let current = pull;
		for (let attempt = 0; attempt < 5 && record(current.head).sha !== head; attempt++) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			current = record(await this.call(`/repos/${name}/pulls/${integer(pull.number)}`, token));
		}
		if (
			sha(record(actual.object).sha) !== head || record(current.head).sha !== head
			|| record(current.base).ref !== snapshot.repository.defaultBranch
		) {
			throw new Error('Preparation pull request identity changed');
		}
		return { url: text(current.html_url), head };
	}
}

export interface Credentials {
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}
