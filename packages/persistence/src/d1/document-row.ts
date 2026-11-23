import { Schema } from 'effect';
import { decodeSync, mutableStruct } from '@/kernel/schema/structs.ts';

export const documentRow = mutableStruct({ document: Schema.String });
export function rowDocument(row: unknown): unknown {
	return JSON.parse(decodeSync(documentRow, row).document);
}
