import { Result } from 'effect';
import { InvalidPackageUrl, type PackageIdentity, parsePackageIdentity } from '@/package-url';

/** Repair qualifier-key casing explicitly; strict parsing never silently accepts invalid keys. */
export function normalizePackage(input: PackageIdentity | string): Result.Result<PackageIdentity, InvalidPackageUrl> {
	if (typeof input === 'string') {
		const fragment = input.indexOf('#');
		const end = fragment < 0 ? input.length : fragment;
		const question = input.indexOf('?');
		if (question < 0 || question > end) return parsePackageIdentity(input);
		const query = input.slice(question + 1, end).split('&').map(pair => {
			const equal = pair.indexOf('=');
			return equal < 0 ? pair.toLowerCase() : pair.slice(0, equal).toLowerCase() + pair.slice(equal);
		}).join('&');
		return parsePackageIdentity(input.slice(0, question + 1) + query + input.slice(end));
	}
	const qualifiers: Record<string, string> = Object.create(null);
	for (const [key, value] of Object.entries(input.qualifiers ?? {})) {
		const normalized = key.toLowerCase();
		if (Object.hasOwn(qualifiers, normalized)) {
			return Result.fail(new InvalidPackageUrl({ message: `Duplicate qualifier key: ${normalized}` }));
		}
		qualifiers[normalized] = value;
	}
	return parsePackageIdentity({ ...input, qualifiers });
}
