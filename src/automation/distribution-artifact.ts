import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import { Effect, Schema } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import type { DistributionFile } from '@/automation/distribution';
import { readDistributionFile } from '@/automation/distribution';
import type { RepositoryGateway } from '@/automation/github';
import { precondition } from '@/contract/errors';
import { fromPromise, fromSync } from '@/failure';

export interface DistributionArtifact {
	id: number;
	digest: string;
}

const manifestPath = 'beepboop-distribution.json';
const maxDistributionFiles = 64;
const maxDirectoryEntries = 128;
const maxTransportFiles = maxDistributionFiles + 2;
const manifestSchema = Schema.Struct({
	version: Schema.Literal(1),
	files: Schema.Array(Schema.Struct({ path: Schema.String, mode: Schema.Literals(['100644', '100755']) })),
});

// Read the bounded ZIP produced by actions/upload-artifact without extracting to a filesystem.
function filesFromZip(bytes: Uint8Array): Map<string, Buffer> {
	const zip = Buffer.from(bytes);
	let end = zip.length - 22;
	for (; end >= Math.max(0, zip.length - 65_557); end--) {
		if (zip.readUInt32LE(end) === 0x06054b50 && end + 22 + zip.readUInt16LE(end + 20) === zip.length) break;
	}
	if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw precondition('Invalid distribution ZIP directory');
	const count = zip.readUInt16LE(end + 10);
	const directorySize = zip.readUInt32LE(end + 12);
	let cursor = zip.readUInt32LE(end + 16);
	if (
		zip.readUInt32LE(end + 4) !== 0 || zip.readUInt16LE(end + 8) !== count
		|| cursor + directorySize !== end
	) {
		throw precondition('Unsupported distribution ZIP directory');
	}
	if (count > maxTransportFiles + maxDirectoryEntries) {
		throw precondition(
			'Distribution ZIP exceeds 194 entries (64 distribution files, 2 metadata files, 128 directories)',
		);
	}
	const files = new Map<string, Buffer>();
	let total = 0;
	let directories = 0;
	for (let index = 0; index < count; index++) {
		if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50) {
			throw precondition('Invalid distribution ZIP entry');
		}
		const flags = zip.readUInt16LE(cursor + 8);
		const method = zip.readUInt16LE(cursor + 10);
		const compressedSize = zip.readUInt32LE(cursor + 20);
		const size = zip.readUInt32LE(cursor + 24);
		const nameSize = zip.readUInt16LE(cursor + 28);
		const entryEnd = cursor + 46 + nameSize + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
		const local = zip.readUInt32LE(cursor + 42);
		if (entryEnd > end || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) {
			throw precondition('Invalid distribution ZIP offsets');
		}
		const nameBytes = zip.subarray(cursor + 46, cursor + 46 + nameSize);
		const name = nameBytes.toString('utf8');
		const localNameSize = zip.readUInt16LE(local + 26);
		const start = local + 30 + localNameSize + zip.readUInt16LE(local + 28);
		const mode = zip.readUInt32LE(cursor + 38) >>> 16;
		if (
			(flags & 1) || (method !== 0 && method !== 8) || start + compressedSize > zip.readUInt32LE(end + 16)
			|| !nameBytes.equals(zip.subarray(local + 30, local + 30 + localNameSize))
			|| zip.readUInt16LE(local + 8) !== method || zip.readUInt16LE(local + 6) !== flags
			|| (mode & 0o170000) === 0o120000 || files.has(name)
			|| name.startsWith('/') || name.includes('\\') || name.includes('\0')
			|| name.split('/').some(part => part === '.' || part === '..' || part.toLowerCase() === '.git')
		) throw precondition('Unsupported distribution ZIP entry');
		cursor = entryEnd;
		if (name.endsWith('/')) {
			if (++directories > maxDirectoryEntries) throw precondition('Distribution ZIP exceeds 128 directory entries');
			continue;
		}
		if (files.size >= maxTransportFiles) throw precondition('Distribution ZIP exceeds 66 file entries');
		total += size;
		if (total > 16 * 1024 * 1024) throw precondition('Unpacked distribution exceeds 16 MiB');
		const compressed = zip.subarray(start, start + compressedSize);
		const content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
		if (content.byteLength !== size) throw precondition('Distribution ZIP size mismatch');
		files.set(name, content);
	}
	if (cursor !== end) throw precondition('Invalid distribution ZIP directory size');
	return files;
}

export function readDistributionArtifact(
	gateway: RepositoryGateway,
	input: {
		artifact: DistributionArtifact;
		identity: WorkflowIdentity;
		sourceSha: string;
		paths: readonly string[];
	},
) {
	return Effect.gen(function*() {
		const { artifact, identity, sourceSha, paths } = input;
		if (paths.some(path => path === manifestPath || path.startsWith(`${manifestPath}/`))) {
			return yield* precondition(
				'beepboop-distribution.json is reserved for artifact transport metadata; use direct-file transport to publish that path',
			);
		}
		if (!paths.length || paths.length > maxDistributionFiles || new Set(paths).size !== paths.length) {
			return yield* precondition('Distribution artifacts require 1 to 64 distinct configured files');
		}
		const directories = new Set(paths.flatMap(path => {
			const parts = path.split('/');
			return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
		}));
		if (directories.size > maxDirectoryEntries) {
			return yield* precondition('Distribution artifact paths require more than 128 directories');
		}
		if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || !/^[a-f0-9]{64}$/.test(artifact.digest)) {
			return yield* precondition('Invalid distribution artifact ID or digest');
		}
		const token = yield* gateway.token(identity.repository, identity.repositoryId, {
			actions: 'read',
			contents: 'read',
		});
		const metadata = yield* gateway.read(
			Schema.Struct({
				id: Schema.Finite,
				digest: Schema.String,
				created_at: Schema.String,
				expired: Schema.Boolean,
				size_in_bytes: Schema.Finite,
				workflow_run: Schema.Struct({ id: Schema.Finite, repository_id: Schema.Finite, head_sha: Schema.String }),
			}),
			`/repos/${identity.repository}/actions/artifacts/${artifact.id}`,
			token,
		);
		if (
			metadata.id !== artifact.id || metadata.expired || metadata.size_in_bytes > 8 * 1024 * 1024
			|| metadata.digest !== `sha256:${artifact.digest}` || metadata.workflow_run.id !== identity.runId
			|| metadata.workflow_run.repository_id !== identity.repositoryId
			|| metadata.workflow_run.head_sha !== identity.sha
		) return yield* precondition('Distribution artifact does not belong to this workflow run and digest');
		const attempt = yield* gateway.read(
			Schema.Struct({ run_started_at: Schema.String }),
			`/repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.attempt}`,
			token,
		);
		const createdAt = Date.parse(metadata.created_at), startedAt = Date.parse(attempt.run_started_at);
		if (!Number.isFinite(createdAt) || !Number.isFinite(startedAt) || createdAt < startedAt) {
			return yield* precondition('Distribution artifact predates this workflow attempt');
		}
		const currentRun = yield* gateway.read(
			Schema.Struct({ run_attempt: Schema.Finite }),
			`/repos/${identity.repository}/actions/runs/${identity.runId}`,
			token,
		);
		if (currentRun.run_attempt !== identity.attempt) {
			return yield* precondition('Distribution artifact belongs to a different workflow attempt');
		}
		const bytes = yield* gateway.downloadWorkflowArtifact(identity.repository, artifact.id, token);
		const hash = yield* fromPromise(() => crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
		if (Buffer.from(hash).toString('hex') !== artifact.digest) {
			return yield* precondition('Distribution artifact digest mismatch');
		}
		const entries = yield* fromSync(() => filesFromZip(bytes));
		const manifest = entries.get(manifestPath);
		if (!manifest?.byteLength || manifest.byteLength > 65_536) {
			return yield* precondition(
				'Distribution artifact requires a root beepboop-distribution.json manifest (at most 64 KiB)',
			);
		}
		const declared = yield* Schema.decodeEffect(Schema.fromJsonString(manifestSchema))(manifest.toString('utf8'))
			.pipe(
				Effect.mapError(() => precondition('Invalid distribution artifact manifest')),
			);
		const modes = new Map(declared.files.map(file => [file.path, file.mode]));
		if (modes.size !== declared.files.length || modes.size !== paths.length || paths.some(path => !modes.has(path))) {
			return yield* precondition('Distribution manifest must declare every configured path exactly once');
		}
		if (
			[...entries.keys()].some(path => path !== manifestPath && path !== 'attestation.json' && !paths.includes(path))
		) {
			return yield* precondition('Distribution artifact contains unconfigured files');
		}
		return yield* Effect.forEach(paths, path => Effect.gen(function*() {
			const file = entries.get(path);
			if (!file?.byteLength) return yield* precondition(`Distribution artifact is missing ${path}`);
			const mode = modes.get(path);
			if (!mode) return yield* precondition(`Distribution manifest is missing ${path}`);
			return {
				path,
				before: yield* readDistributionFile(gateway, identity.repository, path, sourceSha, 'base64', token),
				after: file.toString('base64'),
				encoding: 'base64',
				mode,
			} satisfies DistributionFile;
		}));
	});
}
