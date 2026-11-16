import { Clock, Effect, Schema } from 'effect';
import type { RepositoryGateway } from '@/automation/github';
import { createdSchema, gitCommitSchema, gitRefSchema, repositorySchema } from '@/automation/github-resources';
import type { DistributionEvidence, TagSigner } from '@/automation/refs';
import { repositoryNamePattern } from '@/automation/repository-name';
import type { Edit } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { shaPattern } from '@/contract/ids';
import { semVer } from '@/contract/version';
import { fromPromise, fromSync } from '@/failure';

export type { DistributionEvidence } from '@/automation/refs';

export interface DistributionFile extends Edit {
	encoding?: 'base64';
	mode?: '100644' | '100755';
}

interface DistributionRequest {
	repository: string;
	repositoryId: number;
	sourceSha: string;
	version: string;
	paths: readonly string[];
	files: readonly DistributionFile[];
	signer: TagSigner;
}

type Gateway = Pick<RepositoryGateway, 'token' | 'read' | 'file'>;

export function readDistributionMode(
	gateway: Gateway,
	repository: string,
	path: string,
	ref: string,
	token: string,
): Effect.Effect<DistributionFile['mode'], DomainError> {
	return Effect.gen(function*() {
		let tree = ref;
		const parts = path.split('/');
		for (const [index, part] of parts.entries()) {
			const entries = yield* gateway.read(
				Schema.Struct({
					tree: Schema.Array(Schema.Struct({ path: Schema.String, mode: Schema.String, sha: Schema.String })),
				}),
				`/repos/${repository}/git/trees/${tree}`,
				token,
			);
			const entry = entries.tree.find(entry => entry.path === part);
			if (!entry) return undefined;
			if (index === parts.length - 1) {
				if (entry.mode === '100644' || entry.mode === '100755') return entry.mode;
				return yield* precondition(`Unsupported distribution file mode: ${path}`);
			}
			if (entry.mode !== '040000' || !shaPattern.test(entry.sha)) {
				return yield* precondition(`Unsupported distribution directory: ${path}`);
			}
			tree = entry.sha;
		}
		return undefined;
	});
}

function canonicalBase64(value: string): boolean {
	try {
		return btoa(atob(value)) === value;
	} catch {
		return false;
	}
}

/** Read bytes through Git blobs, including files omitted by the Contents API's size limit. */
export function readDistributionFile(
	gateway: Gateway,
	repository: string,
	path: string,
	ref: string,
	encoding: DistributionFile['encoding'],
	token: string,
): Effect.Effect<string, DomainError> {
	if (encoding !== 'base64') return gateway.file(repository, path, ref, token).pipe(Effect.map(value => value ?? ''));
	return Effect.gen(function*() {
		const metadata = yield* gateway.read(
			Schema.NullOr(Schema.Struct({ sha: Schema.String, type: Schema.String })),
			`/repos/${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${
				encodeURIComponent(ref)
			}`,
			token,
		);
		if (metadata === null) return '';
		if (metadata.type !== 'file' || !shaPattern.test(metadata.sha)) {
			return yield* precondition(`Unsupported distribution source file: ${path}`);
		}
		const blob = yield* gateway.read(
			Schema.Struct({ encoding: Schema.String, content: Schema.String }),
			`/repos/${repository}/git/blobs/${metadata.sha}`,
			token,
		);
		const content = blob.content.replace(/\s/g, '');
		if (blob.encoding !== 'base64' || !canonicalBase64(content)) {
			return yield* precondition(`Unsupported distribution source encoding: ${path}`);
		}
		return content;
	});
}

function safePath(path: string): boolean {
	return path.length > 0 && !path.startsWith('/') && !path.includes('\\')
		&& !path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
		&& path.toLowerCase() !== '.github' && path.toLowerCase() !== '.github/workflows'
		&& !path.toLowerCase().startsWith('.github/workflows/');
}

function validateFiles(paths: readonly string[], files: readonly DistributionFile[]): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const permitted = new Set(paths);
		if (permitted.size === 0 || permitted.size !== paths.length || paths.some(path => !safePath(path))) {
			return yield* precondition('Distribution paths must be unique exact file paths outside Git and workflows');
		}
		if (paths.some(path => paths.some(other => other !== path && path.startsWith(`${other}/`)))) {
			return yield* precondition('Distribution paths must name files rather than overlapping directories');
		}
		const incoming = new Set(files.map(file => file.path));
		if (
			incoming.size !== files.length || incoming.size !== permitted.size
			|| files.some(file => !permitted.has(file.path))
		) {
			return yield* precondition('Distribution files must match every configured path exactly once');
		}
		if (files.some(file => file.after.length === 0)) {
			return yield* precondition('Distribution files cannot be deleted or empty');
		}
		if (files.some(file => file.mode !== undefined && file.mode !== '100644' && file.mode !== '100755')) {
			return yield* precondition('Distribution file mode must be a regular file mode');
		}
		if (
			files.some(file => file.encoding === 'base64' && (!canonicalBase64(file.before) || !canonicalBase64(file.after)))
		) {
			return yield* precondition('Distribution file bytes must use canonical base64 encoding');
		}
	});
}

export function createDistribution(
	gateway: Gateway,
	request: DistributionRequest,
): Effect.Effect<DistributionEvidence, DomainError> {
	return Effect.gen(function*() {
		const { repository, repositoryId, sourceSha, paths, files, signer } = request;
		if (
			!repositoryNamePattern.test(repository) || !shaPattern.test(sourceSha) || !Number.isSafeInteger(repositoryId)
			|| repositoryId <= 0
		) {
			return yield* precondition('Distribution requires a repository identity and exact reviewed source commit');
		}
		const version = yield* fromSync(() => Schema.decodeSync(semVer)(request.version));
		yield* validateFiles(paths, files);
		const token = yield* gateway.token(repository, repositoryId, { contents: 'write' });
		const base = `/repos/${repository}`;
		const metadata = yield* gateway.read(repositorySchema, base, token);
		if (metadata.id !== repositoryId || metadata.full_name.toLowerCase() !== repository.toLowerCase()) {
			return yield* precondition('Distribution repository identity changed');
		}
		const branch = metadata.default_branch;
		const headPath = `${base}/git/ref/heads/${encodeURIComponent(branch)}`;
		const assertHead = gateway.read(gitRefSchema, headPath, token).pipe(
			Effect.flatMap(head =>
				head.object.type === 'commit' && head.object.sha === sourceSha
					? Effect.void
					: Effect.fail(precondition('Default branch changed from the reviewed distribution source'))
			),
		);
		yield* assertHead;
		const source = yield* gateway.read(gitCommitSchema, `${base}/git/commits/${sourceSha}`, token);
		for (const file of files) {
			if (
				(yield* readDistributionFile(gateway, repository, file.path, sourceSha, file.encoding, token)) !== file.before
			) {
				return yield* precondition(`Distribution source file changed: ${file.path}`);
			}
		}
		const identity = yield* fromPromise(() => signer.identity());
		const user = /^([^<>\r\n]+) <([^<>\s]+)>$/.exec(identity.userId);
		const name = user?.[1], email = user?.[2];
		if (!name || !email) return yield* precondition('The signing key needs a user ID with a name and email');
		const clock = yield* Clock.Clock;
		const seconds = Math.floor(clock.currentTimeMillisUnsafe() / 1000);
		const author = { name, email, date: new Date(seconds * 1000).toISOString().replace('.000Z', 'Z') };
		const tagger = `${identity.userId} ${seconds} +0000`;
		const signedCommit = (tree: string, parents: string[], message: string) =>
			Effect.gen(function*() {
				const body = `${message}\n`;
				const payload = `tree ${tree}\n${
					parents.map(parent => `parent ${parent}\n`).join('')
				}author ${tagger}\ncommitter ${tagger}\n\n${body}`;
				const signature = yield* fromPromise(() => signer.sign(payload, `beepboop:${repository}`));
				const created = yield* gateway.read(createdSchema, `${base}/git/commits`, token, 'POST', {
					message: body,
					tree,
					parents,
					author,
					committer: author,
					signature,
				});
				const verified = yield* gateway.read(gitCommitSchema, `${base}/git/commits/${created.sha}`, token);
				if (verified.verification.verified !== true) {
					return yield* precondition(`GitHub did not verify distribution signature on ${created.sha}`);
				}
				if (
					verified.tree.sha !== tree || verified.parents.length !== parents.length
					|| verified.parents.some((parent, i) => parent.sha !== parents[i])
				) {
					return yield* precondition(
						`Created distribution commit differs from the signed tree or parents: ${created.sha}`,
					);
				}
				return created.sha;
			});
		const entries = yield* Effect.forEach(files, file => Effect.gen(function*() {
			const entry = { path: file.path, mode: file.mode ?? '100644', type: 'blob' };
			if (file.encoding !== 'base64') return { ...entry, content: file.after };
			const blob = yield* gateway.read(createdSchema, `${base}/git/blobs`, token, 'POST', {
				encoding: 'base64',
				content: file.after,
			});
			return { ...entry, sha: blob.sha };
		}));
		const tree = yield* gateway.read(createdSchema, `${base}/git/trees`, token, 'POST', {
			base_tree: source.tree.sha,
			tree: entries,
		});
		const commit = yield* signedCommit(tree.sha, [sourceSha], `Build ${version} distribution`);
		const ancestryCommit = yield* signedCommit(
			source.tree.sha,
			[sourceSha, commit],
			`Record ${version} distribution ancestry`,
		);
		yield* assertHead;
		return { sourceSha, commit, tree: tree.sha, ancestryCommit, branch, expected: sourceSha };
	});
}
