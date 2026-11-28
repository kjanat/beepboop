import { Buffer } from 'node:buffer';
import { Effect, Schema } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import { validDistributionArtifact } from '@/domain/distribution-validation.ts';
import { filesFromZip, maxDirectoryEntries, maxDistributionFiles } from '@/kernel/archive/zip.ts';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { DistributionFile } from '@/release/distribution/validation.ts';
import { readDistributionFile } from '@/release/distribution/validation.ts';

export interface DistributionArtifact {
	id: number;
	digest: string;
}

const manifestPath = 'beepboop-distribution.json';
const manifestSchema = Schema.Struct({
	version: Schema.Literal(1),
	files: Schema.Array(Schema.Struct({ path: Schema.String, mode: Schema.Literals(['100644', '100755']) })),
});

export function readDistributionArtifact(
	gateway: RepositoryGateway,
	input: {
		artifact: DistributionArtifact;
		identity: RunIdentity;
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
		if (!validDistributionArtifact(artifact.id, artifact.digest)) {
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
