import { z } from 'zod';
import type { SetupOption } from '@/automation/setup-types';

export const documentRow = z.object({ document: z.string() });
export function rowDocument(row: unknown): unknown {
	return JSON.parse(documentRow.parse(row).document);
}

export const setupOptionsSchema: z.ZodType<SetupOption[]> = z.array(z.union([
	z.object({ kind: z.enum(['package', 'required']), stream: z.string(), package: z.string() }),
	z.object({
		kind: z.literal('workflow'),
		stream: z.string(),
		operation: z.enum(['prepare', 'promote']),
		file: z.string(),
		job: z.string().optional(),
	}),
	z.object({ kind: z.literal('versioning'), stream: z.string(), value: z.enum(['workspace', 'independent', 'none']) }),
	z.object({
		kind: z.literal('triggers'),
		stream: z.string(),
		operation: z.enum(['prepare', 'promote']),
		value: z.enum(['review', 'dispatchOnly', 'preserve']),
	}),
]));
