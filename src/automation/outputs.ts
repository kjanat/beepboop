import { Effect } from 'effect';
import { z } from 'zod';
import type { Artifact, Execution } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { sha256DigestPattern } from '@/contract/ids';

export const nameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const outputSchema = z.strictObject({
	id: nameSchema,
	kind: z.enum(['archive', 'binary', 'manifest', 'package', 'checksums']),
});
export const inputSchema = z.strictObject({ operation: nameSchema, output: nameSchema });
export const platformSchema = z.strictObject({ os: nameSchema, arch: nameSchema, abi: nameSchema.optional() });
export type OutputDeclaration = z.infer<typeof outputSchema>;
export type InputDeclaration = z.infer<typeof inputSchema>;
export type Platform = z.infer<typeof platformSchema>;
export interface ResolvedInput extends InputDeclaration {
	executionId: string;
	sourceSha: string;
	version?: string;
	platform?: Platform;
	kind: OutputDeclaration['kind'];
	artifact: Artifact;
}

export function outputsComplete(execution: Execution): boolean {
	return (execution.workflow?.outputs ?? []).every(output =>
		execution.artifacts.filter(artifact => artifact.name === output.id).length === 1
	);
}

/** Only consume outputs already verified by the producer's report endpoint. */
export function resolveInputs(
	execution: Execution,
	dependencies: Execution[],
	now = Date.now(),
): Effect.Effect<ResolvedInput[], DomainError> {
	return Effect.forEach(execution.workflow?.artifactInputs ?? [], input => {
		const matches = dependencies.filter(dependency =>
			execution.dependencies.includes(dependency.id) && dependency.operation === input.operation
			&& dependency.repositoryId === execution.repositoryId && dependency.stream === execution.stream
			&& dependency.eventId === execution.eventId && dependency.configurationSha === execution.configurationSha
			&& dependency.sourceSha === execution.sourceSha
		);
		const producer = matches[0];
		if (matches.length !== 1 || !producer || producer.state !== 'succeeded') {
			return Effect.fail(precondition(`Output producer is not ready: ${input.operation}`));
		}
		const declaration = producer.workflow?.outputs?.find(output => output.id === input.output);
		const artifacts = producer.artifacts.filter(artifact => artifact.name === input.output);
		const artifact = artifacts[0];
		if (
			!declaration || artifacts.length !== 1 || !artifact || artifact.runId !== producer.runId
			|| !sha256DigestPattern.test(artifact.digest)
			|| !(Date.parse(artifact.expiresAt) > now)
		) {
			return Effect.fail(precondition(`Output is unavailable: ${input.operation}/${input.output}`));
		}
		return Effect.succeed({
			...input,
			executionId: producer.id,
			sourceSha: producer.sourceSha,
			version: producer.version,
			platform: producer.workflow?.platform,
			kind: declaration.kind,
			artifact: structuredClone(artifact),
		});
	});
}

export function mergeArtifacts(
	prior: Artifact[],
	incoming: Artifact[],
	outputs: OutputDeclaration[] = [],
): Effect.Effect<Artifact[], DomainError> {
	return Effect.gen(function*() {
		const result = new Map(prior.map(artifact => [artifact.id, artifact]));
		for (const artifact of incoming) {
			const existing = result.get(artifact.id);
			if (
				existing && (existing.digest !== artifact.digest || existing.name !== artifact.name
					|| existing.runId !== artifact.runId || existing.expiresAt !== artifact.expiresAt)
			) {
				return yield* precondition('Artifact identity changed');
			}
			result.set(artifact.id, artifact);
		}
		for (const output of outputs) {
			if ([...result.values()].filter(artifact => artifact.name === output.id).length > 1) {
				return yield* precondition(`Ambiguous output artifact: ${output.id}`);
			}
		}
		return [...result.values()];
	});
}
