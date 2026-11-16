import { Result, Schema } from 'effect';
import { repositoryNamePattern } from '@/automation/repository-name';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { shaPattern } from '@/contract/ids';
import { matchesPattern, mutableArray, refined, strictStruct } from '@/schema';

export function safeDistributionPath(path: string): boolean {
	return path.length > 0 && !path.startsWith('/') && !path.includes('\\')
		&& ![...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		&& !path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
		&& path.toLowerCase() !== '.github' && path.toLowerCase() !== '.github/workflows'
		&& !path.toLowerCase().startsWith('.github/workflows/');
}

const positive = Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)).check(
	Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const sha = Schema.String.check(matchesPattern(shaPattern));
const sha256 = Schema.String.check(matchesPattern(/^[a-f0-9]{64}$/));
export const distributionFileSchema = strictStruct({
	path: refined(Schema.String, safeDistributionPath, 'Invalid distribution path'),
	blobSha: sha,
	sha256,
	size: positive,
	mode: Schema.Literals(['100644', '100755']),
});
export const distributionManifestSchema = strictStruct({
	version: Schema.Literal(1),
	executionId: Schema.String.check(matchesPattern(/^[a-f0-9]{64}$/)),
	repositoryId: positive,
	repository: Schema.String.check(matchesPattern(repositoryNamePattern)),
	sourceSha: sha,
	workflowSha: sha,
	workflowRef: Schema.String.check(Schema.isMinLength(1)),
	runSha: sha,
	runId: positive,
	runAttempt: positive,
	files: mutableArray(distributionFileSchema).check(Schema.isMinLength(1)).check(Schema.isMaxLength(1023)),
});
export type DistributionManifest = typeof distributionManifestSchema.Type;
export type DistributionFile = typeof distributionFileSchema.Type;
export const distributionSubmissionSchema = strictStruct({ manifest: Schema.String, bundle: Schema.Unknown });
export type DistributionSubmission = typeof distributionSubmissionSchema.Type;
export const distributionProvenanceSchema = strictStruct({
	manifestSha256: sha256,
	bundleSha256: sha256,
	runId: positive,
	runAttempt: positive,
	workflowSha: sha,
	workflowRef: Schema.String,
	runSha: sha,
});
export type DistributionProvenance = typeof distributionProvenanceSchema.Type;

export function distributionManifestName(executionId: string): string {
	return `beepboop-distribution-${executionId}.json`;
}

/** A stable authorization document; only metadata and object identities belong here. */
export function canonicalDistributionManifest(manifest: DistributionManifest): string {
	return `${
		JSON.stringify({
			version: manifest.version,
			executionId: manifest.executionId,
			repositoryId: manifest.repositoryId,
			repository: manifest.repository,
			sourceSha: manifest.sourceSha,
			workflowSha: manifest.workflowSha,
			workflowRef: manifest.workflowRef,
			runSha: manifest.runSha,
			runId: manifest.runId,
			runAttempt: manifest.runAttempt,
			files: [...manifest.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => ({
				path: file.path,
				blobSha: file.blobSha,
				sha256: file.sha256,
				size: file.size,
				mode: file.mode,
			})),
		})
	}\n`;
}

export function parseDistributionManifest(text: string): Result.Result<DistributionManifest, DomainError> {
	return Result.try({
		try: () => {
			if (new TextEncoder().encode(text).byteLength > 262_144) throw new Error('Manifest too large');
			const manifest = Schema.decodeUnknownSync(distributionManifestSchema)(JSON.parse(text));
			const paths = manifest.files.map(file => file.path);
			if (
				new Set(paths).size !== paths.length
				|| paths.some(path => paths.some(other => other !== path && path.startsWith(`${other}/`)))
				|| paths.includes(distributionManifestName(manifest.executionId))
				|| canonicalDistributionManifest(manifest) !== text
			) throw new Error('Noncanonical manifest');
			return manifest;
		},
		catch: () => precondition('Invalid or noncanonical distribution manifest'),
	});
}
