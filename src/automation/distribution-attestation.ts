import { createHash } from 'node:crypto';
import { bundleFromJSON } from '@sigstore/bundle';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { toSignedEntity, toTrustMaterial, Verifier } from '@sigstore/verify';
import { Context, Effect, Schema } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import trustedRoots from '@/automation/trust/github-sigstore.json';
import type { DistributionManifest, DistributionProvenance } from '@/contract/distribution';
import { canonicalDistributionManifest, distributionManifestName } from '@/contract/distribution';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { mutableArray, mutableStruct } from '@/schema';

// Production trust is TUF-authenticated by the refresh tool and checked into the deployment.
// This Effect reference is a dependency seam for cryptographic fixtures, never an HTTP input.
export const DistributionAttestationRoots = Context.Reference<readonly TrustedRoot[]>(
	'beepboop/DistributionAttestationRoots',
	{ defaultValue: () => trustedRoots.map(root => TrustedRoot.fromJSON(root)) },
);

export type VerifiedDistributionProvenance = DistributionProvenance;

const statementSchema = mutableStruct({
	_type: Schema.Literal('https://in-toto.io/Statement/v1'),
	predicateType: Schema.Literal('https://slsa.dev/provenance/v1'),
	subject: mutableArray(mutableStruct({ name: Schema.String, digest: mutableStruct({ sha256: Schema.String }) })),
	predicate: mutableStruct({
		buildDefinition: mutableStruct({
			buildType: Schema.Literal('https://actions.github.io/buildtypes/workflow/v1'),
			externalParameters: mutableStruct({
				workflow: mutableStruct({ ref: Schema.String, repository: Schema.String, path: Schema.String }),
			}),
			internalParameters: mutableStruct({
				github: mutableStruct({
					event_name: Schema.String,
					repository_id: Schema.String,
					repository_owner_id: Schema.String,
				}),
			}),
			resolvedDependencies: mutableArray(
				mutableStruct({ uri: Schema.String, digest: mutableStruct({ gitCommit: Schema.String }) }),
			),
		}),
		runDetails: mutableStruct({
			builder: mutableStruct({ id: Schema.String }),
			metadata: mutableStruct({ invocationId: Schema.String }),
		}),
	}),
});

interface VerificationRequest {
	manifest: DistributionManifest;
	manifestText: string;
	bundle: unknown;
	identity: WorkflowIdentity;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function verify(request: VerificationRequest, roots: readonly TrustedRoot[]): VerifiedDistributionProvenance {
	const { manifest, manifestText, identity } = request;
	if (
		canonicalDistributionManifest(manifest) !== manifestText
		|| manifest.repository !== identity.repository || manifest.repositoryId !== identity.repositoryId
		|| manifest.workflowRef !== identity.workflowRef || manifest.workflowSha !== identity.workflowSha
		|| manifest.runSha !== identity.sha || manifest.runId !== identity.runId || manifest.runAttempt !== identity.attempt
	) throw new Error('Distribution manifest does not match the authenticated workflow');
	const repository = `https://github.com/${identity.repository}`;
	const workflow = `https://github.com/${identity.workflowRef}`;
	const prefix = `${identity.repository}/`;
	const suffix = `@${identity.ref}`;
	if (!identity.workflowRef.startsWith(`${prefix}.github/workflows/`) || !identity.workflowRef.endsWith(suffix)) {
		throw new Error('Distribution signer is not the configured repository workflow');
	}
	const path = identity.workflowRef.slice(prefix.length, -suffix.length);
	const invocation = `${repository}/actions/runs/${identity.runId}/attempts/${identity.attempt}`;
	const bundle = bundleFromJSON(request.bundle);
	if (bundle.content.$case !== 'dsseEnvelope') throw new Error('Distribution attestation must be a DSSE statement');
	if (bundle.content.dsseEnvelope.payloadType !== 'application/vnd.in-toto+json') {
		throw new Error('Invalid distribution statement media type');
	}
	const entity = toSignedEntity(bundle);
	if (entity.key.$case !== 'certificate') throw new Error('Distribution attestation must have a signing certificate');
	const subjectAlternativeName = new RegExp(`^${workflow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
	let trusted = false;
	for (const root of roots) {
		try {
			const privateInstance = root.tlogs.length === 0 && root.ctlogs.length === 0;
			new Verifier(
				toTrustMaterial(root),
				privateInstance
					? { tlogThreshold: 0, ctlogThreshold: 0, timestampThreshold: 1 }
					: { tlogThreshold: 1, ctlogThreshold: 1, timestampThreshold: 1 },
			).verify(entity, {
				subjectAlternativeName,
				extensions: { issuer: 'https://token.actions.githubusercontent.com' },
			});
			trusted = true;
			break;
		} catch { /* Every trusted authority must verify the complete bundle independently. */ }
	}
	if (!trusted) throw new Error('Distribution attestation signature, certificate or transparency proof is not trusted');
	const expectedExtensions: Record<string, string> = {
		'9': workflow,
		'10': identity.workflowSha,
		'12': repository,
		'13': identity.sha,
		'14': identity.ref,
		'15': String(identity.repositoryId),
		'17': String(identity.ownerId),
		'18': workflow,
		'19': identity.workflowSha,
		'20': identity.event,
		'21': invocation,
	};
	for (const [oid, expected] of Object.entries(expectedExtensions)) {
		const value = entity.key.certificate.extension(`1.3.6.1.4.1.57264.1.${oid}`)?.valueObj.subs?.[0]?.value.toString(
			'utf8',
		);
		if (value !== expected) throw new Error(`Distribution attestation certificate identity differs (${oid})`);
	}
	const statement = Schema.decodeUnknownSync(statementSchema)(
		JSON.parse(bundle.content.dsseEnvelope.payload.toString('utf8')),
	);
	const definition = statement.predicate.buildDefinition;
	const provenance = statement.predicate.runDetails;
	if (
		definition.externalParameters.workflow.repository !== repository
		|| definition.externalParameters.workflow.path !== path
		|| definition.externalParameters.workflow.ref !== identity.ref
		|| definition.internalParameters.github.repository_id !== String(identity.repositoryId)
		|| definition.internalParameters.github.repository_owner_id !== String(identity.ownerId)
		|| definition.internalParameters.github.event_name !== identity.event
		|| provenance.builder.id !== workflow || provenance.metadata.invocationId !== invocation
		|| !definition.resolvedDependencies.some(dependency =>
			dependency.uri === `git+${repository}@${identity.ref}` && dependency.digest.gitCommit === identity.sha
		)
	) throw new Error('Distribution attestation provenance differs from the authenticated build');
	const digest = sha256(manifestText);
	const required = [{ path: distributionManifestName(manifest.executionId), sha256: digest }, ...manifest.files];
	if (
		statement.subject.length !== required.length
		|| new Set(statement.subject.map(subject => subject.name)).size !== statement.subject.length
	) {
		throw new Error('Distribution attestation subjects differ from the reviewed manifest');
	}
	for (const file of required) {
		if (!statement.subject.some(subject => subject.name === file.path && subject.digest.sha256 === file.sha256)) {
			throw new Error(`Distribution attestation does not cover ${file.path}`);
		}
	}
	return {
		manifestSha256: digest,
		bundleSha256: sha256(JSON.stringify(request.bundle)),
		runId: identity.runId,
		runAttempt: identity.attempt,
		workflowSha: identity.workflowSha,
		workflowRef: identity.workflowRef,
		runSha: identity.sha,
	};
}

export function verifyDistributionAttestation(
	request: VerificationRequest,
): Effect.Effect<VerifiedDistributionProvenance, DomainError> {
	return Effect.gen(function*() {
		const roots = yield* DistributionAttestationRoots;
		return yield* Effect.try({
			try: () => verify(request, roots),
			catch: error => precondition(error instanceof Error ? error.message : 'Invalid distribution attestation'),
		});
	});
}
