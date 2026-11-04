import { createExecution, executionId } from '@/automation/execution';
import { discover } from '@/automation/managers';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId, selectorKey } from '@/automation/package-identity';
import type { Execution, Inventory, RepositoryRecord, Snapshot } from '@/automation/types';

async function expandPackages(
	member: Execution,
	targets: string[],
	inventory: Inventory,
	repositoryId: number,
	event: string,
): Promise<Execution[]> {
	const workflow = member.workflow;
	if (!workflow) throw new Error('Per-package operation needs a workflow');
	if (!inventory.workflows.find(found => found.file === workflow.file)?.dispatchInputs.includes('package')) {
		throw new Error(`Per-package workflow needs a package input: ${workflow.file}`);
	}
	if (!targets.length) throw new Error(`Per-package operation has no required packages: ${member.operation}`);
	const order = (id: string) => {
		const index = inventory.publicationOrder.indexOf(id);
		return index < 0 ? inventory.publicationOrder.length : index;
	};
	const selected = targets.map(reference => {
		const matches = inventory.packages.filter(pkg => matchesPackage(reference, pkg));
		const [pkg] = matches;
		if (matches.length !== 1 || !pkg) throw new Error(`Per-package target is ambiguous or missing: ${reference}`);
		return { reference, pkg, id: packageId(pkg) };
	}).sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));
	const identified = await Promise.all(selected.map(async target => ({
		...target,
		executionId: await executionId(repositoryId, member.stream, `${member.operation}#${target.id}`, event),
	})));
	return identified.map(target => {
		const upstream = identified.filter(other =>
			other.pkg.manager === target.pkg.manager && target.pkg.dependencies.includes(other.pkg.name)
		);
		return {
			...structuredClone(member),
			id: target.executionId,
			package: { id: target.id, manager: target.pkg.manager },
			workflow: { ...workflow, publications: [target.reference] },
			dependencies: [...new Set([...member.dependencies, ...upstream.map(other => other.executionId)])],
		};
	});
}

/** Compile a frozen preparation into operations for its verified merged revision. */
export async function compileReleaseSet(preparation: Execution, snapshot: Snapshot): Promise<Execution[]> {
	const plan = preparation.managed?.plan ?? preparation.plan;
	if (
		preparation.state !== 'succeeded' || !(preparation.managed?.result ?? preparation.prepared?.result) || !plan
		|| !('groups' in plan)
	) {
		throw new Error('Completed release-set preparation required');
	}
	if (snapshot.repository.id !== preparation.repositoryId || snapshot.repository.name !== preparation.repository) {
		throw new Error('Prepared repository identity changed');
	}
	for (const edit of plan.edits) {
		if (snapshot.files[edit.path] !== edit.after) throw new Error(`Prepared content changed: ${edit.path}`);
	}
	if (!plan.operations.length || plan.operations.length > 100) throw new Error('Release set requires 1-100 operations');
	const stream = preparation.configuration.streams[preparation.stream];
	if (!stream) throw new Error('Missing prepared stream');
	const inventory = discover(snapshot, preparation.configuration.managers);
	for (const group of plan.groups) {
		for (const name of group.packages) {
			const matches = inventory.packages.filter(pkg => matchesPackage(name, pkg));
			const [match] = matches;
			if (
				matches.length !== 1 || !match
				|| (tagPrefix(match.versionSource) === undefined && match.version !== group.version)
			) {
				throw new Error(`Prepared package version mismatch: ${name}`);
			}
		}
	}
	const repository: RepositoryRecord = {
		...snapshot.repository,
		sha: preparation.configurationSha,
		configuration: preparation.configuration,
		presetShas: preparation.presetShas,
		inventory,
		diagnostics: [],
		updatedAt: Date.now(),
	};
	const event = `release-set:${preparation.id}:${snapshot.sha}`;
	const operations: Execution[] = [];
	const names = new Set(plan.operations.map(op => op.id));
	for (const operation of plan.operations) {
		if (operation.id === 'prepare') throw new Error('Release set cannot repeat preparation');
		const execution = await createExecution(
			repository,
			preparation.stream,
			operation.id,
			event,
			operation.version,
			false,
			undefined,
			true,
		);
		const binding = execution.workflow;
		if (!binding || binding.ref?.includes('*')) throw new Error('Exact workflow binding required');
		if (
			binding.platform && operation.platform
			&& (binding.platform.os !== operation.platform.os || binding.platform.arch !== operation.platform.arch
				|| binding.platform.abi !== operation.platform.abi)
		) {
			throw new Error(`Platform binding mismatch: ${operation.id}`);
		}
		const outputs = new Map((binding.outputs ?? []).map(output => [output.id, output]));
		for (const output of operation.outputs) {
			if (outputs.has(output.id) && outputs.get(output.id)?.kind !== output.kind) {
				throw new Error('Output kind changed');
			}
			outputs.set(output.id, output);
		}
		const inputs = new Map(
			[...(binding.artifactInputs ?? []), ...operation.inputs].map(
				input => [`${input.operation}/${input.output}`, input],
			),
		);
		const needs = [
			...new Set([...(binding.needs ?? []), ...operation.needs, ...[...inputs.values()].map(input => input.operation)]),
		].sort();
		if (needs.some(name => !names.has(name))) throw new Error(`Release set omits a dependency of ${operation.id}`);
		execution.sourceSha = snapshot.sha;
		execution.workflow = {
			...binding,
			needs,
			outputs: [...outputs.values()],
			artifactInputs: [...inputs.values()],
			platform: operation.platform ?? binding.platform,
		};
		execution.dependencies = await Promise.all(
			needs.map(name => executionId(repository.id, preparation.stream, name, event)),
		);
		execution.releaseSet = { preparationId: preparation.id, group: operation.group, required: [] };
		operations.push(execution);
	}
	const bindings = new Map(operations.map(op => [op.operation, op.workflow]));
	const visited = new Set<string>(), visiting = new Set<string>();
	function visit(name: string) {
		if (visited.has(name)) return;
		if (visiting.has(name)) throw new Error('Combined operation dependency cycle');
		visiting.add(name);
		const binding = bindings.get(name);
		for (const input of binding?.artifactInputs ?? []) {
			if (!bindings.get(input.operation)?.outputs?.some(output => output.id === input.output)) {
				throw new Error('Missing producer output');
			}
		}
		for (const dependency of binding?.needs ?? []) visit(dependency);
		visiting.delete(name);
		visited.add(name);
	}
	for (const name of names) visit(name);
	const assigned = new Set<string>();
	for (const group of plan.groups) {
		const members = operations.filter(op => op.releaseSet?.group === group.id);
		if (!members.length) throw new Error(`Release group has no operations: ${group.id}`);
		const publications = new Set(
			[...group.packages, ...members.flatMap(op => op.workflow?.publications ?? [])].map(reference =>
				selectorKey(reference, inventory.packages)
			),
		);
		const required = stream.required.filter(id => publications.has(selectorKey(id, inventory.packages)));
		for (const id of required) {
			if (assigned.has(id)) throw new Error(`Publication assigned to multiple groups: ${id}`);
			assigned.add(id);
		}
		for (const member of members) {
			if (member.releaseSet) member.releaseSet.required = required;
			if (member.workflow?.each === 'package') {
				const selected = member.workflow.publications;
				const targets = selected
					? required.filter(id =>
						selected.some(reference =>
							selectorKey(reference, inventory.packages) === selectorKey(id, inventory.packages)
						)
					)
					: required;
				const expanded = await expandPackages(member, targets, inventory, repository.id, event);
				operations.splice(operations.indexOf(member), 1, ...expanded);
				const ids = expanded.map(execution => execution.id);
				for (const other of operations) {
					if (other.dependencies.includes(member.id)) {
						other.dependencies = [...new Set(other.dependencies.flatMap(id => id === member.id ? ids : [id]))];
					}
				}
				continue;
			}
			if (member.operation === 'publish' && member.workflow && !member.workflow.publications) {
				member.workflow.publications = required;
			}
		}
	}
	if (stream.required.some(id => !assigned.has(id))) {
		throw new Error('Required publication is not assigned to a release group');
	}
	return operations;
}
