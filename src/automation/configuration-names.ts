import {
	approvalOfPublishWhen,
	bumpOfVersionLands,
	existingTriggersNames,
	publishWhenNames,
	triggersOfExistingTriggers,
	versioningOfVersionScope,
	versionLandsNames,
	versionScopeNames,
} from '@/contract/setup-terms';

interface Rename {
	from: string;
	to: string;
	values: Readonly<Record<string, string>>;
}
type Winner = 'from' | 'to';
interface Names {
	winner: Winner;
	stream: readonly Rename[];
	prepare: readonly Rename[];
	promote: readonly Rename[];
	setup: readonly Rename[];
}

const unchanged: Readonly<Record<string, string>> = {};
const toLegacy: Names = {
	winner: 'from',
	stream: [
		{ from: 'versionScope', to: 'versioning', values: versioningOfVersionScope },
		{ from: 'startFrom', to: 'start', values: unchanged },
		{ from: 'mustPublish', to: 'required', values: unchanged },
	],
	prepare: [{ from: 'versionLands', to: 'bump', values: bumpOfVersionLands }],
	promote: [{ from: 'publishWhen', to: 'approval', values: approvalOfPublishWhen }],
	setup: [{ from: 'existingTriggers', to: 'triggers', values: triggersOfExistingTriggers }],
};
const toReadable: Names = {
	winner: 'to',
	stream: [
		{ from: 'versioning', to: 'versionScope', values: versionScopeNames },
		{ from: 'start', to: 'startFrom', values: unchanged },
		{ from: 'required', to: 'mustPublish', values: unchanged },
	],
	prepare: [{ from: 'bump', to: 'versionLands', values: versionLandsNames }],
	promote: [{ from: 'approval', to: 'publishWhen', values: publishWhenNames }],
	setup: [{ from: 'triggers', to: 'existingTriggers', values: existingTriggersNames }],
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renamed(value: Record<string, unknown>, renames: readonly Rename[], winner: Winner): Record<string, unknown> {
	const both = renames.filter(rename => Object.hasOwn(value, rename.from) && Object.hasOwn(value, rename.to));
	const dropped = new Set(both.map(rename => winner === 'from' ? rename.to : rename.from));
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, field]): [string, unknown][] => {
			if (dropped.has(key)) return [];
			const rename = renames.find(entry => entry.from === key);
			if (!rename) return [[key, field]];
			const mapped = typeof field === 'string' && Object.hasOwn(rename.values, field) ? rename.values[field] : field;
			return [[rename.to, mapped]];
		}),
	);
}

function binding(value: unknown, names: Names): unknown {
	return isRecord(value) && isRecord(value.setup)
		? { ...value, setup: renamed(value.setup, names.setup, names.winner) }
		: value;
}

function role(value: unknown, renames: readonly Rename[], names: Names): unknown {
	if (!isRecord(value)) return value;
	const row = renamed(value, renames, names.winner);
	return 'workflow' in row ? { ...row, workflow: binding(row.workflow, names) } : row;
}

function stream(value: unknown, names: Names): unknown {
	if (!isRecord(value)) return value;
	const row = renamed(value, names.stream, names.winner);
	const workflows = row.workflows;
	return {
		...row,
		...('prepare' in row ? { prepare: role(row.prepare, names.prepare, names) } : {}),
		...('promote' in row ? { promote: role(row.promote, names.promote, names) } : {}),
		...(isRecord(workflows)
			? {
				workflows: Object.fromEntries(Object.entries(workflows).map(([name, entry]) => [name, binding(entry, names)])),
			}
			: {}),
	};
}

function convert(value: unknown, names: Names): unknown {
	if (!isRecord(value) || !isRecord(value.streams)) return value;
	return {
		...value,
		streams: Object.fromEntries(Object.entries(value.streams).map(([name, entry]) => [name, stream(entry, names)])),
	};
}

export function legacyConfiguration(value: unknown): unknown {
	return convert(value, toLegacy);
}

export function readableConfiguration(value: unknown): unknown {
	return convert(value, toReadable);
}
