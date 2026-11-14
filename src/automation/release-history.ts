import { matchesPublication } from '@/automation/package-identity';
import type { Execution } from '@/automation/types';

function groupKey(execution: Execution): string {
	return JSON.stringify([
		execution.repositoryId,
		execution.stream,
		execution.version,
		execution.sourceSha,
		execution.configurationSha,
		execution.releaseSet?.preparationId,
		execution.releaseSet?.group,
	]);
}

interface Group {
	members: Map<string, Execution>;
	completed: Map<string, Execution[] | undefined>;
}

export class ReleaseHistory {
	private readonly groups = new Map<string, Group>();
	private readonly identities = new Map<string, string>();
	constructor(executions: readonly Execution[]) {
		for (const execution of executions) this.update(execution);
	}
	update(execution: Execution): void {
		const previous = this.identities.get(execution.id);
		if (previous !== undefined) {
			const group = this.groups.get(previous);
			group?.members.delete(execution.id);
			group?.completed.clear();
			this.identities.delete(execution.id);
		}
		if (execution.state !== 'succeeded' || !execution.version) return;
		const key = groupKey(execution);
		let group = this.groups.get(key);
		if (!group) {
			group = { members: new Map(), completed: new Map() };
			this.groups.set(key, group);
		}
		group.members.set(execution.id, structuredClone(execution));
		group.completed.clear();
		this.identities.set(execution.id, key);
	}
	completed(execution: Execution, required: readonly string[]): Execution[] | undefined {
		if (!required.length) return;
		const group = this.groups.get(groupKey(execution));
		if (!group) return;
		const key = JSON.stringify(required);
		if (group.completed.has(key)) return group.completed.get(key);
		const members = [...group.members.values()];
		const complete = required.every(selector =>
			members.some(member =>
				member.publications.some(publication =>
					publication.outcome === 'succeeded' && matchesPublication(selector, publication)
				)
			)
		);
		const result = complete ? members : undefined;
		group.completed.set(key, result);
		return result;
	}
}
