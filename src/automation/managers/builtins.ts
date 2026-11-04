import { cargoManager } from '@/automation/managers/cargo';
import { goManager } from '@/automation/managers/go';
import { goreleaserManager } from '@/automation/managers/goreleaser';
import { jsrManager } from '@/automation/managers/jsr';
import { npmManager } from '@/automation/managers/npm';
import { type Adapter, emptyInventory, ManagerRegistry } from '@/automation/managers/registry';
import { vscodeManager } from '@/automation/managers/vscode';
import { workflowManager } from '@/automation/managers/workflow';
import { verifyImage } from '@/automation/oci';
import { discoverHooks } from '@/automation/precommit';
import type { Inventory, Snapshot } from '@/automation/types';
import type { ManagerName } from '@/contract/catalog';

function workflowDetected<M extends ManagerName>(name: M): (snapshot: Snapshot) => Inventory {
	return snapshot => {
		const result = emptyInventory();
		if (workflowManager.discover(snapshot).managers.includes(name)) result.managers.push(name);
		return result;
	};
}

const adapters = {
	cargo: cargoManager,
	npm: npmManager,
	vscode: vscodeManager,
	jsr: jsrManager,
	workflow: workflowManager,
	'github-release': { name: 'github-release', discover: workflowDetected('github-release') },
	oci: { name: 'oci', verifyPublication: verifyImage, discover: workflowDetected('oci') },
	goreleaser: goreleaserManager,
	go: goManager,
	manifest: {
		name: 'manifest',
		discover(snapshot) {
			const result = emptyInventory();
			if (
				Object.keys(snapshot.files).some(path => /(?:^|\/)(?:Casks|Formula|bucket)\/[^/]+\.(?:rb|json)$/.test(path))
			) {
				result.managers.push('manifest');
			}
			return result;
		},
	},
	'pre-commit': {
		name: 'pre-commit',
		discover(snapshot) {
			const result = emptyInventory();
			try {
				result.references = discoverHooks(snapshot);
				if (result.references.length) result.managers.push('pre-commit');
			} catch (error) {
				result.diagnostics.push(error instanceof Error ? error.message : 'Invalid hook configuration');
			}
			return result;
		},
	},
} satisfies { [M in ManagerName]: Adapter<M> };

export const managerRegistry = new ManagerRegistry(Object.values(adapters));
