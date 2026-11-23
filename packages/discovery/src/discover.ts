import { metadataDiagnostics } from '@/discovery/analysis/package-metadata.ts';
import { discoveryRegistry } from '@/discovery/managers/builtins.ts';
import type { ManagerName } from '@/domain/catalog.ts';
import type { Inventory, Snapshot } from '@/domain/inventory.ts';

export function discover(snapshot: Snapshot, enabled: ManagerName[] = discoveryRegistry.names()): Inventory {
	const inventory = discoveryRegistry.discover(snapshot, enabled);
	inventory.diagnostics.push(...metadataDiagnostics(snapshot, inventory.packages));
	return inventory;
}
