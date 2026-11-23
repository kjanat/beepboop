import { Effect } from 'effect';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import { buildSnapshot } from '@/discovery/snapshot/builder.ts';
import type { Snapshot } from '@/domain/inventory.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export function repositorySnapshot(
	gateway: RepositoryGateway,
	name: string,
	id: number,
	revision?: string,
	extraPaths: string[] = [],
): Effect.Effect<Snapshot, DomainError> {
	return gateway.snapshotSource(name, id, revision).pipe(Effect.flatMap(source => buildSnapshot(source, extraPaths)));
}
