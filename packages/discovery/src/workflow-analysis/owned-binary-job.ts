import { object } from '@/discovery/managers/manifest-editing.ts';

export const beginJobId = 'begin';
export const begunSource = `\${{ needs.${beginJobId}.outputs.sourceSha }}`;

export function ownedBinaryJob(name: string, job: Record<string, unknown>): boolean {
	const steps = Array.isArray(job.steps) ? job.steps.map(object) : [];
	return (name === beginJobId || name.startsWith('build-'))
		&& steps.some(step =>
			(typeof step.uses === 'string' && /\/actions\/begin\b/.test(step.uses))
			|| (name !== beginJobId && object(step.with).ref === begunSource)
		);
}
