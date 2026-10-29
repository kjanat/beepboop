import { object, yaml } from './helpers.ts';
import type { Manager } from './registry.ts';
import { emptyInventory } from './registry.ts';
export const workflowManager: Manager = {
	name: 'workflow',
	discover(snapshot) {
		const inventory = emptyInventory();
		const detected = new Set<import('../types.ts').ManagerName>();
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			try {
				if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) {
					const workflow = yaml(source),
						trigger = workflow.on;
					const events = typeof trigger === 'string'
						? [trigger]
						: Array.isArray(trigger)
						? trigger.map(String)
						: Object.keys(object(trigger));
					const jobs = object(workflow.jobs);
					const localActions = [
						...source.matchAll(/uses:\s*["']?((?:\.\/|\$\/)\.github\/[^\s"']+)/g),
					].map((m) => m[1] as string);
					inventory.workflows.push({
						tagTriggered: events.includes('release') || Array.isArray(object(object(trigger).push).tags),
						file: path.slice('.github/workflows/'.length),
						name: String(workflow.name ?? path),
						events,
						jobs: Object.keys(jobs),
						localActions,
						dispatchInputs: Object.keys(object(object(object(trigger).workflow_dispatch).inputs)),
						publication: /\b(?:publish|release|deploy|promotion|promote)\b/i.test(
							String(workflow.name ?? path),
						),
					});
					detected.add('workflow');
					if (events.includes('release') || /gh release|releases\/|release-action/.test(source)) {
						detected.add('github-release');
					}
					if (/docker\/(?:build-push|metadata)-action|skopeo copy/.test(source)) detected.add('oci');
				}
			} catch {
				inventory.diagnostics.push(`${path}: cannot safely discover configuration`);
			}
		}

		inventory.managers = [...detected];
		return inventory;
	},
};
