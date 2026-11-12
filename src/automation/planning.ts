import { Effect, Result, Schema } from 'effect';
import { applyVersionFiles, fileEdits } from '@/automation/editors';
import { planRelease, publicationOrder } from '@/automation/managers';
import { inputSchema, nameSchema, outputSchema, platformSchema } from '@/automation/outputs';
import { matchesPackage, selectorKey } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Edit, Inventory, Snapshot } from '@/automation/types';
import { parseVersionRequest } from '@/automation/version';
import { isLockfile } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { decodeRequest, precondition } from '@/contract/errors';
import type { VersionFile } from '@/contract/version-files';
import { dependencyOrder } from '@/dependency-order';
import { invalid } from '@/model';
import type { Decoded } from '@/schema';
import { mutableArray, strictStruct } from '@/schema';

const operation = strictStruct({
	id: nameSchema,
	group: nameSchema,
	needs: mutableArray(nameSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
	platform: Schema.optional(platformSchema),
	inputs: mutableArray(inputSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
	outputs: mutableArray(outputSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export const releaseSetRequest = strictStruct({
	groups: mutableArray(strictStruct({
		id: nameSchema,
		packages: mutableArray(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
		version: Schema.Unknown,
	})).check(Schema.isMinLength(1)),
	operations: mutableArray(operation).check(Schema.isMaxLength(100)).pipe(
		Schema.withDecodingDefault(Effect.succeed([])),
	),
});
export type PlannedOperation = Decoded<typeof operation> & { version: string };
export interface ReleaseSetPlan {
	lockfiles: string[];
	sourceSha: string;
	groups: { id: string; packages: string[]; version: string }[];
	operations: PlannedOperation[];
	publicationOrder: string[];
	edits: Edit[];
	diagnostics: string[];
	requiresPreparation: boolean;
}

function ordered(operations: Map<string, PlannedOperation>): Effect.Effect<PlannedOperation[], DomainError> {
	const order = dependencyOrder(
		[...operations.keys()].sort(),
		name => {
			const op = operations.get(name);
			if (!op) return invalid(`Unknown operation dependency: ${name}`);
			for (const input of op.inputs) {
				if (!operations.get(input.operation)?.outputs.some(output => output.id === input.output)) {
					return invalid(`Unknown output: ${input.operation}/${input.output}`);
				}
			}
			op.needs = [...new Set([...op.needs, ...op.inputs.map(input => input.operation)])].sort();
			return Result.succeed(op.needs);
		},
		name => invalid(`Operation dependency cycle: ${name}`),
	);
	return Effect.fromResult(order).pipe(Effect.map(names =>
		names.flatMap(name => {
			const op = operations.get(name);
			return op ? [op] : [];
		})
	));
}

/** Resolve all versions against the same revision before composing any edits. */
export function planReleaseSet(
	snapshot: Snapshot,
	inventory: Inventory,
	input: unknown,
	allowed?: string[],
	versionFiles: VersionFile[] = [],
): Effect.Effect<ReleaseSetPlan, DomainError> {
	return Effect.gen(function*() {
		const request = yield* decodeRequest(releaseSetRequest, input);
		const groups = new Map<string, { id: string; packages: string[]; version: string }>();
		const selected = new Set<string>();
		for (const group of request.groups) {
			group.packages = group.packages.map(reference => selectorKey(reference, inventory.packages));
			if (groups.has(group.id)) return yield* precondition(`Duplicate release group: ${group.id}`);
			for (const name of group.packages) {
				if (selected.has(name)) return yield* precondition(`Package selected more than once: ${name}`);
				if (allowed && !allowed.some(reference => selectorKey(reference, inventory.packages) === name)) {
					return yield* precondition(`Package is outside this release stream: ${name}`);
				}
				if (!inventory.packages.some(p => publishable(p) && matchesPackage(name, p))) {
					return yield* precondition(`Unknown publishable package: ${name}`);
				}
				selected.add(name);
			}
			const plan = yield* planRelease(snapshot, inventory, yield* parseVersionRequest(group.version), group.packages);
			groups.set(group.id, { ...group, version: plan.version });
		}
		const operations = new Map<string, PlannedOperation>();
		for (const op of request.operations) {
			if (operations.has(op.id)) return yield* precondition(`Duplicate operation: ${op.id}`);
			const group = groups.get(op.group);
			if (!group) return yield* precondition(`Unknown release group: ${op.group}`);
			if (new Set(op.outputs.map(output => output.id)).size !== op.outputs.length) {
				return yield* precondition(`Duplicate output in ${op.id}`);
			}
			operations.set(op.id, { ...op, version: group.version });
		}
		const order = yield* ordered(operations);
		const files = { ...snapshot.files };
		const diagnostics = new Set<string>();
		let requiresPreparation = false;
		for (const group of [...groups.values()].sort((a, b) => a.id.localeCompare(b.id))) {
			const plan = yield* planRelease({ ...snapshot, files }, inventory, group.version, group.packages);
			for (const edit of plan.edits) files[edit.path] = edit.after;
			for (const diagnostic of plan.diagnostics) diagnostics.add(diagnostic);
			requiresPreparation ||= plan.requiresPreparation;
		}
		yield* applyVersionFiles(
			snapshot,
			files,
			versionFiles,
			Object.fromEntries([...groups.values()].map(group => [group.id, group.version])),
		);
		const edits = yield* fileEdits(
			snapshot.files,
			Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
		);
		const ordering = publicationOrder(
			inventory.packages.filter(p => [...selected].some(reference => matchesPackage(reference, p))),
		);
		if (ordering.kind === 'cycle') return yield* precondition(ordering.message);
		return {
			lockfiles: Object.keys(snapshot.files).filter(isLockfile),
			sourceSha: snapshot.sha,
			groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)),
			operations: order,
			publicationOrder: ordering.order,
			edits,
			diagnostics: [...diagnostics],
			requiresPreparation,
		};
	});
}
