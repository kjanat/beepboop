import { PackageURL } from 'packageurl-js';
import type { ManagerName, Package } from '@/automation/types';

/** Identify packages independently of where their manifests live in a checkout. */
export function packageUrl(pkg: Pick<Package, 'manager' | 'name' | 'version'>): string {
	const types: Partial<Record<ManagerName, string>> = { npm: 'npm', cargo: 'cargo', go: 'golang' };
	const type = types[pkg.manager];
	if (!type) return new PackageURL('generic', pkg.manager, pkg.name, pkg.version).toString();
	const slash = pkg.name.lastIndexOf('/');
	const namespace = slash < 0 ? undefined : pkg.name.slice(0, slash);
	const name = slash < 0 ? pkg.name : pkg.name.slice(slash + 1);
	return new PackageURL(type, namespace, name, pkg.version).toString();
}
