import { cargoManager } from '@/automation/managers/cargo';
import { goManager } from '@/automation/managers/go';
import { goreleaserManager } from '@/automation/managers/goreleaser';
import { jsrManager } from '@/automation/managers/jsr';
import { npmManager } from '@/automation/managers/npm';
import { emptyInventory, ManagerRegistry } from '@/automation/managers/registry';
import { workflowManager } from '@/automation/managers/workflow';
import { verifyImage } from '@/automation/oci';
import { discoverHooks } from '@/automation/precommit';

export const managerRegistry = new ManagerRegistry([
	cargoManager,
	npmManager,
	jsrManager,
	workflowManager,
	...(['github-release', 'oci'] as const).map(name => ({
		name,
		...(name === 'oci' ? { verifyPublication: verifyImage } : {}),
		discover: (snapshot: import('@/automation/types').Snapshot) => {
			const result = emptyInventory();
			if (workflowManager.discover(snapshot).managers.includes(name)) result.managers.push(name);
			return result;
		},
	})),
	goreleaserManager,
	goManager,
	{
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
	{
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
]);
