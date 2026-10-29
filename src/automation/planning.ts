import { z } from 'zod';
import { applyVersionFiles, type VersionFile } from './editors.ts';
import { planRelease, publicationOrder } from './managers.ts';
import { inputSchema, outputSchema, platformSchema } from './outputs.ts';
import type { Edit, Inventory, Snapshot } from './types.ts';
import { parseVersionRequest } from './version.ts';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const operation = z.strictObject({
	id,
	group: id,
	needs: z.array(id).default([]),
	platform: platformSchema.optional(),
	inputs: z.array(inputSchema).default([]),
	outputs: z.array(outputSchema).default([]),
});
export const releaseSetRequest = z.strictObject({
	groups: z.array(z.strictObject({
		id,
		packages: z.array(z.string().min(1)).min(1),
		version: z.unknown(),
	})).min(1),
	operations: z.array(operation).max(100).default([]),
});
export type PlannedOperation = z.infer<typeof operation> & { version: string };
export type ReleaseSetPlan = ReturnType<typeof planReleaseSet>;

/** Resolve all versions against the same revision before composing any edits. */
export function planReleaseSet(
	snapshot: Snapshot,
	inventory: Inventory,
	input: unknown,
	allowed?: string[],
	versionFiles: VersionFile[] = [],
) {
	const request = releaseSetRequest.parse(input);
	const groups = new Map<string, { id: string; packages: string[]; version: string }>();
	const selected = new Set<string>();
	for (const group of request.groups) {
		if (groups.has(group.id)) throw new Error(`Duplicate release group: ${group.id}`);
		for (const name of group.packages) {
			if (selected.has(name)) throw new Error(`Package selected more than once: ${name}`);
			if (allowed && !allowed.includes(name)) throw new Error(`Package is outside this release stream: ${name}`);
			if (!inventory.packages.some(p => p.publish && `${p.manager}:${p.name}` === name)) {
				throw new Error(`Unknown publishable package: ${name}`);
			}
			selected.add(name);
		}
		const plan = planRelease(snapshot, inventory, parseVersionRequest(group.version), group.packages);
		groups.set(group.id, { ...group, version: plan.version });
	}
	const operations = new Map<string, PlannedOperation>();
	for (const op of request.operations) {
		if (operations.has(op.id)) throw new Error(`Duplicate operation: ${op.id}`);
		const group = groups.get(op.group);
		if (!group) throw new Error(`Unknown release group: ${op.group}`);
		if (new Set(op.outputs.map(output => output.id)).size !== op.outputs.length) {
			throw new Error(`Duplicate output in ${op.id}`);
		}
		operations.set(op.id, { ...op, version: group.version });
	}
	const order: PlannedOperation[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();
	function visit(name: string) {
		if (visited.has(name)) return;
		if (visiting.has(name)) throw new Error(`Operation dependency cycle: ${name}`);
		const op = operations.get(name);
		if (!op) throw new Error(`Unknown operation dependency: ${name}`);
		visiting.add(name);
		for (const input of op.inputs) {
			if (!operations.get(input.operation)?.outputs.some(output => output.id === input.output)) {
				throw new Error(`Unknown output: ${input.operation}/${input.output}`);
			}
		}
		op.needs = [...new Set([...op.needs, ...op.inputs.map(input => input.operation)])].sort();
		for (const dependency of op.needs) visit(dependency);
		visiting.delete(name);
		visited.add(name);
		order.push(op);
	}
	for (const name of [...operations.keys()].sort()) visit(name);
	const files = { ...snapshot.files };
	const diagnostics = new Set<string>();
	let requiresPreparation = false;
	for (const group of [...groups.values()].sort((a, b) => a.id.localeCompare(b.id))) {
		const plan = planRelease({ ...snapshot, files }, inventory, group.version, group.packages);
		for (const edit of plan.edits) files[edit.path] = edit.after;
		for (const diagnostic of plan.diagnostics) diagnostics.add(diagnostic);
		requiresPreparation ||= plan.requiresPreparation;
	}
	applyVersionFiles(
		snapshot,
		files,
		versionFiles,
		Object.fromEntries([...groups.values()].map(group => [group.id, group.version])),
	);
	const edits: Edit[] = Object.keys(files).sort().flatMap(path => {
		const before = snapshot.files[path], after = files[path];
		if (before === undefined || after === undefined) throw new Error('Missing planned manifest');
		return before === after ? [] : [{ path, before, after }];
	});
	return {
		lockfiles: Object.keys(snapshot.files).filter(path =>
			/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path)
		),
		sourceSha: snapshot.sha,
		groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)),
		operations: order,
		publicationOrder: publicationOrder(inventory.packages.filter(p => selected.has(`${p.manager}:${p.name}`))),
		edits,
		diagnostics: [...diagnostics],
		requiresPreparation,
	};
}
