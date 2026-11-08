import { Result } from 'effect';
import { cargoManager } from '@/automation/managers/cargo';
import { goManager } from '@/automation/managers/go';
import { goreleaserManager } from '@/automation/managers/goreleaser';
import { jsrManager } from '@/automation/managers/jsr';
import { npmManager } from '@/automation/managers/npm';
import { pypiManager } from '@/automation/managers/pypi';
import { type Adapter, emptyInventory, ManagerRegistry } from '@/automation/managers/registry';
import { vscodeManager } from '@/automation/managers/vscode';
import { workflowManager } from '@/automation/managers/workflow';
import { verifyImage } from '@/automation/oci';
import { discoverHooks } from '@/automation/precommit';
import type { Inventory, Snapshot } from '@/automation/types';
import { type ManagerName, managerSpec } from '@/contract/catalog';

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
	pypi: pypiManager,
	workflow: workflowManager,
	'github-release': { name: 'github-release', discover: workflowDetected('github-release') },
	oci: { name: 'oci', verifyPublication: verifyImage, discover: workflowDetected('oci') },
	goreleaser: goreleaserManager,
	go: goManager,
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
} satisfies { [M in ManagerName]: Adapter<M> };

export const managerRegistry = new ManagerRegistry(adapters);
