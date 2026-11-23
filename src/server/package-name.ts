import { packageId } from '@/domain/package-identity.ts';
import { packageLabel } from '@/domain/package-label';

export function packageDisplayName(pkg: Parameters<typeof packageId>[0]): string {
	return packageLabel(packageId(pkg));
}
