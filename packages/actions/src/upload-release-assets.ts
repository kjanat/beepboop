import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Effect, Schema } from 'effect';
import { parseAssetManifest } from '@/actions/asset-manifest.ts';
import type { Environment } from '@/actions/protocol.ts';
import { ActionFailure, attemptAsync, fail, required } from '@/actions/protocol.ts';
import { validRepository } from '@/domain/repository-name.ts';
import { gitHubRequest, githubApiVersion } from '@/github/transport.ts';
import { runMain } from '@/host/main.ts';
import { responseJson, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { retryTransient } from '@/kernel/http/retry.ts';

const releaseSchema = Schema.Struct({
	id: Schema.Int,
	draft: Schema.Boolean,
	tag_name: Schema.String,
	upload_url: Schema.String,
});
const assetSchema = Schema.Struct({
	id: Schema.Int,
	name: Schema.String,
	label: Schema.NullOr(Schema.String),
	digest: Schema.NullOr(Schema.String),
	size: Schema.Int,
	state: Schema.String,
});

function emptyStarter(asset: typeof assetSchema.Type) {
	return asset.state === 'starter' && asset.size === 0 && asset.digest === null;
}

async function workspaceFile(root: string, path: string) {
	if (isAbsolute(path)) throw new Error(`Expected a workspace-relative path: ${path}`);
	const resolved = await realpath(resolve(root, path));
	const local = relative(root, resolved);
	if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local) || !(await stat(resolved)).isFile()) {
		throw new Error(`Expected a regular file inside the workspace: ${path}`);
	}
	return resolved;
}

async function stageAssets(env: Environment, workspace: string, directory: string) {
	if (!!env.ASSETS === !!env.MANIFEST_FILE) throw new Error('Set exactly one of assets or manifest-file');
	const root = await realpath(workspace);
	const source = env.MANIFEST_FILE
		? await readFile(await workspaceFile(root, env.MANIFEST_FILE), 'utf8')
		: env.ASSETS ?? '';
	const entries = parseAssetManifest(source, env.MANIFEST_FORMAT || undefined, env.MANIFEST_FILE);
	const files = [];
	for (const [index, entry] of entries.entries()) {
		const sourceFile = await workspaceFile(root, entry.asset);
		const name = entry.name ?? basename(entry.asset);
		// Hash and upload the same snapshot even when a build process replaces the original file.
		const snapshot = join(directory, String(index));
		await copyFile(sourceFile, snapshot, constants.COPYFILE_FICLONE);
		const hash = createHash('sha256');
		await pipeline(createReadStream(snapshot), hash);
		const sha256 = hash.digest('hex');
		if (entry.sha256 && sha256 !== entry.sha256) throw new Error(`SHA-256 mismatch for ${entry.asset}`);
		const body = Bun.file(snapshot, { type: Bun.file(name).type || 'application/octet-stream' });
		files.push({ name, body, label: entry.displayname, digest: `sha256:${sha256}` });
	}
	return files;
}
type FileAsset = Awaited<ReturnType<typeof stageAssets>>[number];

const upload = Effect.fn('uploadDraftAsset')(function*(
	transport: Fetcher,
	endpoint: string,
	token: string,
	file: FileAsset,
	interrupted: Set<string>,
) {
	const url = new URL(endpoint);
	url.searchParams.set('name', file.name);
	if (file.label !== undefined) url.searchParams.set('label', file.label);
	const response = yield* scopedResponse(Effect.tryPromise({
		try: signal => transport(url, {
			method: 'POST',
			redirect: 'error',
			signal,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'Content-Type': file.body.type,
				'Content-Length': String(file.body.size),
				'X-GitHub-Api-Version': githubApiVersion,
				'User-Agent': 'beepboop',
			},
			body: file.body,
		}),
		catch: () => new ActionFailure({ message: `Lost GitHub response uploading ${file.name}`, retryable: true }),
	}));
	if (!response.ok) {
		if (response.status === 502) interrupted.add(file.name);
		return yield* new ActionFailure({
			message: `GitHub HTTP ${response.status} uploading ${file.name}`,
			retryable: response.status >= 500 || response.status === 422 || response.status === 408,
		});
	}
	const value = yield* responseJson(response).pipe(
		Effect.mapError(() =>
			new ActionFailure({ message: `Unreadable upload receipt for ${file.name}`, retryable: true })
		),
	);
	const receipt = yield* Schema.decodeUnknownEffect(assetSchema)(value);
	if (receipt.name !== file.name) {
		return yield* fail(`GitHub renamed ${file.name} to ${receipt.name}; use that uploaded name in the manifest`);
	}
	if (receipt.state !== 'uploaded' || receipt.digest !== file.digest || receipt.size !== file.body.size) {
		return yield* fail(`GitHub returned a different digest, size, or state for ${file.name}`);
	}
	if (file.label !== undefined && receipt.label !== file.label) {
		return yield* fail(`GitHub did not apply the label for ${file.name}`);
	}
}, Effect.scoped);

export const uploadReleaseAssets = Effect.fn('uploadReleaseAssets')(
	function*(env: Environment, transport: Fetcher = platformFetch) {
		const workspace = yield* Effect.fromResult(required(env, 'GITHUB_WORKSPACE'));
		const repository = yield* Effect.fromResult(required(env, 'GITHUB_REPOSITORY'));
		const token = yield* Effect.fromResult(required(env, 'GH_TOKEN'));
		const id = yield* Effect.fromResult(required(env, 'RELEASE_ID'));
		if (!validRepository(repository)) {
			return yield* fail('Invalid GITHUB_REPOSITORY');
		}
		if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return yield* fail('Invalid release-id');
		if (id !== env.DRAFT_ID) return yield* fail('release-id differs from the execution draft ID');
		const tag = yield* Effect.fromResult(required(env, 'DRAFT_TAG'));
		const directory = yield* Effect.acquireRelease(
			attemptAsync(() => mkdtemp(join(tmpdir(), 'beepboop-assets-'))),
			path => Effect.promise(() => rm(path, { recursive: true, force: true })),
		);
		const files = yield* attemptAsync(() => stageAssets(env, workspace, directory));
		const releasePath = `/repos/${repository}/releases/${id}`;
		const interrupted = new Set<string>();
		const reconcile = Effect.gen(function*() {
			const release = yield* Schema.decodeUnknownEffect(releaseSchema)(
				yield* gitHubRequest(transport, releasePath, token),
			);
			if (!release.draft || release.id !== Number(id) || release.tag_name !== tag) {
				return yield* fail(`Release ${id} is not the requested draft`);
			}
			const endpoint = release.upload_url.replace(/\{\?name,label\}$/, '');
			if (endpoint.toLowerCase() !== `https://uploads.github.com${releasePath}/assets`.toLowerCase()) {
				return yield* fail('Unexpected GitHub upload URL for this release');
			}
			const existing = new Map<string, typeof assetSchema.Type>();
			for (let page = 1;; page++) {
				const values = yield* Schema.decodeUnknownEffect(Schema.Array(assetSchema))(
					yield* gitHubRequest(transport, `${releasePath}/assets?per_page=100&page=${page}`, token),
				);
				for (const asset of values) existing.set(asset.name, asset);
				if (values.length < 100) break;
			}
			for (const file of files) {
				const remote = existing.get(file.name);
				if (remote && emptyStarter(remote)) {
					if (interrupted.has(file.name)) continue;
					return yield* new ActionFailure({
						message:
							`Upload of ${file.name} is still incomplete (asset ID ${remote.id}). Retry after the active upload finishes; if its uploader stopped, remove the empty starter and rerun.`,
						retryable: true,
					});
				}
				if (
					remote && (remote.state !== 'uploaded' || remote.digest !== file.digest || remote.size !== file.body.size)
				) {
					return yield* fail(
						`Existing asset ${file.name} has a different digest, size, or incomplete upload (asset ID ${remote.id})`,
					);
				}
			}
			for (const file of files) {
				const remote = existing.get(file.name);
				if (!remote || remote.state === 'starter') {
					if (remote) {
						const path = `/repos/${repository}/releases/assets/${remote.id}`;
						const current = yield* Schema.decodeUnknownEffect(Schema.NullOr(assetSchema))(
							yield* gitHubRequest(transport, path, token),
						);
						if (!current || current.id !== remote.id || current.name !== file.name || !emptyStarter(current)) {
							return yield* new ActionFailure({
								message: `Asset ${remote.id} changed during upload recovery`,
								retryable: true,
							});
						}
						yield* gitHubRequest(transport, path, token, 'DELETE');
					}
					interrupted.delete(file.name);
					yield* upload(transport, endpoint, token, file, interrupted);
				} else if (file.label !== undefined && remote.label !== file.label) {
					yield* gitHubRequest(transport, `/repos/${repository}/releases/assets/${remote.id}`, token, 'PATCH', {
						label: file.label,
					});
				}
			}
		});
		yield* reconcile.pipe(
			retryTransient({ attempts: 3, delay: 1000, while: e => e instanceof ActionFailure && e.retryable === true }),
		);
	},
	Effect.scoped,
);

if (import.meta.main) await runMain(uploadReleaseAssets(process.env));
