export const ownerId = 6353477;
export const ownerLogin = 'octo';
export const appId = '1000';
export const appSlug = 'beepboop-test';
export const botId = 41898282;
export const botLogin = `${appSlug}[bot]`;
export const installationId = 77;

export interface Commit {
	sha: string;
	tree: string;
	parents: string[];
	message: string;
	verified: boolean;
	authorId: number;
}
export interface Pull {
	number: number;
	head: { ref: string; sha: string };
	base: string;
	state: 'open' | 'closed';
	merged: boolean;
	mergeSha?: string;
	title: string;
	body: string;
	labels: string[];
	assignees: string[];
	reviewers: string[];
	author?: string;
}
export interface Run {
	id: number;
	path: string;
	event: string;
	headSha: string;
	headBranch: string | null;
	status: 'queued' | 'in_progress' | 'completed';
	conclusion: string | null;
	attempt: number;
	title: string;
	inputs: Record<string, string>;
}
export interface CheckRun {
	name: string;
	status: 'queued' | 'in_progress' | 'completed';
	conclusion: string | null;
	runId?: number;
}
export interface Release {
	id: number;
	tag: string;
	target: string;
	draft: boolean;
	prerelease: boolean;
	authorId: number;
	body: string;
	assets?: string[];
}
export interface Repository {
	id: number;
	name: string;
	defaultBranch: string;
	trees: Map<string, Map<string, string>>;
	commits: Map<string, Commit>;
	refs: Map<string, string>;
	pulls: Pull[];
	runs: Run[];
	checks: Map<string, CheckRun[]>;
	labels: Set<string>;
	releases: Release[];
	signatures: boolean;
	tagObjects: Map<string, { name: string; commit: string; verified: boolean }>;
}

function hash(value: unknown): string {
	return new Bun.CryptoHasher('sha1').update(JSON.stringify(value)).digest('hex');
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function json(value: unknown, status = 200): Response {
	return Response.json(value, { status });
}

function fields(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}

function stringField(value: Record<string, unknown>, name: string): string {
	const field = value[name];
	if (typeof field !== 'string') throw new HttpError(422, `${name} must be a string`);
	return field;
}

type Route = (match: RegExpExecArray, url: URL, body: Record<string, unknown>) => Response;

export class FakeGitHub {
	readonly repositories = new Map<string, Repository>();
	readonly unhandled: string[] = [];
	readonly dispatches: { repository: string; file: string; ref: string; inputs: Record<string, string> }[] = [];
	private nextId = 1000;
	private readonly routes: [string, RegExp, Route][] = [];
	private suspendedAt: string | null = null;
	private readonly uninstalled = new Set<string>();

	constructor() {
		const repo = '/repos/([^/]+/[^/]+)';
		this.route('GET', /^\/app$/, () => json({ slug: appSlug, id: Number(appId) }));
		this.route(
			'GET',
			/^\/app\/installations$/,
			() => json([{ id: installationId, account: { id: ownerId, login: ownerLogin } }]),
		);
		this.route(
			'POST',
			/^\/app\/installations\/(\d+)\/access_tokens$/,
			(_, __, body) => {
				if (this.suspendedAt) throw new HttpError(403, 'This installation has been suspended');
				const ids = Array.isArray(body.repository_ids) ? body.repository_ids : [];
				const names = Array.isArray(body.repositories) ? body.repositories : [];
				const missing = [...this.repositories.values()].some(repository =>
					this.uninstalled.has(repository.name)
					&& (ids.includes(repository.id) || names.includes(repository.name.split('/')[1]))
				);
				if (missing) {
					throw new HttpError(422, 'There is at least one repository that does not exist or is not accessible');
				}
				return json({ token: `ghs_${this.id()}`, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
			},
		);
		this.route('GET', /^\/users\/([^/]+)$/, match => {
			if (decodeURIComponent(match[1] ?? '') !== botLogin) throw new HttpError(404, 'Not Found');
			return json({ login: botLogin, id: botId, type: 'Bot' });
		});
		this.route('GET', new RegExp(`^${repo}/installation$`), match => {
			const repository = this.repository(match[1]);
			if (this.uninstalled.has(repository.name)) throw new HttpError(404, 'Not Found');
			return json({
				id: installationId,
				account: { id: ownerId, login: ownerLogin },
				suspended_at: this.suspendedAt,
			});
		});
		this.route('GET', new RegExp(`^${repo}$`), match => {
			const repository = this.repository(match[1]);
			return json({
				id: repository.id,
				full_name: repository.name,
				owner: { id: ownerId, login: ownerLogin },
				default_branch: repository.defaultBranch,
			});
		});
		this.route('GET', new RegExp(`^${repo}/commits/([^/]+)$`), match => {
			const repository = this.repository(match[1]);
			const commit = this.resolve(repository, decodeURIComponent(match[2] ?? ''));
			return json({
				sha: commit.sha,
				commit: { message: commit.message, verification: { verified: commit.verified } },
			});
		});
		this.route('GET', new RegExp(`^${repo}/git/trees/([0-9a-f]{40})$`), match => {
			const repository = this.repository(match[1]);
			const commit = this.resolve(repository, match[2] ?? '');
			const files = this.files(repository, commit);
			return json({
				sha: commit.tree,
				truncated: false,
				tree: [...files.keys()].sort().map(path => ({ path, type: 'blob', mode: '100644' })),
			});
		});
		this.route('GET', new RegExp(`^${repo}/contents/(.+)$`), (match, url) => {
			const repository = this.repository(match[1]);
			const commit = this.resolve(repository, url.searchParams.get('ref') ?? repository.defaultBranch);
			const content = this.files(repository, commit).get(decodeURIComponent(match[2] ?? ''));
			if (content === undefined) throw new HttpError(404, 'Not Found');
			return json({ encoding: 'base64', content: Buffer.from(content).toString('base64'), size: content.length });
		});
		this.route('GET', new RegExp(`^${repo}/git/matching-refs/tags(?:/(.*))?$`), match => {
			const repository = this.repository(match[1]);
			const prefix = `tags/${decodeURIComponent(match[2] ?? '')}`;
			return json(
				[...repository.refs.keys()].filter(ref => ref.startsWith(prefix)).map(ref => ({ ref: `refs/${ref}` })),
			);
		});
		this.route('GET', new RegExp(`^${repo}/git/ref/(heads|tags)/(.+)$`), match => {
			const repository = this.repository(match[1]);
			const name = `${match[2]}/${decodeURIComponent(match[3] ?? '')}`;
			const sha = repository.refs.get(name);
			if (!sha) throw new HttpError(404, 'Not Found');
			const tag = repository.tagObjects.get(sha);
			return json({ ref: `refs/${name}`, object: { sha, type: tag ? 'tag' : 'commit' } });
		});
		this.route('GET', new RegExp(`^${repo}/git/tags/([0-9a-f]{40})$`), match => {
			const repository = this.repository(match[1]);
			const tag = repository.tagObjects.get(match[2] ?? '');
			if (!tag) throw new HttpError(404, 'Not Found');
			return json({
				tag: tag.name,
				object: { sha: tag.commit, type: 'commit' },
				verification: { verified: tag.verified },
			});
		});
		this.route('GET', new RegExp(`^${repo}/git/commits/([0-9a-f]{40})$`), match => {
			const repository = this.repository(match[1]);
			const commit = this.resolve(repository, match[2] ?? '');
			return json({
				sha: commit.sha,
				tree: { sha: commit.tree },
				parents: commit.parents.map(sha => ({ sha })),
				message: commit.message,
				verification: { verified: commit.verified },
			});
		});
		this.route('POST', new RegExp(`^${repo}/git/trees$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const base = repository.trees.get(stringField(body, 'base_tree'));
			if (!base) throw new HttpError(422, 'Unknown base tree');
			const files = new Map(base);
			for (const entry of Array.isArray(body.tree) ? body.tree.map(fields) : []) {
				files.set(stringField(entry, 'path'), stringField(entry, 'content'));
			}
			return json({ sha: this.tree(repository, files) }, 201);
		});
		this.route('POST', new RegExp(`^${repo}/git/commits$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const parents = Array.isArray(body.parents) ? body.parents.map(String) : [];
			const commit = this.commitObject(repository, {
				tree: stringField(body, 'tree'),
				parents,
				message: stringField(body, 'message'),
				verified: true,
				authorId: botId,
			});
			return json({ sha: commit.sha }, 201);
		});
		this.route('POST', new RegExp(`^${repo}/git/refs$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const ref = stringField(body, 'ref').replace(/^refs\//, '');
			if (repository.refs.has(ref)) throw new HttpError(422, 'Reference already exists');
			repository.refs.set(ref, this.resolve(repository, stringField(body, 'sha')).sha);
			return json({ ref: `refs/${ref}` }, 201);
		});
		this.route('PATCH', new RegExp(`^${repo}/git/refs/heads/(.+)$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			repository.refs.set(`heads/${decodeURIComponent(match[2] ?? '')}`, stringField(body, 'sha'));
			for (const pull of repository.pulls) {
				if (pull.head.ref === decodeURIComponent(match[2] ?? '')) pull.head.sha = stringField(body, 'sha');
			}
			return json({});
		});
		this.route('GET', new RegExp(`^${repo}/rules/branches/(.+)$`), match => {
			const repository = this.repository(match[1]);
			return json(repository.signatures ? [{ type: 'required_signatures' }] : []);
		});
		this.route('GET', new RegExp(`^${repo}/pulls$`), (match, url) => {
			const repository = this.repository(match[1]);
			const state = url.searchParams.get('state') ?? 'open';
			const head = url.searchParams.get('head')?.split(':')[1];
			return json(
				repository.pulls.filter(pull =>
					(state === 'all' || pull.state === state) && (head === undefined || pull.head.ref === head)
				).map(pull => this.pullJson(repository, pull)),
			);
		});
		this.route('POST', new RegExp(`^${repo}/pulls$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const ref = stringField(body, 'head');
			const sha = repository.refs.get(`heads/${ref}`);
			if (!sha) throw new HttpError(422, 'Head branch missing');
			const pull: Pull = {
				number: repository.pulls.length + 1,
				head: { ref, sha },
				base: stringField(body, 'base'),
				state: 'open',
				merged: false,
				title: stringField(body, 'title'),
				body: stringField(body, 'body'),
				labels: [],
				assignees: [],
				reviewers: [],
			};
			repository.pulls.push(pull);
			return json(this.pullJson(repository, pull), 201);
		});
		this.route('GET', new RegExp(`^${repo}/pulls/(\\d+)$`), match => {
			const repository = this.repository(match[1]);
			return json(this.pullJson(repository, this.pull(repository, Number(match[2]))));
		});
		this.route('PATCH', new RegExp(`^${repo}/pulls/(\\d+)$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const pull = this.pull(repository, Number(match[2]));
			if (typeof body.title === 'string') pull.title = body.title;
			if (typeof body.body === 'string') pull.body = body.body;
			return json(this.pullJson(repository, pull));
		});
		this.route('GET', new RegExp(`^${repo}/issues/(\\d+)/events$`), match => {
			const repository = this.repository(match[1]);
			const pull = this.pull(repository, Number(match[2]));
			return json(pull.merged ? [{ event: 'merged', commit_id: pull.mergeSha }] : []);
		});
		this.route('GET', new RegExp(`^${repo}/labels$`), match => {
			const repository = this.repository(match[1]);
			return json([...repository.labels].map(name => ({ name })));
		});
		this.route('POST', new RegExp(`^${repo}/labels$`), (match, _url, body) => {
			this.repository(match[1]).labels.add(stringField(body, 'name'));
			return json({ name: stringField(body, 'name') }, 201);
		});
		this.route('POST', new RegExp(`^${repo}/issues/(\\d+)/labels$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const pull = this.pull(repository, Number(match[2]));
			pull.labels = [...new Set([...pull.labels, ...(Array.isArray(body.labels) ? body.labels.map(String) : [])])];
			return json(pull.labels.map(name => ({ name })));
		});
		this.route('POST', new RegExp(`^${repo}/issues/(\\d+)/assignees$`), (match, _url, body) => {
			const pull = this.pull(this.repository(match[1]), Number(match[2]));
			const added = Array.isArray(body.assignees) ? body.assignees.map(String) : [];
			pull.assignees = [...new Set([...pull.assignees, ...added])];
			return json({ number: pull.number, assignees: pull.assignees.map(login => ({ login })) }, 201);
		});
		this.route('POST', new RegExp(`^${repo}/pulls/(\\d+)/requested_reviewers$`), (match, _url, body) => {
			const pull = this.pull(this.repository(match[1]), Number(match[2]));
			const added = Array.isArray(body.reviewers) ? body.reviewers.map(String) : [];
			pull.reviewers = [...new Set([...pull.reviewers, ...added])];
			return json(this.pullJson(this.repository(match[1]), pull), 201);
		});
		this.route('GET', new RegExp(`^${repo}/compare/([^.]+)\\.\\.\\.(.+)$`), match => {
			const repository = this.repository(match[1]);
			const base = this.resolve(repository, decodeURIComponent(match[2] ?? ''));
			const head = this.resolve(repository, decodeURIComponent(match[3] ?? ''));
			const ahead = this.ancestry(repository, head.sha, base.sha);
			const before = this.files(repository, base), after = this.files(repository, head);
			const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path =>
				before.get(path) !== after.get(path)
			);
			return json({
				status: base.sha === head.sha ? 'identical' : ahead ? 'ahead' : 'diverged',
				ahead_by: ahead?.length ?? 0,
				merge_base_commit: { sha: base.sha },
				commits: (ahead ?? []).map(sha => {
					const commit = this.resolve(repository, sha);
					return { sha, author: { id: commit.authorId }, commit: { verification: { verified: commit.verified } } };
				}),
				files: changed.map(filename => ({ filename })),
			});
		});
		this.route('GET', new RegExp(`^${repo}/tags$`), match => {
			const repository = this.repository(match[1]);
			return json(
				[...repository.refs.keys()].filter(ref => ref.startsWith('tags/')).map(ref => ({ name: ref.slice(5) })),
			);
		});
		this.route('GET', new RegExp(`^${repo}/commits/([0-9a-f]{40})/check-runs$`), match => {
			const repository = this.repository(match[1]);
			const runs = repository.checks.get(match[2] ?? '') ?? [];
			return json({
				total_count: runs.length,
				check_runs: runs.map(run => ({
					name: run.name,
					status: run.status,
					conclusion: run.conclusion,
					details_url: `https://github.com/${repository.name}/actions/runs/${run.runId ?? 0}/job/1`,
				})),
			});
		});
		this.route(
			'GET',
			new RegExp(`^${repo}/commits/([0-9a-f]{40})/status$`),
			() => json({ state: 'pending', total_count: 0, statuses: [] }),
		);
		this.route('GET', new RegExp(`^${repo}/actions/runs$`), (match, url) => {
			const repository = this.repository(match[1]);
			const head = url.searchParams.get('head_sha');
			return json({
				workflow_runs: repository.runs.filter(run => head === null || run.headSha === head).map(run =>
					this.runJson(repository, run)
				),
			});
		});
		this.route('POST', new RegExp(`^${repo}/actions/workflows/([^/]+)/dispatches$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const file = decodeURIComponent(match[2] ?? '');
			if (
				!this.files(repository, this.resolve(repository, repository.defaultBranch)).has(`.github/workflows/${file}`)
			) {
				throw new HttpError(404, 'Workflow not found');
			}
			const ref = stringField(body, 'ref').replace(/^refs\/(heads|tags)\//, '');
			const inputs = Object.fromEntries(
				Object.entries(fields(body.inputs)).map(([key, value]) => [key, String(value)]),
			);
			this.dispatches.push({ repository: repository.name, file, ref, inputs });
			repository.runs.push({
				id: this.id(),
				path: `.github/workflows/${file}`,
				event: 'workflow_dispatch',
				headSha: this.resolve(repository, ref).sha,
				headBranch: ref,
				status: 'queued',
				conclusion: null,
				attempt: 1,
				title: inputs.beepboop_title ?? `Release operation ${inputs.beepboop_execution_id ?? ''}`,
				inputs,
			});
			return new Response(null, { status: 204 });
		});
		this.route('GET', new RegExp(`^${repo}/actions/workflows/([^/]+)/runs$`), (match, url) => {
			const repository = this.repository(match[1]);
			const path = `.github/workflows/${decodeURIComponent(match[2] ?? '')}`;
			const event = url.searchParams.get('event');
			return json({
				workflow_runs: repository.runs.filter(run => run.path === path && (event === null || run.event === event))
					.map(run => this.runJson(repository, run)),
			});
		});
		this.route('GET', new RegExp(`^${repo}/actions/runs/(\\d+)$`), match => {
			const repository = this.repository(match[1]);
			return json(this.runJson(repository, this.run(repository, Number(match[2]))));
		});
		this.route('POST', new RegExp(`^${repo}/actions/runs/(\\d+)/cancel$`), match => {
			const run = this.run(this.repository(match[1]), Number(match[2]));
			run.status = 'completed';
			run.conclusion = 'cancelled';
			return json({}, 202);
		});
		this.route('POST', new RegExp(`^${repo}/actions/runs/(\\d+)/rerun-failed-jobs$`), match => {
			const run = this.run(this.repository(match[1]), Number(match[2]));
			run.attempt++;
			run.status = 'queued';
			run.conclusion = null;
			return json({}, 201);
		});
		this.route('GET', new RegExp(`^${repo}/releases$`), match => {
			const repository = this.repository(match[1]);
			return json(repository.releases.map(release => this.releaseJson(repository, release)));
		});
		this.route('GET', new RegExp(`^${repo}/releases/tags/(.+)$`), match => {
			const repository = this.repository(match[1]);
			const release = repository.releases.find(entry =>
				entry.tag === decodeURIComponent(match[2] ?? '') && !entry.draft
			);
			if (!release) throw new HttpError(404, 'Not Found');
			return json(this.releaseJson(repository, release));
		});
		this.route('POST', new RegExp(`^${repo}/releases$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const release: Release = {
				id: this.id(),
				tag: stringField(body, 'tag_name'),
				target: stringField(body, 'target_commitish'),
				draft: body.draft === true,
				prerelease: body.prerelease === true,
				authorId: botId,
				body: typeof body.body === 'string' ? body.body : '',
			};
			repository.releases.push(release);
			return json(this.releaseJson(repository, release), 201);
		});
		this.route('POST', new RegExp(`^${repo}/releases/generate-notes$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const tag = stringField(body, 'tag_name');
			const merged = repository.pulls.filter(pull => pull.merged);
			const link = (pull: Pull) => `https://github.com/${repository.name}/pull/${pull.number}`;
			const firsts = merged.filter((pull, index) =>
				merged.findIndex(other => (other.author ?? botLogin) === (pull.author ?? botLogin)) === index
			);
			return json({
				name: tag,
				body: [
					"## What's Changed",
					...merged.map(pull => `* ${pull.title} by @${pull.author ?? botLogin} in ${link(pull)}`),
					'',
					'## New Contributors',
					...firsts.map(pull => `* @${pull.author ?? botLogin} made their first contribution in ${link(pull)}`),
					'',
					`**Full Changelog**: https://github.com/${repository.name}/commits/${tag}`,
				].join('\r\n'),
			});
		});
		this.route('GET', new RegExp(`^${repo}/releases/(\\d+)$`), match => {
			const repository = this.repository(match[1]);
			return json(this.releaseJson(repository, this.release(repository, Number(match[2]))));
		});
		this.route('PATCH', new RegExp(`^${repo}/releases/(\\d+)$`), (match, _url, body) => {
			const repository = this.repository(match[1]);
			const release = this.release(repository, Number(match[2]));
			if (typeof body.draft === 'boolean') release.draft = body.draft;
			if (typeof body.body === 'string') release.body = body.body;
			return json(this.releaseJson(repository, release));
		});
		this.route('DELETE', new RegExp(`^${repo}/releases/(\\d+)$`), match => {
			const repository = this.repository(match[1]);
			const release = this.release(repository, Number(match[2]));
			repository.releases = repository.releases.filter(entry => entry !== release);
			return new Response(null, { status: 204 });
		});
	}

	private route(method: string, pattern: RegExp, handler: Route): void {
		this.routes.push([method, pattern, handler]);
	}
	private id(): number {
		return this.nextId++;
	}

	async handle(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const text = request.method === 'GET' ? '' : await request.text();
		const body = text ? fields(JSON.parse(text)) : {};
		for (const [method, pattern, handler] of this.routes) {
			if (method !== request.method) continue;
			const match = pattern.exec(url.pathname);
			if (!match) continue;
			try {
				return handler(match, url, body);
			} catch (error) {
				if (error instanceof HttpError) return json({ message: error.message }, error.status);
				throw error;
			}
		}
		this.unhandled.push(`${request.method} ${url.pathname}${url.search}`);
		return json({ message: 'Not handled by the fake GitHub' }, 501);
	}

	suspend(): void {
		this.suspendedAt = new Date().toISOString();
	}
	unsuspend(): void {
		this.suspendedAt = null;
	}
	uninstall(repository: Repository): void {
		this.uninstalled.add(repository.name);
	}
	install(repository: Repository): void {
		this.uninstalled.delete(repository.name);
	}
	repository(name: string | undefined): Repository {
		const repository = this.repositories.get(decodeURIComponent(name ?? ''));
		if (!repository) throw new HttpError(404, 'Not Found');
		return repository;
	}
	create(name: string, files: Record<string, string>, defaultBranch = 'main'): Repository {
		const repository: Repository = {
			id: this.id(),
			name,
			defaultBranch,
			trees: new Map(),
			commits: new Map(),
			refs: new Map(),
			pulls: [],
			runs: [],
			checks: new Map(),
			labels: new Set(['release']),
			releases: [],
			signatures: false,
			tagObjects: new Map(),
		};
		this.repositories.set(name, repository);
		const tree = this.tree(repository, new Map(Object.entries(files)));
		const commit = this.commitObject(repository, {
			tree,
			parents: [],
			message: 'Initial commit',
			verified: true,
			authorId: ownerId,
		});
		repository.refs.set(`heads/${defaultBranch}`, commit.sha);
		return repository;
	}
	push(
		repository: Repository,
		files: Record<string, string | null>,
		message: string,
		branch = repository.defaultBranch,
	): Commit {
		const parent = this.resolve(repository, branch);
		const next = new Map(this.files(repository, parent));
		for (const [path, content] of Object.entries(files)) {
			if (content === null) next.delete(path);
			else next.set(path, content);
		}
		const commit = this.commitObject(repository, {
			tree: this.tree(repository, next),
			parents: [parent.sha],
			message,
			verified: true,
			authorId: ownerId,
		});
		repository.refs.set(`heads/${branch}`, commit.sha);
		for (const pull of repository.pulls) {
			if (pull.state === 'open' && pull.head.ref === branch) pull.head.sha = commit.sha;
		}
		return commit;
	}
	merge(repository: Repository, number: number): Commit {
		const pull = this.pull(repository, number);
		const head = this.resolve(repository, pull.head.sha);
		const base = this.resolve(repository, repository.defaultBranch);
		const commit = this.commitObject(repository, {
			tree: head.tree,
			parents: [base.sha, head.sha],
			message: `Merge pull request #${number}`,
			verified: true,
			authorId: ownerId,
		});
		repository.refs.set(`heads/${repository.defaultBranch}`, commit.sha);
		pull.state = 'closed';
		pull.merged = true;
		pull.mergeSha = commit.sha;
		return commit;
	}
	head(repository: Repository): string {
		return this.resolve(repository, repository.defaultBranch).sha;
	}
	relabel(repository: Repository, from: string, to: string): void {
		const commit = repository.commits.get(from);
		if (!commit || repository.commits.has(to)) throw new Error('Cannot relabel commit');
		repository.commits.delete(from);
		commit.sha = to;
		repository.commits.set(to, commit);
		for (const [ref, sha] of repository.refs) if (sha === from) repository.refs.set(ref, to);
		const checks = repository.checks.get(from);
		if (checks) {
			repository.checks.delete(from);
			repository.checks.set(to, checks);
		}
		for (const pull of repository.pulls) {
			if (pull.head.sha === from) pull.head.sha = to;
			if (pull.mergeSha === from) pull.mergeSha = to;
		}
		for (const run of repository.runs) if (run.headSha === from) run.headSha = to;
	}
	recordTag(repository: Repository, name: string, oid: string, commit: string, verified: boolean): void {
		repository.refs.set(`tags/${name}`, oid);
		repository.tagObjects.set(oid, { name, commit, verified });
	}
	file(repository: Repository, path: string, ref = repository.defaultBranch): string | undefined {
		return this.files(repository, this.resolve(repository, ref)).get(path);
	}
	pull(repository: Repository, number: number): Pull {
		const pull = repository.pulls.find(entry => entry.number === number);
		if (!pull) throw new HttpError(404, 'Not Found');
		return pull;
	}
	release(repository: Repository, id: number): Release {
		const release = repository.releases.find(entry => entry.id === id);
		if (!release) throw new HttpError(404, 'Not Found');
		return release;
	}
	run(repository: Repository, id: number): Run {
		const run = repository.runs.find(entry => entry.id === id);
		if (!run) throw new HttpError(404, 'Not Found');
		return run;
	}
	resolve(repository: Repository, reference: string): Commit {
		const sha = /^[0-9a-f]{40}$/.test(reference)
			? reference
			: repository.refs.get(`heads/${reference.replace(/^refs\/heads\//, '')}`)
				?? repository.refs.get(`tags/${reference.replace(/^refs\/tags\//, '')}`);
		const commit = sha === undefined ? undefined : repository.commits.get(sha);
		if (!commit) throw new HttpError(404, 'No commit found');
		return commit;
	}
	private files(repository: Repository, commit: Commit): Map<string, string> {
		const files = repository.trees.get(commit.tree);
		if (!files) throw new HttpError(404, 'Tree missing');
		return files;
	}
	private tree(repository: Repository, files: Map<string, string>): string {
		const sha = hash([...files].sort(([a], [b]) => a.localeCompare(b)));
		repository.trees.set(sha, files);
		return sha;
	}
	private commitObject(repository: Repository, commit: Omit<Commit, 'sha'>): Commit {
		const created = { ...commit, sha: hash([commit, repository.commits.size, Date.now()]) };
		repository.commits.set(created.sha, created);
		return created;
	}
	private ancestry(repository: Repository, head: string, base: string): string[] | undefined {
		const path: string[] = [];
		let current = repository.commits.get(head);
		while (current && current.sha !== base) {
			path.unshift(current.sha);
			const parent = current.parents.find(sha => sha === base) ?? current.parents.at(-1);
			current = parent === undefined ? undefined : repository.commits.get(parent);
		}
		return current ? path : undefined;
	}
	private pullJson(repository: Repository, pull: Pull) {
		return {
			number: pull.number,
			html_url: `https://github.com/${repository.name}/pull/${pull.number}`,
			state: pull.state,
			merged: pull.merged,
			merged_at: pull.merged ? '2026-01-01T00:00:00Z' : null,
			title: pull.title,
			body: pull.body,
			user: { id: botId },
			assignees: pull.assignees.map(login => ({ login })),
			requested_reviewers: pull.reviewers.map(login => ({ login })),
			head: { ref: pull.head.ref, sha: pull.head.sha, repo: { id: repository.id } },
			base: { ref: pull.base, repo: { id: repository.id, default_branch: repository.defaultBranch } },
		};
	}
	private runJson(repository: Repository, run: Run) {
		return {
			id: run.id,
			path: run.path,
			event: run.event,
			head_sha: run.headSha,
			head_branch: run.headBranch,
			status: run.status,
			conclusion: run.conclusion,
			run_attempt: run.attempt,
			display_title: run.title,
			repository: { id: repository.id },
			head_repository: { id: repository.id },
		};
	}
	private releaseJson(repository: Repository, release: Release) {
		return {
			id: release.id,
			tag_name: release.tag,
			target_commitish: release.target,
			draft: release.draft,
			prerelease: release.prerelease,
			author: { id: release.authorId },
			html_url: `https://github.com/${repository.name}/releases/tag/${release.tag}`,
			body: release.body,
			assets: (release.assets ?? []).map((name, index) => ({
				id: index + 1,
				name,
				state: 'uploaded',
				content_type: 'application/octet-stream',
			})),
		};
	}
}
