import { Schema } from 'effect';
import type { RepositoryRecord } from '@/automation/types';
import type { Diagnostic } from '@/contract/diagnostics';
import type { Access } from '@/domain/repository';
import { decodeRepositoryV1 } from '@/persistence/codecs/v1';
import type { Decoded } from '@/schema';
import { decodeSync, mutableStruct } from '@/schema';

export const repositoryColumns = 'id, name, document, access, suspended_at';
export const enrollmentColumns =
	"id, name, access, suspended_at, updated_at, CASE WHEN json_valid(document) THEN COALESCE(json_extract(document, '$.suspended'), 0) ELSE 0 END AS legacy_suspended";

const legacySuspension = 'App access removed or suspended';
const active: Access = { kind: 'active' };

const accessColumns = Schema.Union([
	mutableStruct({ access: Schema.Literal('active') }),
	mutableStruct({ access: Schema.Literal('suspended'), suspended_at: Schema.Finite }),
]);

export const repositoryRow = mutableStruct({
	id: Schema.Finite,
	name: Schema.String,
	document: Schema.String,
	access: Schema.Unknown,
	suspended_at: Schema.Unknown,
});
export type RepositoryRow = Decoded<typeof repositoryRow>;

export const enrollmentRow = mutableStruct({
	id: Schema.Finite,
	name: Schema.String,
	access: Schema.Unknown,
	suspended_at: Schema.Unknown,
	updated_at: Schema.Finite,
	legacy_suspended: Schema.Finite,
});
export interface Enrollment {
	id: number;
	name: string;
	access: Access;
}

function accessOf(columns: { access: unknown; suspended_at: unknown }, document: Access): Access {
	const parsed = decodeSync(accessColumns, { access: columns.access, suspended_at: columns.suspended_at });
	return parsed.access === 'suspended' ? { kind: 'suspended', since: parsed.suspended_at } : document;
}

function current(diagnostic: Diagnostic): boolean {
	return diagnostic.message !== legacySuspension;
}

export function decodeRepository(row: RepositoryRow): RepositoryRecord {
	const stored = decodeRepositoryV1(JSON.parse(row.document));
	return { ...stored, access: accessOf(row, stored.access), diagnostics: stored.diagnostics.filter(current) };
}

export function decodeEnrollment(row: Decoded<typeof enrollmentRow>): Enrollment {
	const document: Access = row.legacy_suspended === 1 ? { kind: 'suspended', since: row.updated_at } : active;
	return { id: row.id, name: row.name, access: accessOf(row, document) };
}

export function encodeAccess(access: Access): [string, number | null] {
	return access.kind === 'suspended' ? ['suspended', access.since] : ['active', null];
}
