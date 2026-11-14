import { Schema } from 'effect';
import type { RepositoryRecord } from '@/automation/types';
import type { Diagnostic } from '@/contract/diagnostics';
import type { Access } from '@/domain/repository';
import { decodeRepositoryV1 } from '@/persistence/codecs/v1';
import type { Decoded } from '@/schema';
import { decodeSync, mutableStruct } from '@/schema';

export const repositoryColumns = 'id, name, document, access, suspended_at';
export const enrollmentColumns = 'id, name, access, suspended_at';

const legacySuspension = 'App access removed or suspended';
const active: Access = { kind: 'active' };

const accessColumns = Schema.Union([
	mutableStruct({ access: Schema.Literal('active'), suspended_at: Schema.Null }),
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
});
export interface Enrollment {
	id: number;
	name: string;
	access: Access;
}

function accessOf(columns: { access: unknown; suspended_at: unknown }): Access {
	const parsed = decodeSync(accessColumns, { access: columns.access, suspended_at: columns.suspended_at });
	return parsed.access === 'suspended' ? { kind: 'suspended', since: parsed.suspended_at } : active;
}

function current(diagnostic: Diagnostic): boolean {
	return diagnostic.message !== legacySuspension;
}

export function decodeRepository(row: RepositoryRow): RepositoryRecord {
	const stored = decodeRepositoryV1(JSON.parse(row.document));
	return { ...stored, access: accessOf(row), diagnostics: stored.diagnostics.filter(current) };
}

export function decodeEnrollment(row: Decoded<typeof enrollmentRow>): Enrollment {
	return { id: row.id, name: row.name, access: accessOf(row) };
}

export function encodeAccess(access: Access): [string, number | null] {
	return access.kind === 'suspended' ? ['suspended', access.since] : ['active', null];
}
