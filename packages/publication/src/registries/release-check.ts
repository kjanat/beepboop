import { Schema } from 'effect';
import { looseSchema } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';

export const npmVersion = mutableStruct({
	dist: Schema.optional(Schema.NullOr(mutableStruct({ integrity: looseSchema }))),
});
export const jsrPackage = mutableStruct({
	versions: Schema.optional(Schema.NullOr(mutableRecord(Schema.String, Schema.Unknown))),
});
export const jsrVersion = mutableStruct({ yanked: looseSchema });
export const jsrFiles = mutableStruct({
	manifest: mutableRecord(Schema.String, mutableStruct({ checksum: Schema.String })),
});

export type NpmBuild =
	| { readonly kind: 'matches'; readonly integrity: string }
	| { readonly kind: 'differs'; readonly published: string }
	| { readonly kind: 'unreadable' };

export function npmBuild(published: Decoded<typeof npmVersion>, integrity: string): NpmBuild {
	const found = published.dist?.integrity;
	if (typeof found !== 'string') return { kind: 'unreadable' };
	return found === integrity ? { kind: 'matches', integrity } : { kind: 'differs', published: found };
}

export function jsrFilePaths(remote: Decoded<typeof jsrFiles>['manifest'], include: readonly string[]): string[] {
	return [...new Set([...Object.keys(remote), ...include.map(path => `/${path}`)])].sort();
}

export function jsrChangedFiles(
	remote: Decoded<typeof jsrFiles>['manifest'],
	local: ReadonlyMap<string, string | undefined>,
): string[] {
	return [...local].flatMap(([path, checksum]) => remote[path]?.checksum === checksum ? [] : [path]);
}
