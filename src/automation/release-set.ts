import { Effect } from 'effect';
import { deriveExecution } from '@/automation/execution';
import { discover } from '@/automation/managers';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId, selectorKey } from '@/automation/package-identity';
import type { Execution, Inventory, Snapshot } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { fromSync } from '@/failure';
import { executionId } from '@/persistence/identity-keys';

function expandPackages(
	member: Execution,
	targets: string[],
	inventory: Inventory,
	repositoryId: number,
	event: string,
): Effect.Effect<Execution[], DomainError> {
	return Effect.gen(function*() {
		const workflow = member.workflow;
		if (!workflow) return yield* precondition('Per-package operation needs a workflow');
		if (!inventory.workflows.find(found => found.file === workflow.file)?.dispatchInputs.includes('package')) {
			return yield* precondition(`Per-package workflow needs a package input: ${workflow.file}`);
		}
		if (!targets.length) {
			return yield* precondition(`Per-package operation has no required packages: ${member.operation}`);
		}
		const order = (id: string) => {
			const index = inventory.publicationOrder.indexOf(id);
			return index < 0 ? inventory.publicationOrder.length : index;
		};
		const selected = yield* Effect.forEach(targets, reference => {
			const matches = inventory.packages.filter(pkg => matchesPackage(reference, pkg));
			const [pkg] = matches;
			return matches.length !== 1 || !pkg
				? Effect.fail(precondition(`Per-package target is ambiguous or missing: ${reference}`))
				: Effect.succeed({ reference, pkg, id: packageId(pkg) });
		});
		selected.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));
		const identified = yield* Effect.forEach(
			selected,
			target =>
				executionId(repositoryId, member.stream, `${member.operation}#${target.id}`, event).pipe(
					Effect.map(id => ({ ...target, executionId: id })),
				),
			{ concurrency: 'unbounded' },
		);
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
	});
}

/** Compile a frozen preparation into operations for its verified merged revision. */
export function compileReleaseSet(preparation: Execution, snapshot: Snapshot): Effect.Effect<Execution[], DomainError> {
	return Effect.gen(function*() {
		const plan = preparation.managed?.plan ?? preparation.plan;
		if (
			preparation.state !== 'succeeded' || !(preparation.managed?.result ?? preparation.prepared?.result) || !plan
			|| !('groups' in plan)
		) {
			return yield* precondition('Completed release-set preparation required');
		}
		if (snapshot.repository.id !== preparation.repositoryId || snapshot.repository.name !== preparation.repository) {
			return yield* precondition('Prepared repository identity changed');
		}
		for (const edit of plan.edits) {
			if (snapshot.files[edit.path] !== edit.after) {
				return yield* precondition(`Prepared content changed: ${edit.path}`);
			}
		}
		if (!plan.operations.length || plan.operations.length > 100) {
			return yield* precondition('Release set requires 1-100 operations');
		}
		const stream = preparation.configuration.streams[preparation.stream];
		if (!stream) return yield* precondition('Missing prepared stream');
		const inventory = yield* fromSync(() => discover(snapshot, preparation.configuration.managers));
		for (const group of plan.groups) {
			for (const name of group.packages) {
				const matches = inventory.packages.filter(pkg => matchesPackage(name, pkg));
				const [match] = matches;
				if (
					matches.length !== 1 || !match
					|| (tagPrefix(match.versionSource) === undefined && match.version !== group.version)
				) {
					return yield* precondition(`Prepared package version mismatch: ${name}`);
				}
			}
		}
		const revision = { defaultBranch: snapshot.repository.defaultBranch, inventory };
		const event = `release-set:${preparation.id}:${snapshot.sha}`;
		const operations: Execution[] = [];
		const names = new Set(plan.operations.map(op => op.id));
		for (const operation of plan.operations) {
			if (operation.id === 'prepare') return yield* precondition('Release set cannot repeat preparation');
			const execution = yield* deriveExecution(preparation, revision, {
				stream: preparation.stream,
				operation: operation.id,
				eventId: event,
				sourceSha: snapshot.sha,
				version: operation.version,
				perPackage: true,
			});
			const binding = execution.workflow;
			if (!binding || binding.ref?.includes('*')) return yield* precondition('Exact workflow binding required');
			if (
				binding.platform && operation.platform
				&& (binding.platform.os !== operation.platform.os || binding.platform.arch !== operation.platform.arch
					|| binding.platform.abi !== operation.platform.abi)
			) {
				return yield* precondition(`Platform binding mismatch: ${operation.id}`);
			}
			const outputs = new Map((binding.outputs ?? []).map(output => [output.id, output]));
			for (const output of operation.outputs) {
				if (outputs.has(output.id) && outputs.get(output.id)?.kind !== output.kind) {
					return yield* precondition('Output kind changed');
				}
				outputs.set(output.id, output);
			}
			const inputs = new Map(
				[...(binding.artifactInputs ?? []), ...operation.inputs].map(
					input => [`${input.operation}/${input.output}`, input],
				),
			);
			const needs = [
				...new Set([
					...(binding.needs ?? []),
					...operation.needs,
					...[...inputs.values()].map(input => input.operation),
				]),
			].sort();
			if (needs.some(name => !names.has(name))) {
				return yield* precondition(`Release set omits a dependency of ${operation.id}`);
			}
			execution.workflow = {
				...binding,
				needs,
				outputs: [...outputs.values()],
				artifactInputs: [...inputs.values()],
				platform: operation.platform ?? binding.platform,
			};
			execution.dependencies = yield* Effect.forEach(
				needs,
				name => executionId(preparation.repositoryId, preparation.stream, name, event),
				{ concurrency: 'unbounded' },
			);
			execution.releaseSet = { preparationId: preparation.id, group: operation.group, required: [] };
			operations.push(execution);
		}
		const bindings = new Map(operations.map(op => [op.operation, op.workflow]));
		const visited = new Set<string>(), visiting = new Set<string>();
		const visit = (name: string): Effect.Effect<void, DomainError> =>
			Effect.gen(function*() {
				if (visited.has(name)) return;
				if (visiting.has(name)) return yield* precondition('Combined operation dependency cycle');
				visiting.add(name);
				const binding = bindings.get(name);
				for (const input of binding?.artifactInputs ?? []) {
					if (!bindings.get(input.operation)?.outputs?.some(output => output.id === input.output)) {
						return yield* precondition('Missing producer output');
					}
				}
				for (const dependency of binding?.needs ?? []) yield* visit(dependency);
				visiting.delete(name);
				visited.add(name);
			});
		for (const name of names) yield* visit(name);
		const assigned = new Set<string>();
		for (const group of plan.groups) {
			const members = operations.filter(op => op.releaseSet?.group === group.id);
			if (!members.length) return yield* precondition(`Release group has no operations: ${group.id}`);
			const publications = new Set(
				[...group.packages, ...members.flatMap(op => op.workflow?.publications ?? [])].map(reference =>
					selectorKey(reference, inventory.packages)
				),
			);
			const required = stream.required.filter(id => publications.has(selectorKey(id, inventory.packages)));
			for (const id of required) {
				if (assigned.has(id)) return yield* precondition(`Publication assigned to multiple groups: ${id}`);
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
					const expanded = yield* expandPackages(member, targets, inventory, preparation.repositoryId, event);
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
			return yield* precondition('Required publication is not assigned to a release group');
		}
		return operations;
	});
}
