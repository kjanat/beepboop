import { Schema } from 'effect';
import { releaseOperation } from '@/domain/release-operation.ts';
import { textSchema } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';

export const releaseGate = Schema.Union([
	mutableStruct({ kind: Schema.Literals(['signature', 'status', 'metadata']) }),
	mutableStruct({ kind: Schema.Literal('check'), name: textSchema }),
]);
export type ReleaseGate = Decoded<typeof releaseGate>;

export const gateSkip = mutableStruct({ gate: releaseGate, actor: Schema.String, at: Schema.Finite });
export type GateSkip = Decoded<typeof gateSkip>;

export function sameGate(left: ReleaseGate, right: ReleaseGate): boolean {
	return left.kind === right.kind && (left.kind !== 'check' || right.kind !== 'check' || left.name === right.name);
}

export function gateLabel(gate: ReleaseGate): string {
	switch (gate.kind) {
		case 'signature':
			return 'commit signature';
		case 'status':
			return 'commit status';
		case 'metadata':
			return 'package metadata';
		case 'check':
			return `check ${gate.name}`;
	}
}

export const checkChoices = ['rerun', 'skip', 'always'] as const;
export type CheckChoice = (typeof checkChoices)[number];
export const gateReasons = {
	checks: 'checks failed: ',
	signature: 'signature unverified',
	status: 'commit status ',
	metadata: 'metadata incomplete: ',
} as const;

export function stoppedByGates(reason: string | undefined): boolean {
	return (reason ?? '').split('; ').some(part =>
		part.startsWith(gateReasons.checks) || part === gateReasons.signature || part.startsWith(gateReasons.metadata)
		|| (part.startsWith(gateReasons.status) && part !== `${gateReasons.status}pending`)
	);
}

export function rerunnable(reason: string | undefined): boolean {
	return (reason ?? '').split('; ').some(part => part.startsWith(gateReasons.checks));
}

const waiting = ['pending', 'blocked', 'awaiting-approval'];
export function gatedRelease<T extends { operation: string; stream: string; state: string; createdAt: number }>(
	executions: readonly T[],
	stream: string,
): T | undefined {
	const releaseExecutions = executions
		.filter(execution => execution.operation === releaseOperation && execution.stream === stream)
		.sort((left, right) => right.createdAt - left.createdAt);
	const newest = releaseExecutions[0];
	return releaseExecutions.find(execution => waiting.includes(execution.state))
		?? (newest?.state === 'failed' ? newest : undefined);
}
