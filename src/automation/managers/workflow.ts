import { object, yaml } from '@/automation/managers/helpers';
import type { Adapter } from '@/automation/managers/registry';
import { emptyInventory } from '@/automation/managers/registry';
import { workflowEvidence } from '@/automation/setup-workflows';
export const workflowManager: Adapter<'workflow'> = {
	name: 'workflow',
	discover(snapshot) {
		const inventory = emptyInventory();
		const detected = new Set<import('@/contract/catalog').ManagerName>();
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			try {
				if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) {
					const evidence = workflowEvidence(path.slice('.github/workflows/'.length), source);
					const workflow = yaml(source),
						trigger = workflow.on;
					const events = typeof trigger === 'string'
						? [trigger]
						: Array.isArray(trigger)
						? trigger.map(String)
						: Object.keys(object(trigger));
					const jobs = object(workflow.jobs);
					const push = object(object(trigger).push);
					const createsRelease = Object.values(jobs).some(job => {
						const steps = object(job).steps;
						return Array.isArray(steps) && steps.some(step => {
							const { uses, run } = object(step);
							return (typeof uses === 'string'
								&& /^(?:softprops\/action-gh-release|ncipollo\/release-action)@/.test(uses))
								|| (typeof run === 'string' && /\bgh release create\b/.test(run));
						});
					});
					const localActions = [
						...source.matchAll(/uses:\s*["']?((?:\.\/|\$\/)[^\s"']+)/g),
					].flatMap((m) => m[1] ?? []);
					inventory.workflows.push({
						...(Array.isArray(push.tags) ? { tagPatterns: push.tags.map(String) } : {}),
						...(Array.isArray(push.branches) ? { branchPatterns: push.branches.map(String) } : {}),
						...(createsRelease ? { createsRelease } : {}),
						file: path.slice('.github/workflows/'.length),
						name: String(workflow.name ?? path),
						events,
						jobs: Object.keys(jobs),
						localActions,
						dispatchInputs: Object.keys(object(object(object(trigger).workflow_dispatch).inputs)),
						publication: !evidence.prepares
							&& (evidence.publishes || evidence.reports || /\b(?:publish|release|deploy|promotion|promote)\b/i.test(
								String(workflow.name ?? path),
							)),
					});
					detected.add('workflow');
					if (events.includes('release') || createsRelease || /gh release|releases\/|release-action/.test(source)) {
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
