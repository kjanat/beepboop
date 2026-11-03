import { packageId as canonicalPackageUrl } from '@/automation/package-identity';
import { packageLabel } from '@/ui/package-label';

export function packageUrl(pkg: Parameters<typeof canonicalPackageUrl>[0]): string {
	return packageLabel(canonicalPackageUrl(pkg));
}
