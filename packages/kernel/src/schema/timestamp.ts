import { Schema } from 'effect';

export const timestamp = Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value))));

export function expiresAfter(expiresAt: string, now: number): boolean {
	return Date.parse(expiresAt) > now;
}
