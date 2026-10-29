import { z } from 'zod';
import type { Artifact, Execution } from './types.ts';

const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const outputSchema = z.strictObject({
	id: name,
	kind: z.enum(['archive', 'binary', 'manifest', 'package', 'checksums']),
});
export const inputSchema = z.strictObject({ operation: name, output: name });
export const platformSchema = z.strictObject({ os: name, arch: name, abi: name.optional() });
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
export function resolveInputs(execution: Execution, dependencies: Execution[], now = Date.now()): ResolvedInput[] {
	return (execution.workflow?.artifactInputs ?? []).map(input => {
		const matches = dependencies.filter(dependency =>
			execution.dependencies.includes(dependency.id) && dependency.operation === input.operation
			&& dependency.repositoryId === execution.repositoryId && dependency.stream === execution.stream
			&& dependency.eventId === execution.eventId && dependency.configurationSha === execution.configurationSha
			&& dependency.sourceSha === execution.sourceSha
		);
		const producer = matches[0];
		if (matches.length !== 1 || !producer || producer.state !== 'succeeded') {
			throw new Error(`Output producer is not ready: ${input.operation}`);
		}
		const declaration = producer.workflow?.outputs?.find(output => output.id === input.output);
		const artifacts = producer.artifacts.filter(artifact => artifact.name === input.output);
		const artifact = artifacts[0];
		if (
			!declaration || artifacts.length !== 1 || !artifact || artifact.runId !== producer.runId
			|| !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)
			|| !(Date.parse(artifact.expiresAt) > now)
		) {
			throw new Error(`Output is unavailable: ${input.operation}/${input.output}`);
		}
		return {
			...input,
			executionId: producer.id,
			sourceSha: producer.sourceSha,
			version: producer.version,
			platform: producer.workflow?.platform,
			kind: declaration.kind,
			artifact: structuredClone(artifact),
		};
	});
}

export function mergeArtifacts(prior: Artifact[], incoming: Artifact[], outputs: OutputDeclaration[] = []): Artifact[] {
	const result = new Map(prior.map(artifact => [artifact.id, artifact]));
	for (const artifact of incoming) {
		const existing = result.get(artifact.id);
		if (
			existing && (existing.digest !== artifact.digest || existing.name !== artifact.name
				|| existing.runId !== artifact.runId || existing.expiresAt !== artifact.expiresAt)
		) {
			throw new Error('Artifact identity changed');
		}
		result.set(artifact.id, artifact);
	}
	for (const output of outputs) {
		if ([...result.values()].filter(artifact => artifact.name === output.id).length > 1) {
			throw new Error(`Ambiguous output artifact: ${output.id}`);
		}
	}
	return [...result.values()];
}
