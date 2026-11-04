import type { Configuration, RepositoryRecord } from '@/automation/types';
import { blocking, type Diagnostic } from '@/contract/diagnostics';
import { DomainError, precondition } from '@/contract/errors';

export type Access = { kind: 'active' } | { kind: 'suspended'; since: number };

declare const ready: unique symbol;
export type ReadyRepository = RepositoryRecord & {
	access: { kind: 'active' };
	configuration: Configuration;
	readonly [ready]: true;
};

export type Readiness =
	| { kind: 'ready'; repository: ReadyRepository }
	| { kind: 'suspended'; since: number }
	| { kind: 'unconfigured' }
	| { kind: 'invalid'; diagnostics: Diagnostic[] };

function isReady(repository: RepositoryRecord): repository is ReadyRepository {
	return repository.access.kind === 'active' && repository.configuration !== undefined
		&& !blocking(repository.diagnostics).length;
}

export function readiness(repository: RepositoryRecord): Readiness {
	if (repository.access.kind === 'suspended') return { kind: 'suspended', since: repository.access.since };
	if (isReady(repository)) return { kind: 'ready', repository };
	const problems = blocking(repository.diagnostics);
	if (!repository.configuration && problems.every(problem => problem.code === 'unconfigured')) {
		return { kind: 'unconfigured' };
	}
	return { kind: 'invalid', diagnostics: problems };
}

export function requireReady(repository: RepositoryRecord): ReadyRepository {
	const state = readiness(repository);
	switch (state.kind) {
		case 'ready':
			return state.repository;
		case 'suspended':
			throw precondition(`GitHub App access to ${repository.name} is suspended or removed`);
		case 'unconfigured':
			throw precondition('Repository not configured');
		case 'invalid':
			throw new DomainError({ code: 'precondition', diagnostics: state.diagnostics });
	}
}
