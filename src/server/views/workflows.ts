import type { RepositoryRecord } from '@/automation/types.ts';
import { readiness } from '@/domain/repository';

export function workflowChoices(stored: RepositoryRecord) {
	const state = readiness(stored);
	if (state.kind !== 'ready') return [];
	const repository = state.repository;
	return Object.entries(repository.configuration.streams).flatMap(([stream, configuration]) => {
		const bindings = {
			...configuration.workflows,
			...(configuration.prepare.workflow ? { prepare: configuration.prepare.workflow } : {}),
			...(configuration.promote.workflow ? { promote: configuration.promote.workflow } : {}),
		};
		return Object.entries(bindings).map(([operation, workflow]) => ({
			stream,
			operation,
			file: workflow.file,
			ref: workflow.ref ?? repository.defaultBranch,
			credentials: configuration.credentials,
			mode: workflow.mode ?? 'dispatch',
		}));
	});
}
