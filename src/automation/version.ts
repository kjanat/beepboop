import { compareVersions, record, semver, text } from '#model';

export type VersionRequest =
	| { version: string }
	| { bump: 'patch' | 'minor' | 'major' }
	| { bump: 'prerelease'; base: 'patch' | 'minor' | 'major'; identifier: string }
	| { bump: 'next' | 'stable' };

export function parseVersionRequest(value: unknown): VersionRequest {
	if (typeof value === 'string') return { version: semver(value).replace(/^v/, '') };
	const input = record(value);
	const allowed = input.version !== undefined
		? ['version']
		: input.bump === 'prerelease'
		? ['bump', 'base', 'identifier']
		: ['bump'];
	if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Ambiguous version request');
	if (input.version !== undefined) return { version: semver(input.version).replace(/^v/, '') };
	if (['patch', 'minor', 'major', 'next', 'stable'].includes(String(input.bump))) {
		return { bump: input.bump as 'patch' | 'minor' | 'major' | 'next' | 'stable' };
	}
	if (input.bump === 'prerelease' && ['patch', 'minor', 'major'].includes(String(input.base))) {
		const identifier = text(input.identifier);
		if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(identifier)) throw new Error('Invalid prerelease identifier');
		return { bump: 'prerelease', base: input.base as 'patch' | 'minor' | 'major', identifier };
	}
	throw new Error('Invalid version request');
}
export function nextVersion(current: string, request: VersionRequest): string {
	const normalized = semver(current).replace(/^v/, '').split('+')[0] as string;
	const split = normalized.indexOf('-');
	const core = split < 0 ? normalized : normalized.slice(0, split);
	const pre = split < 0 ? undefined : normalized.slice(split + 1);
	let target: string;
	if ('version' in request) target = semver(request.version).replace(/^v/, '');
	else if (request.bump === 'stable') {
		if (!pre) throw new Error('Stable promotion requires a prerelease');
		target = core;
	} else if (request.bump === 'next') {
		if (!pre || !/\.\d+$/.test(pre)) throw new Error('Prerelease increment requires a numeric counter');
		target = `${core}-${pre.replace(/\d+$/, counter => String(BigInt(counter) + 1n))}`;
	} else {
		if (pre) throw new Error('Choose next, stable, or an explicit version for a prerelease');
		const values = core.split('.').map(BigInt);
		const kind = request.bump === 'prerelease' ? request.base : request.bump;
		const index = kind === 'major' ? 0 : kind === 'minor' ? 1 : 2;
		values[index] = (values[index] as bigint) + 1n;
		for (let i = index + 1; i < 3; i++) values[i] = 0n;
		target = values.join('.') + (request.bump === 'prerelease' ? `-${request.identifier}.1` : '');
	}
	if (compareVersions(target, normalized) <= 0) throw new Error('Target version must be newer');
	return target;
}
