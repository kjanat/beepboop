import { Effect } from 'effect';
import { type DomainError, precondition } from '@/contract/errors';
import { fromSync } from '@/failure';
import { compareVersions, record, semver, text } from '@/model';

export type VersionRequest =
	| { version: string }
	| { bump: 'patch' | 'minor' | 'major' }
	| { bump: 'prerelease'; base: 'patch' | 'minor' | 'major'; identifier: string }
	| { bump: 'next' | 'stable' };

function release(value: unknown): Effect.Effect<string, DomainError> {
	return fromSync(() => semver(value).replace(/^v/, ''));
}

export function parseVersionRequest(value: unknown): Effect.Effect<VersionRequest, DomainError> {
	return Effect.gen(function*() {
		if (typeof value === 'string') return { version: yield* release(value) };
		const input = yield* fromSync(() => record(value));
		const allowed = input.version !== undefined
			? ['version']
			: input.bump === 'prerelease'
			? ['bump', 'base', 'identifier']
			: ['bump'];
		if (Object.keys(input).some(key => !allowed.includes(key))) return yield* precondition('Ambiguous version request');
		if (input.version !== undefined) return { version: yield* release(input.version) };
		const bump = (['patch', 'minor', 'major', 'next', 'stable'] as const).find(kind => kind === input.bump);
		if (bump) return { bump };
		const base = (['patch', 'minor', 'major'] as const).find(kind => kind === input.base);
		if (input.bump === 'prerelease' && base) {
			const identifier = yield* fromSync(() => text(input.identifier));
			if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(identifier)) return yield* precondition('Invalid prerelease identifier');
			return { bump: 'prerelease', base, identifier };
		}
		return yield* precondition('Invalid version request');
	});
}
export function nextVersion(current: string, request: VersionRequest): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const normalized = (yield* release(current)).split('+')[0] ?? '';
		const split = normalized.indexOf('-');
		const core = split < 0 ? normalized : normalized.slice(0, split);
		const pre = split < 0 ? undefined : normalized.slice(split + 1);
		let target: string;
		if ('version' in request) target = yield* release(request.version);
		else if (request.bump === 'stable') {
			if (!pre) return yield* precondition('Stable promotion requires a prerelease');
			target = core;
		} else if (request.bump === 'next') {
			if (!pre || !/\.\d+$/.test(pre)) return yield* precondition('Prerelease increment requires a numeric counter');
			target = `${core}-${pre.replace(/\d+$/, counter => String(BigInt(counter) + 1n))}`;
		} else {
			if (pre) return yield* precondition('Choose next, stable, or an explicit version for a prerelease');
			const values = core.split('.').map(BigInt);
			const kind = request.bump === 'prerelease' ? request.base : request.bump;
			const index = kind === 'major' ? 0 : kind === 'minor' ? 1 : 2;
			const value = values[index];
			if (value === undefined) return yield* precondition('Invalid version');
			values[index] = value + 1n;
			for (let i = index + 1; i < 3; i++) values[i] = 0n;
			target = values.join('.') + (request.bump === 'prerelease' ? `-${request.identifier}.1` : '');
		}
		if (compareVersions(target, normalized) <= 0) return yield* precondition('Target version must be newer');
		return target;
	});
}
