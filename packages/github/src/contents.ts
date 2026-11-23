import { Effect, Option, Schema } from 'effect';
import type { Snapshot } from '@/domain/inventory.ts';
import { parsePresetReference } from '@/domain/preset.ts';
import { rawFile, rawPreset } from '@/github/raw.ts';
import {
	blobTreeSchema,
	commitSchema,
	contentSchema,
	matchingRefSchema,
	repositorySchema,
	treeSchema,
} from '@/github/resources.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { ioConcurrency } from '@/kernel/http/retry.ts';
import { decode } from '@/kernel/schema/result.ts';
import { mutableArray } from '@/kernel/schema/structs.ts';

export interface TreeEntry {
	path: string;
	type: string;
	mode: string;
}

export interface SnapshotSource {
	repository: Snapshot['repository'];
	sha: string;
	entries: readonly TreeEntry[];
	read(path: string): Effect.Effect<string | null, DomainError>;
	tags(prefixes: readonly string[]): Effect.Effect<string[], DomainError>;
}

export function readFile(
	github: GitHubRequests,
	name: string,
	path: string,
	ref: string,
	token: string,
): Effect.Effect<string | null, DomainError> {
	return Effect.gen(function*() {
		const result = yield* github.call(
			`/repos/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
			token,
		);
		if (result === null) return null;
		const data = yield* Effect.fromResult(decode(contentSchema, result));
		const content = data.content;
		if (data.encoding !== 'base64' || typeof content !== 'string' || Number(data.size) > 1_048_576) {
			return yield* precondition('Unsupported file');
		}
		return yield* fromSync(() =>
			new TextDecoder('utf-8', { fatal: true }).decode(
				Uint8Array.from(atob(content.replace(/\s/g, '')), (c) => c.charCodeAt(0)),
			)
		);
	});
}

export interface RevisionFiles {
	readonly entries: ReadonlyMap<string, string>;
	read(path: string): Effect.Effect<string | null, DomainError>;
}

export function revisionFiles(
	github: GitHubRequests,
	name: string,
	commitSha: string,
	token: string,
): Effect.Effect<RevisionFiles, DomainError> {
	return Effect.gen(function*() {
		const tree = yield* github.read(blobTreeSchema, `/repos/${name}/git/trees/${commitSha}?recursive=1`, token);
		if (tree.truncated) return yield* precondition('Repository tree truncated');
		return {
			entries: new Map(
				tree.tree.flatMap(entry => entry.type === 'tree' ? [] : [[entry.path, `${entry.mode} ${entry.sha}`] as const]),
			),
			read: path => readFile(github, name, path, commitSha, token),
		};
	});
}

function matchingTags(
	github: GitHubRequests,
	name: string,
	prefixes: readonly string[],
	token: string,
): Effect.Effect<string[], DomainError> {
	return Effect.gen(function*() {
		const refs = yield* Effect.forEach(prefixes, prefix =>
			github.read(
				Schema.NullOr(mutableArray(matchingRefSchema)),
				`/repos/${name}/git/matching-refs/tags${
					prefix ? `/${prefix.split('/').map(encodeURIComponent).join('/')}` : ''
				}`,
				token,
			).pipe(Effect.map(rows => (rows ?? []).map(row => row.ref.slice('refs/tags/'.length)))), {
			concurrency: ioConcurrency,
		});
		return refs.flat();
	});
}

export function snapshotSource(
	github: GitHubRequests,
	transport: Fetcher,
	repository: { name: string; id: number; revision?: string | undefined },
	token: string,
): Effect.Effect<SnapshotSource, DomainError> {
	const { name, id, revision } = repository;
	return Effect.gen(function*() {
		const { default_branch: defaultBranch, private: hidden } = yield* github.read(
			repositorySchema,
			`/repos/${name}`,
			token,
		);
		const { sha: commitSha } = yield* github.read(
			commitSchema,
			`/repos/${name}/commits/${encodeURIComponent(revision ?? defaultBranch)}`,
			token,
		);
		const tree = yield* github.read(treeSchema, `/repos/${name}/git/trees/${commitSha}?recursive=1`, token);
		if (tree.truncated) {
			return yield* precondition('Repository tree truncated; discovery requires complete input');
		}
		const api = (path: string) => readFile(github, name, path, commitSha, token);
		const source: SnapshotSource = {
			repository: { id, name, defaultBranch },
			sha: commitSha,
			entries: tree.tree,
			read: hidden ? api : path =>
				rawFile(transport, name, commitSha, path).pipe(
					Effect.flatMap(Option.match({ onNone: () => api(path), onSome: Effect.succeed })),
				),
			tags: prefixes => matchingTags(github, name, prefixes, token),
		};
		return source;
	});
}

export function loadPreset(
	github: GitHubRequests,
	transport: Fetcher,
	reference: string,
): Effect.Effect<{ value: unknown; sha: string }, DomainError> {
	return Effect.gen(function*() {
		const parsed = parsePresetReference(reference);
		if (parsed?.kind !== 'github') return yield* precondition('Invalid preset');
		const { repository: name, preset, ref } = parsed;
		const published = yield* rawPreset(transport, name, preset, ref);
		if (Option.isSome(published)) return published.value;
		// Public presets need no installation grant; repository configuration cannot redirect credential-bearing requests.
		const metadata = yield* github.read(repositorySchema, `/repos/${name}`, '');
		const { sha: commitSha } = yield* github.read(
			commitSchema,
			`/repos/${name}/commits/${encodeURIComponent(ref ?? metadata.default_branch)}`,
			'',
		);
		const content = yield* readFile(github, name, `${preset}.json`, commitSha, '');
		if (content === null) return yield* precondition('Preset missing');
		return { value: yield* fromSync((): unknown => JSON.parse(content)), sha: commitSha };
	});
}
