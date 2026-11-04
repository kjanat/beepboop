import { packageId } from '@/automation/package-identity';
import { packageLabel } from '@/ui/package-label';

export function packageDisplayName(pkg: Parameters<typeof packageId>[0]): string {
	return packageLabel(packageId(pkg));
}
