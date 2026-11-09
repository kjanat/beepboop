import { Result } from 'effect';
import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Package } from '@/automation/types';
import { dependencyOrder } from '@/dependency-order';

export type PublicationOrder = { kind: 'ordered'; order: string[] } | { kind: 'cycle'; message: string };

export function publicationOrder(packages: Package[]): PublicationOrder {
	const byName = new Map(packages.map((p) => [packageId(p), p]));
	const ordered = dependencyOrder(
		[...byName.keys()].sort(),
		(key): Result.Result<string[] | undefined> => {
			const pkg = byName.get(key);
			return Result.succeed(
				pkg && [...pkg.dependencies].sort().flatMap(name => {
					const dependency = packages.find(candidate => candidate.manager === pkg.manager && candidate.name === name);
					return dependency ? [packageId(dependency)] : [];
				}),
			);
		},
		key => Result.fail(key),
	);
	if (Result.isFailure(ordered)) {
		return { kind: 'cycle', message: `Publication dependency cycle at ${ordered.failure}` };
	}
	return {
		kind: 'ordered',
		order: ordered.success.filter(key => {
			const pkg = byName.get(key);
			return pkg !== undefined && publishable(pkg);
		}),
	};
}
