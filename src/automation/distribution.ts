import { Clock, Effect, Schema } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import { verifyDistributionAttestation } from '@/automation/distribution-attestation';
import type { RepositoryGateway } from '@/automation/github';
import { createdSchema, gitCommitSchema, gitRefSchema, repositorySchema } from '@/automation/github-resources';
import type { DistributionEvidence, TagSigner } from '@/automation/refs';
import type { DistributionSubmission } from '@/contract/distribution';
import { parseDistributionManifest, safeDistributionPath } from '@/contract/distribution';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { semVer } from '@/contract/version';
import { fromPromise, fromSync } from '@/failure';

export type { DistributionEvidence } from '@/automation/refs';

interface DistributionAuthorization {
	repository: string;
	repositoryId: number;
	sourceSha: string;
	executionId: string;
	paths: readonly string[];
	submission: DistributionSubmission;
	identity: WorkflowIdentity;
}
interface DistributionRequest extends DistributionAuthorization {
	version: string;
	signer: TagSigner;
}
type Gateway = Pick<RepositoryGateway, 'token' | 'read'>;

export function authorizeDistribution(request: DistributionAuthorization) {
	return Effect.gen(function*() {
		const { repository, repositoryId, sourceSha, executionId, paths, submission, identity } = request;
		const manifest = yield* Effect.fromResult(parseDistributionManifest(submission.manifest));
		if (
			manifest.executionId !== executionId || manifest.repository !== repository
			|| manifest.repositoryId !== repositoryId
			|| manifest.sourceSha !== sourceSha || manifest.repository !== identity.repository
			|| manifest.repositoryId !== identity.repositoryId || manifest.workflowSha !== identity.workflowSha
			|| manifest.workflowRef !== identity.workflowRef || manifest.runSha !== identity.sha
			|| manifest.runId !== identity.runId || manifest.runAttempt !== identity.attempt
		) {
			return yield* precondition('Distribution manifest does not match the authorized release and workflow run');
		}
		const permitted = new Set(paths);
		if (
			!paths.length || paths.length !== permitted.size || paths.some(path => !safeDistributionPath(path))
			|| paths.length !== manifest.files.length || manifest.files.some(file => !permitted.has(file.path))
		) {
			return yield* precondition('Distribution files must match every configured path exactly once');
		}
		const provenance = yield* verifyDistributionAttestation({
			manifest,
			manifestText: submission.manifest,
			bundle: submission.bundle,
			identity,
		});
		return { manifest, provenance };
	});
}

export function createDistribution(
	gateway: Gateway,
	request: DistributionRequest,
): Effect.Effect<DistributionEvidence, DomainError> {
	return Effect.gen(function*() {
		const { repository, repositoryId, sourceSha, signer } = request;
		const { manifest, provenance } = yield* authorizeDistribution(request);
		const version = yield* fromSync(() => Schema.decodeSync(semVer)(request.version));
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
		const entries = manifest.files.map(file => ({ path: file.path, mode: file.mode, type: 'blob', sha: file.blobSha }));
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
		return { sourceSha, commit, tree: tree.sha, ancestryCommit, branch, expected: sourceSha, manifest, provenance };
	});
}
