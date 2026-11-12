import { Schema } from 'effect';
import type { SetupOption } from '@/automation/setup-types';
import { decodeSync, mutableArray, mutableStruct } from '@/schema';

export const documentRow = mutableStruct({ document: Schema.String });
export function rowDocument(row: unknown): unknown {
	return JSON.parse(decodeSync(documentRow, row).document);
}

export const setupOptionsSchema: Schema.Codec<SetupOption[], unknown> = mutableArray(Schema.Union([
	mutableStruct({ kind: Schema.Literals(['package', 'required']), stream: Schema.String, package: Schema.String }),
	mutableStruct({
		kind: Schema.Literal('workflow'),
		stream: Schema.String,
		operation: Schema.Literals(['prepare', 'promote']),
		file: Schema.String,
		job: Schema.optional(Schema.String),
	}),
	mutableStruct({
		kind: Schema.Literal('versioning'),
		stream: Schema.String,
		value: Schema.Literals(['workspace', 'independent', 'none']),
	}),
	mutableStruct({
		kind: Schema.Literal('triggers'),
		stream: Schema.String,
		operation: Schema.Literals(['prepare', 'promote']),
		value: Schema.Literals(['review', 'dispatchOnly', 'preserve']),
	}),
]));
