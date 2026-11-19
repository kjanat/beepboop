import { Schema } from 'effect';
import { DomainError } from '@/contract/errors';

export type Readable<T> = { kind: 'readable'; value: T };

export function readEach<R, T, U>(
	rows: R[],
	decode: (row: R) => T,
	unreadable: (row: R, error: string) => U,
): (Readable<T> | U)[] {
	return rows.map((row): Readable<T> | U => {
		try {
			return { kind: 'readable', value: decode(row) };
		} catch (error) {
			if (!isDecodingFailure(error)) throw error;
			return unreadable(row, decodeError(error));
		}
	});
}
export function isDecodingFailure(error: unknown): boolean {
	return error instanceof Schema.SchemaError || error instanceof SyntaxError
		|| (error instanceof DomainError && (error.problem.code === 'invalid' || error.problem.code === 'precondition'));
}
export function decodeError(error: unknown): string {
	if (error instanceof DomainError) return error.detail ?? error.message;
	if (error instanceof Schema.SchemaError) return error.message;
	return error instanceof Error ? error.message : 'Unreadable document';
}
