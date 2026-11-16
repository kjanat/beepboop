import { TrustedRoot } from '@sigstore/protobuf-specs';
import { Effect, Schema } from 'effect';
import { DistributionAttestationRoots, verifyDistributionAttestation } from '@/automation/distribution-attestation';
import { distributionManifestSchema } from '@/contract/distribution';

const input = Schema.Struct({
	root: Schema.Unknown,
	request: Schema.Struct({
		manifest: distributionManifestSchema,
		manifestText: Schema.String,
		bundle: Schema.Unknown,
		identity: Schema.Struct({
			repository: Schema.String,
			repositoryId: Schema.Finite,
			ownerId: Schema.Finite,
			actorId: Schema.Finite,
			runId: Schema.Finite,
			attempt: Schema.Finite,
			sha: Schema.String,
			workflowSha: Schema.String,
			workflowRef: Schema.String,
			ref: Schema.String,
			event: Schema.String,
		}),
	}),
});

export default {
	async fetch(request: Request): Promise<Response> {
		try {
			const decoded = Schema.decodeUnknownSync(input)(await request.json());
			const verification = verifyDistributionAttestation(decoded.request);
			const operation = new URL(request.url).pathname === '/production'
				? verification
				: verification.pipe(Effect.provideService(DistributionAttestationRoots, [TrustedRoot.fromJSON(decoded.root)]));
			return Response.json(await Effect.runPromise(operation));
		} catch (error) {
			return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
		}
	},
};
