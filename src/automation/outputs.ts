import { Effect, Schema } from 'effect';
import type { Artifact, Execution } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { sha256DigestPattern } from '@/contract/ids';
import type { Decoded } from '@/schema';
import { matchesPattern, strictStruct } from '@/schema';

export const nameSchema = Schema.String.check(matchesPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/));
export const outputSchema = strictStruct({
	id: nameSchema,
	kind: Schema.Literals(['archive', 'binary', 'manifest', 'package', 'checksums']),
});
export const inputSchema = strictStruct({ operation: nameSchema, output: nameSchema });
export const platformSchema = strictStruct({ os: nameSchema, arch: nameSchema, abi: Schema.optional(nameSchema) });
export type OutputDeclaration = Decoded<typeof outputSchema>;
export type InputDeclaration = Decoded<typeof inputSchema>;
export type Platform = Decoded<typeof platformSchema>;
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

/** Only consume outputs recorded by the authenticated producer's report endpoint. */
export function resolveInputs(
	execution: Execution,
	dependencies: Execution[],
	now?: number,
): Effect.Effect<ResolvedInput[], DomainError> {
	return Effect.clockWith(clock => {
		now ??= clock.currentTimeMillisUnsafe();

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
				|| !(Date.parse(artifact.expiresAt) > (now ?? clock.currentTimeMillisUnsafe()))
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
