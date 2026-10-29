import { importPKCS8, SignJWT } from 'jose';
import { array, integer, record, sha, text } from '#model';
import { safeVersionPath } from './editors.ts';
import type { RefState } from './refs.ts';
import type { Edit, Snapshot } from './types.ts';

type Permission = Record<string, 'read' | 'write'>;
export class RepositoryGateway {
	constructor(
		private credentials: Credentials,
		private ownerId: number,
		private transport: typeof fetch = fetch,
	) {}
	async call(path: string, token: string, method = 'GET', body?: unknown): Promise<unknown> {
		if (!path.startsWith('/')) throw new Error('Invalid API path');
		const response = await this.transport(`https://api.github.com${path}`, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(20_000),
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'beepboop',
				'Content-Type': 'application/json',
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (response.status === 404 && method === 'GET') return null;
		if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
		if (response.status === 204) return null;
		return response.json();
	}
	async token(
		name: string,
		id: number | undefined,
		permissions: Permission = { contents: 'read', actions: 'read' },
	): Promise<string> {
		if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error('Invalid repository');
		const key = await importPKCS8(this.credentials.GITHUB_APP_PRIVATE_KEY, 'RS256');
		const jwt = await new SignJWT({})
			.setProtectedHeader({ alg: 'RS256' })
			.setIssuer(this.credentials.GITHUB_APP_ID)
			.setIssuedAt(Math.floor(Date.now() / 1000) - 60)
			.setExpirationTime('9m')
			.sign(key);
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
					|| !/(?:^|\/)(?:node_modules|vendor|target|testdata|fixtures|\.git)\//.test(path)
						&& /(?:^|\/)(?:\.pre-commit-config\.ya?ml|targets.json|Cargo.toml|Cargo.lock|package.json|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock|\.?goreleaser[^/]*\.ya?ml)$|^\.github\/(?:beepboop.json|workflows\/[^/]+\.ya?ml)$/
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
		return { repository: { id, name, defaultBranch }, sha: commitSha, files };
	}
	async preset(reference: string): Promise<{ value: unknown; sha: string }> {
		const match = reference.match(/^github>([\w.-]+\/[\w.-]+):([\w-]+)(?:#([\w./-]+))?$/);
		if (!match) throw new Error('Invalid preset');
		const [, name, preset, ref] = match;
		// Public presets need no installation grant; repository configuration cannot redirect credential-bearing requests.
		const metadata = record(await this.call(`/repos/${name}`, ''));
		const revision = record(
			await this.call(
				`/repos/${name}/commits/${encodeURIComponent(ref ?? text(metadata.default_branch))}`,
				'',
			),
		);
		const commitSha = sha(revision.sha);
		const content = await this.file(name as string, `${preset}.json`, commitSha, '');
		if (content === null) throw new Error('Preset missing');
		return { value: JSON.parse(content), sha: commitSha };
	}
	async pullRequest(
		snapshot: Snapshot,
		branch: string,
		title: string,
		body: string,
		edits: Edit[],
		expectedHead?: string,
		checkpoint?: (head: string) => Promise<void>,
	): Promise<{ url: string; head: string }> {
		const { name, id } = snapshot.repository;
		const token = await this.token(name, id, { contents: 'write', pull_requests: 'write' });
		const existing = await this.call(
			`/repos/${name}/git/ref/heads/${encodeURIComponent(branch)}`,
			token,
		);
		const base = existing ? sha(record(record(existing).object).sha) : snapshot.sha;
		if (existing && (!expectedHead || expectedHead !== base)) {
			throw new Error('Branch changed; preserve user edits and review the conflict');
		}
		const commit = record(await this.call(`/repos/${name}/git/commits/${base}`, token));
		for (const edit of edits) {
			const current = await this.file(name, edit.path, base, token);
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
				parents: [base],
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
		if (checkpoint) await checkpoint(head);
		if (existing) {
			await this.call(
				`/repos/${name}/git/refs/heads/${encodeURIComponent(branch)}`,
				token,
				'PATCH',
				{ sha: head, force: false },
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
		const pull = record(await this.call(`/repos/${repository}/pulls/${url.pathname.slice(prefix.length)}`, token));
		if (
			pull.merged !== true || pull.merge_commit_sha !== sha(target)
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
		if (
			sha(record(actual.object).sha) !== head || record(pull.head).sha !== head
			|| record(pull.base).ref !== snapshot.repository.defaultBranch
		) {
			throw new Error('Preparation pull request identity changed');
		}
		return { url: text(pull.html_url), head };
	}
}

export interface Credentials {
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}
