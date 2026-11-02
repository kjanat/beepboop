import { verifyImage } from '../oci.ts';
import { discoverHooks } from '../precommit.ts';
import { cargoManager } from './cargo.ts';
import { goManager } from './go.ts';
import { goreleaserManager } from './goreleaser.ts';
import { npmManager } from './npm.ts';
import { emptyInventory, ManagerRegistry } from './registry.ts';
import { workflowManager } from './workflow.ts';

export const managerRegistry = new ManagerRegistry([
	cargoManager,
	npmManager,
	workflowManager,
	...(['github-release', 'oci'] as const).map(name => ({
		name,
		...(name === 'oci' ? { verifyPublication: verifyImage } : {}),
		discover: (snapshot: import('../types.ts').Snapshot) => {
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
