import { Effect } from 'effect';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';

export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseChecksums(source: string): Effect.Effect<Map<string, string>, DomainError> {
	return Effect.gen(function*() {
		const result = new Map<string, string>();
		for (const [index, line] of source.split(/\r?\n/).entries()) {
			if (!line) continue;
			const match = /^([a-fA-F0-9]{64}) [ *](\S+)$/.exec(line);
			if (!match?.[1] || !match[2]) return yield* precondition(`Malformed checksum line ${index + 1}`);
			if (result.has(match[2])) return yield* precondition(`Duplicate checksum for ${match[2]}`);
			result.set(match[2], match[1].toLowerCase());
		}
		return result;
	});
}

export function expand(value: string, variables: Record<string, string>): Effect.Effect<string, DomainError> {
	const unknown = [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1] ?? '').find(key =>
		!Object.hasOwn(variables, key)
	);
	return unknown === undefined
		? Effect.succeed(value.replace(/\{([^{}]+)\}/g, (_match, key: string) => variables[key] ?? ''))
		: Effect.fail(precondition(`Unknown template variable ${unknown}`));
}

export function https(value: string): Effect.Effect<string, DomainError> {
	return Effect.sync(() => URL.parse(value)).pipe(
		Effect.filterOrFail(
			url => url !== null && url.protocol === 'https:' && !url.username && !url.password && !url.hash,
			() => precondition('Expected an HTTPS release URL'),
		),
		Effect.as(value),
	);
}

export function releaseTag(version: string, tag: string | undefined): Effect.Effect<string, DomainError> {
	const resolved = tag ?? `v${version}`;
	if (!stableVersion.test(version)) return Effect.fail(precondition('Expected stable MAJOR.MINOR.PATCH version'));
	if (!resolved || [...resolved].some(character => character <= ' ' || character === '?' || character === '#')) {
		return Effect.fail(precondition('Invalid release tag'));
	}
	return Effect.succeed(resolved);
}

export function assetName(template: string, variables: Record<string, string>): Effect.Effect<string, DomainError> {
	return expand(template, variables).pipe(
		Effect.filterOrFail(
			asset => Boolean(asset) && !/[\\/]/.test(asset) && asset !== '.' && asset !== '..',
			() => precondition('Expected an asset filename'),
		),
	);
}

export function checksumOf(checksums: ReadonlyMap<string, string>, asset: string): Effect.Effect<string, DomainError> {
	const digest = checksums.get(asset);
	return digest ? Effect.succeed(digest) : Effect.fail(precondition(`Checksum missing for ${asset}`));
}
