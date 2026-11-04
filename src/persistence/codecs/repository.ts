import { z } from 'zod';
import type { RepositoryRecord } from '@/automation/types';
import type { Access } from '@/domain/repository';
import { decodeRepositoryV1 } from '@/persistence/codecs/v1';

export const repositoryColumns = 'id, name, document, access, suspended_at';

const accessColumns = z.discriminatedUnion('access', [
	z.object({ access: z.literal('active') }),
	z.object({ access: z.literal('suspended'), suspended_at: z.number() }),
]);

export const repositoryRow = z.object({
	id: z.number(),
	name: z.string(),
	document: z.string(),
	access: z.unknown(),
	suspended_at: z.unknown(),
});
export type RepositoryRow = z.output<typeof repositoryRow>;

function accessOf(row: RepositoryRow): Access {
	const columns = accessColumns.parse({ access: row.access, suspended_at: row.suspended_at });
	return columns.access === 'suspended' ? { kind: 'suspended', since: columns.suspended_at } : { kind: 'active' };
}

export function decodeRepository(row: RepositoryRow): RepositoryRecord {
	return { ...decodeRepositoryV1(JSON.parse(row.document)), access: accessOf(row) };
}

export function encodeAccess(access: Access): [string, number | null] {
	return access.kind === 'suspended' ? ['suspended', access.since] : ['active', null];
}
