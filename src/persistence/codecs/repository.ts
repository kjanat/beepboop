import { z } from 'zod';
import type { RepositoryRecord } from '@/automation/types';
import type { Diagnostic } from '@/contract/diagnostics';
import type { Access } from '@/domain/repository';
import { decodeRepositoryV1 } from '@/persistence/codecs/v1';

export const repositoryColumns = 'id, name, document, access, suspended_at';
export const enrollmentColumns =
	"id, name, access, suspended_at, updated_at, CASE WHEN json_valid(document) THEN COALESCE(json_extract(document, '$.suspended'), 0) ELSE 0 END AS legacy_suspended";

const legacySuspension = 'App access removed or suspended';
const active: Access = { kind: 'active' };

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

export const enrollmentRow = z.object({
	id: z.number(),
	name: z.string(),
	access: z.unknown(),
	suspended_at: z.unknown(),
	updated_at: z.number(),
	legacy_suspended: z.number(),
});
export interface Enrollment {
	id: number;
	name: string;
	access: Access;
}

function accessOf(columns: { access: unknown; suspended_at: unknown }, document: Access): Access {
	const parsed = accessColumns.parse({ access: columns.access, suspended_at: columns.suspended_at });
	return parsed.access === 'suspended' ? { kind: 'suspended', since: parsed.suspended_at } : document;
}

function current(diagnostic: Diagnostic): boolean {
	return diagnostic.message !== legacySuspension;
}

export function decodeRepository(row: RepositoryRow): RepositoryRecord {
	const stored = decodeRepositoryV1(JSON.parse(row.document));
	return { ...stored, access: accessOf(row, stored.access), diagnostics: stored.diagnostics.filter(current) };
}

export function decodeEnrollment(row: z.output<typeof enrollmentRow>): Enrollment {
	const document: Access = row.legacy_suspended === 1 ? { kind: 'suspended', since: row.updated_at } : active;
	return { id: row.id, name: row.name, access: accessOf(row, document) };
}

export function encodeAccess(access: Access): [string, number | null] {
	return access.kind === 'suspended' ? ['suspended', access.since] : ['active', null];
}
