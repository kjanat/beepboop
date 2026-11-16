import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { bundleToJSON, toDSSEBundle } from '@sigstore/bundle';
import { initializeCA, initializeCTLog, initializeTLog, initializeTSA } from '@sigstore/mock';
import {
	CertificateAuthority,
	HashAlgorithm,
	PublicKeyDetails,
	TransparencyLogInstance,
	TrustedRoot,
} from '@sigstore/protobuf-specs';
import { Schema } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import type { DistributionManifest } from '@/contract/distribution';
import { canonicalDistributionManifest, distributionManifestName } from '@/contract/distribution';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest();
const key = (curve = 'P-256') => generateKeyPairSync('ec', { namedCurve: curve });
const bytes = (value: ArrayBufferView<ArrayBuffer>) => Buffer.from(value.buffer, value.byteOffset, value.byteLength);
const logEntry = Schema.Record(
	Schema.String,
	Schema.Struct({
		body: Schema.String,
	integratedTime: Schema.Finite,
		logID: Schema.String,
	logIndex: Schema.Finite,
		verification: Schema.Struct({
			signedEntryTimestamp: Schema.String,
			inclusionProof: Schema.Struct({
			logIndex: Schema.Finite,
			treeSize: Schema.Finite,
				rootHash: Schema.String,
				checkpoint: Schema.String,
			}),
		}),
	}),
);
export const attestationIdentity: WorkflowIdentity = {
	repository: 'octo/action',
	repositoryId: 1,
	ownerId: 2,
	actorId: 3,
	runId: 123,
	attempt: 1,
	sha: 'a'.repeat(40),
	workflowSha: 'b'.repeat(40),
	workflowRef: 'octo/action/.github/workflows/publish.yml@refs/heads/main',
	ref: 'refs/heads/main',
	event: 'workflow_dispatch',
};
export const attestationManifest: DistributionManifest = {
	version: 1,
	executionId: 'c'.repeat(64),
	repository: attestationIdentity.repository,
	repositoryId: attestationIdentity.repositoryId,
	sourceSha: 'd'.repeat(40),
	runSha: attestationIdentity.sha,
	workflowSha: attestationIdentity.workflowSha,
	workflowRef: attestationIdentity.workflowRef,
	runId: attestationIdentity.runId,
	runAttempt: attestationIdentity.attempt,
	files: [{ path: 'dist/main.mjs', blobSha: 'e'.repeat(40), sha256: 'f'.repeat(64), mode: '100644', size: 2_000_000 }],
};

export async function signedDistributionFixture(options: {
	privateInstance?: boolean;
	manifest?: DistributionManifest;
	identity?: WorkflowIdentity;
	extensions?: Record<string, string>;
	subjects?: { name: string; digest: { sha256: string } }[];
	predicate?: Record<string, unknown>;
} = {}) {
	const identity = { ...(options.identity ?? attestationIdentity) };
	const manifest = structuredClone(options.manifest ?? attestationManifest);
	const manifestText = canonicalDistributionManifest(manifest);
	const repository = `https://github.com/${identity.repository}`;
	const workflow = `https://github.com/${identity.workflowRef}`;
	const invocation = `${repository}/actions/runs/${identity.runId}/attempts/${identity.attempt}`;
	const clock = new Date(Date.now() + 2000);
	const leafKey = key();
	const ctlog = options.privateInstance ? undefined : await initializeCTLog(key(), clock);
	const ca = await initializeCA(key('P-384'), ctlog, clock);
	const extensions = {
		'8': 'https://token.actions.githubusercontent.com',
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
		...options.extensions,
	};
	const certificate = bytes(
		await ca.issueCertificate({
			publicKey: leafKey.publicKey.export({ type: 'spki', format: 'der' }),
			subjectAltName: workflow,
			extensions: Object.entries(extensions).map(([oid, value]) => ({ oid: `1.3.6.1.4.1.57264.1.${oid}`, value })),
		}),
	);
	const statement = {
		_type: 'https://in-toto.io/Statement/v1',
		predicateType: 'https://slsa.dev/provenance/v1',
		subject: options.subjects ?? [
			{
				name: distributionManifestName(manifest.executionId),
				digest: { sha256: digest(manifestText).toString('hex') },
			},
			...manifest.files.map(file => ({ name: file.path, digest: { sha256: file.sha256 } })),
		],
		predicate: options.predicate ?? {
			buildDefinition: {
				buildType: 'https://actions.github.io/buildtypes/workflow/v1',
				externalParameters: { workflow: { repository, path: '.github/workflows/publish.yml', ref: identity.ref } },
				internalParameters: {
					github: {
						event_name: identity.event,
						repository_id: String(identity.repositoryId),
						repository_owner_id: String(identity.ownerId),
					},
				},
				resolvedDependencies: [{ uri: `git+${repository}@${identity.ref}`, digest: { gitCommit: identity.sha } }],
			},
			runDetails: { builder: { id: workflow }, metadata: { invocationId: invocation } },
		},
	};
	const payload = Buffer.from(JSON.stringify(statement));
	const type = 'application/vnd.in-toto+json';
	const pae = Buffer.concat([Buffer.from(`DSSEv1 ${type.length} ${type} ${payload.length} `), payload]);
	const signature = sign('sha256', pae, leafKey.privateKey);
	const bundle = toDSSEBundle({ artifact: payload, artifactType: type, certificate, signature });
	const root = TrustedRoot.fromJSON({
		mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
		certificateAuthorities: [{
			certChain: { certificates: [{ rawBytes: bytes(ca.rootCertificate).toString('base64') }] },
		}],
	});
	if (options.privateInstance) {
		const tsa = await initializeTSA(key('P-384'), clock);
		const timestamp = await tsa.timestamp({
			artifactHash: digest(signature),
			hashAlgorithmOID: '2.16.840.1.101.3.4.2.1',
			nonce: 1,
			policyOID: '1.3.6.1.4.1.57264.2',
			certReq: true,
		});
		bundle.verificationMaterial.timestampVerificationData = {
			rfc3161Timestamps: [{ signedTimestamp: bytes(timestamp) }],
		};
		root.timestampAuthorities.push(
			CertificateAuthority.fromJSON({
				certChain: {
					certificates: [
						{ rawBytes: bytes(tsa.intCertificate).toString('base64') },
						{ rawBytes: bytes(tsa.rootCertificate).toString('base64') },
					],
				},
			}),
		);
	} else {
		const tlog = await initializeTLog('https://rekor.sigstore.test', key(), clock);
		const pem = `-----BEGIN CERTIFICATE-----\n${
			certificate.toString('base64').match(/.{1,64}/g)?.join('\n')
		}\n-----END CERTIFICATE-----\n`;
		const entries = await tlog.log({
			apiVersion: '0.0.1',
			kind: 'hashedrekord',
			spec: {
				data: { hash: { algorithm: 'sha256', value: digest(pae).toString('hex') } },
				signature: {
					content: signature.toString('base64'),
					publicKey: { content: Buffer.from(pem).toString('base64') },
				},
			},
		});
		const entry = Object.values(Schema.decodeUnknownSync(logEntry)(entries))[0];
		if (!entry) throw new Error('Transparency log returned no entry');
		const proof = entry.verification?.inclusionProof;
		if (!proof) throw new Error('Transparency log returned no inclusion proof');
		bundle.verificationMaterial.tlogEntries = [{
			logIndex: String(entry.logIndex),
			logId: { keyId: Buffer.from(entry.logID, 'hex') },
			kindVersion: { kind: 'hashedrekord', version: '0.0.1' },
			integratedTime: String(entry.integratedTime),
			canonicalizedBody: Buffer.from(String(entry.body), 'base64'),
			inclusionPromise: { signedEntryTimestamp: Buffer.from(entry.verification?.signedEntryTimestamp ?? '', 'base64') },
			inclusionProof: {
				logIndex: String(proof.logIndex),
				treeSize: String(proof.treeSize),
				rootHash: Buffer.from(proof.rootHash, 'hex'),
				hashes: [],
				checkpoint: { envelope: proof.checkpoint },
			},
		}];
		root.tlogs.push(TransparencyLogInstance.fromJSON({
			baseUrl: 'https://rekor.sigstore.test',
			hashAlgorithm: HashAlgorithm.SHA2_256,
			logId: { keyId: digest(tlog.publicKey).toString('base64') },
			publicKey: { rawBytes: tlog.publicKey.toString('base64'), keyDetails: PublicKeyDetails.PKIX_ECDSA_P256_SHA_256 },
		}));
		if (!ctlog) throw new Error('CT log missing');
		root.ctlogs.push(TransparencyLogInstance.fromJSON({
			baseUrl: 'https://ctfe.sigstore.test',
			hashAlgorithm: HashAlgorithm.SHA2_256,
			logId: { keyId: bytes(ctlog.logID).toString('base64') },
			publicKey: { rawBytes: ctlog.publicKey.toString('base64'), keyDetails: PublicKeyDetails.PKIX_ECDSA_P256_SHA_256 },
		}));
	}
	return { request: { manifest, manifestText, bundle: bundleToJSON(bundle), identity }, root, statement };
}
