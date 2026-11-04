import type { RepositoryRecord } from '@/automation/types.ts';

export function workflowChoices(repository: RepositoryRecord) {
	if (!repository.configuration || repository.suspended || repository.diagnostics.length) return [];
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
