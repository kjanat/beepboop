import { Result } from 'effect';
import { cargoDiscoverer } from '@/discovery/managers/cargo.ts';
import { goDiscoverer } from '@/discovery/managers/go.ts';
import { goreleaserDiscoverer } from '@/discovery/managers/goreleaser.ts';
import { jsrDiscoverer } from '@/discovery/managers/jsr.ts';
import { npmDiscoverer } from '@/discovery/managers/npm.ts';
import { discoverHooks } from '@/discovery/managers/precommit.ts';
import { pypiDiscoverer } from '@/discovery/managers/pypi.ts';
import type { DiscovererOf } from '@/discovery/managers/registry.ts';
import { DiscoveryRegistry, emptyInventory } from '@/discovery/managers/registry.ts';
import { vscodeDiscoverer } from '@/discovery/managers/vscode.ts';
import { workflowDiscoverer } from '@/discovery/managers/workflow.ts';
import type { ManagerName } from '@/domain/catalog.ts';
import { managerSpec } from '@/domain/catalog.ts';
import type { Inventory, Snapshot } from '@/domain/inventory.ts';

function workflowDetected<M extends ManagerName>(name: M): (snapshot: Snapshot) => Inventory {
	return snapshot => {
		const result = emptyInventory();
		if (workflowDiscoverer.discover(snapshot).managers.includes(name)) result.managers.push(name);
		return result;
	};
}

export const discoverers = {
	cargo: cargoDiscoverer,
	npm: npmDiscoverer,
	vscode: vscodeDiscoverer,
	jsr: jsrDiscoverer,
	pypi: pypiDiscoverer,
	workflow: workflowDiscoverer,
	'github-release': { name: 'github-release', discover: workflowDetected('github-release') },
	oci: { name: 'oci', discover: workflowDetected('oci') },
	goreleaser: goreleaserDiscoverer,
	go: goDiscoverer,
	manifest: {
		name: 'manifest',
		discover(snapshot) {
			const result = emptyInventory();
			const { markers } = managerSpec('manifest');
			if (Object.keys(snapshot.files).some(path => markers.some(marker => marker.test(path)))) {
				result.managers.push('manifest');
			}
			return result;
		},
	},
	'pre-commit': {
		name: 'pre-commit',
		discover(snapshot) {
			const result = emptyInventory();
			const hooks = discoverHooks(snapshot);
			if (Result.isSuccess(hooks)) {
				result.references = hooks.success;
				if (result.references.length) result.managers.push('pre-commit');
			} else {
				result.diagnostics.push({ code: 'invalid-manifest', severity: 'blocking', message: hooks.failure.message });
			}
			return result;
		},
	},
} satisfies { [M in ManagerName]: DiscovererOf<M> };

export const discoveryRegistry = new DiscoveryRegistry(discoverers);
