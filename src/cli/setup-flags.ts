import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { z } from 'zod';
import type { Selection } from '@/automation/setup-defaults';
import { suggestedCommands, ungenerated } from '@/automation/setup-defaults';
import type { SetupChoices, SetupPlan } from '@/automation/setup-types';
import { failure } from '@/cli/output';
import type { BinaryBuild } from '@/contract/setup';
import { binaryTargets, setupChoicesSchema, setupStream } from '@/contract/setup';
import type { ChoicesField, StreamField, WorkflowField } from '@/contract/setup-fields';
import { choicesFields, streamFields, workflowFields } from '@/contract/setup-fields';
import {
	approvalOfPublishWhen,
	bumpOfVersionLands,
	triggersOfExistingTriggers,
	versioningOfVersionScope,
} from '@/contract/setup-terms';
import { packageLabel } from '@/domain/package-label';

type Stream = SetupChoices['streams'][number];
type FlagKind = 'stream' | 'text' | 'list' | 'packages' | 'json' | 'workflow' | 'binaries';

export const choicesFlagKinds = { streams: 'stream', actionsRevision: 'text' } as const satisfies Record<
	ChoicesField,
	FlagKind
>;
export const streamFlagKinds = {
	name: 'stream',
	packages: 'packages',
	required: 'packages',
	versioning: 'text',
	approval: 'text',
	start: 'list',
	bump: 'text',
	versionPrMerge: 'text',
	versionSource: 'json',
	versionFiles: 'json',
	companionModules: 'packages',
	observe: 'json',
	needs: 'json',
	prepare: 'workflow',
	promote: 'workflow',
	operations: 'json',
} as const satisfies Record<StreamField, FlagKind>;
export const workflowFlagKinds = {
	file: 'text',
	job: 'text',
	triggers: 'text',
	commands: 'text',
	publicationSteps: 'json',
	credentials: 'json',
	tagPrefix: 'text',
	binaries: 'json',
} as const satisfies Record<WorkflowField, FlagKind>;

const fixedNames: Readonly<Record<string, readonly string[]>> = {
	streams: ['stream'],
	name: ['stream'],
	packages: ['package'],
	companionModules: ['companion-module'],
	required: ['must-publish', 'required'],
	versioning: ['version-scope', 'versioning'],
	start: ['start-from', 'start'],
	bump: ['version-lands', 'bump'],
	approval: ['publish-when', 'approval'],
	'prepare.triggers': ['prepare-existing-triggers', 'prepare-triggers'],
	'promote.triggers': ['promote-existing-triggers', 'promote-triggers'],
	'promote.binaries': ['binary', 'target'],
};
const deprecatedNames = new Set([
	'required',
	'versioning',
	'start',
	'bump',
	'approval',
	'prepare-triggers',
	'promote-triggers',
]);
const currentValues: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	versioning: versioningOfVersionScope,
	bump: bumpOfVersionLands,
	approval: approvalOfPublishWhen,
	triggers: triggersOfExistingTriggers,
};
function internal(field: string, value: unknown): unknown {
	const values = currentValues[field];
	return typeof value === 'string' && values && Object.hasOwn(values, value) ? values[value] : value;
}
const roles = ['prepare', 'promote'] as const;

export interface SetupFlagPath {
	path: string;
	kind: FlagKind;
	names: readonly string[];
}

function named(path: string, kind: FlagKind): SetupFlagPath {
	return {
		path,
		kind,
		names: fixedNames[path] ?? [path.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).replaceAll('.', '-')],
	};
}

export const setupFlagPaths: readonly SetupFlagPath[] = [
	...choicesFields.map(field => named(field, choicesFlagKinds[field])),
	...streamFields.flatMap(field => {
		const kind = streamFlagKinds[field];
		if (kind !== 'workflow') return [named(field, kind)];
		return workflowFields.map(entry =>
			named(`${field}.${entry}`, field === 'promote' && entry === 'binaries' ? 'binaries' : workflowFlagKinds[entry])
		);
	}),
];

export type SetupFlagValues = ReadonlyMap<string, unknown>;

const text = z.string();
const list = z.array(z.string());

export function readSetupFlags(
	given: Readonly<Record<string, unknown>>,
): Effect.Effect<SetupFlagValues | undefined, CLIError> {
	return Effect.gen(function*() {
		const values = new Map<string, unknown>();
		for (const { kind, names } of setupFlagPaths) {
			for (const name of names) {
				if (values.has(name)) continue;
				const raw = given[name];
				if (kind === 'stream' || kind === 'text') {
					const parsed = text.safeParse(raw);
					if (parsed.success) values.set(name, parsed.data);
				} else if (kind === 'json') {
					const parsed = text.safeParse(raw);
					if (!parsed.success) continue;
					values.set(
						name,
						yield* Effect.try({
							try: (): unknown => JSON.parse(parsed.data),
							catch: () => failure(`--${name} is not valid JSON`, 'INVALID_FLAG'),
						}),
					);
				} else {
					const parsed = list.safeParse(raw);
					if (parsed.success && parsed.data.length) values.set(name, parsed.data);
				}
			}
		}
		return values.size ? values : undefined;
	});
}

function packageIds(plan: SetupPlan, flag: string, names: readonly string[]): Effect.Effect<string[], CLIError> {
	return Effect.forEach(names, name => {
		if (plan.packageIds.includes(name)) return Effect.succeed(name);
		const matches = plan.packageIds.filter((id, index) =>
			plan.inventory.packages[index]?.name === name || packageLabel(id) === name
		);
		const [only, ...more] = matches;
		if (only && !more.length) return Effect.succeed(only);
		return Effect.fail(
			matches.length
				? failure(`--${flag} ${name} names several packages: ${matches.join(', ')}`, 'AMBIGUOUS_PACKAGE')
				: failure(
					`--${flag} ${name} is not a discovered package`,
					'UNKNOWN_PACKAGE',
					`Discovered packages: ${plan.inventory.packages.map(pkg => pkg.name).join(', ') || 'none'}`,
				),
		);
	});
}

function flagOf(path: readonly PropertyKey[]): string {
	const [field, entry] = path.map(String);
	const nested = entry && (field === 'prepare' || field === 'promote') ? `${field}.${entry}` : field ?? '';
	const found = setupFlagPaths.find(candidate => candidate.path === nested);
	return found
		? found.names.filter(name => !deprecatedNames.has(name)).map(name => `--${name}`).join(' and ')
		: nested;
}

function binaries(
	plan: SetupPlan,
	stream: Stream,
	packages: readonly string[],
	builds: readonly string[] | undefined,
	targets: readonly string[] | undefined,
): Effect.Effect<{ builds: BinaryBuild[]; targets: string[] }, CLIError> {
	return Effect.gen(function*() {
		const existing = stream.promote?.binaries;
		const candidates = (plan.binaryCandidates ?? []).filter(candidate => packages.includes(candidate.package));
		const chosen = builds
			? yield* Effect.forEach(builds, name => {
				const build = existing?.builds.find(entry => entry.name === name)
					?? candidates.find(candidate => candidate.build.name === name)?.build;
				return build ? Effect.succeed(build) : Effect.fail(
					failure(
						`--binary ${name} is not a binary of ${stream.name}`,
						'UNKNOWN_BINARY',
						`Binaries: ${
							[...new Set(
								[...existing?.builds ?? [], ...candidates.map(entry => entry.build)].map(entry => entry.name),
							)]
								.join(', ') || 'none'
						}`,
					),
				);
			})
			: existing?.builds;
		if (!chosen) {
			return yield* Effect.fail(failure('--target needs --binary', 'BINARY_REQUIRED'));
		}
		return {
			builds: chosen,
			targets: targets
				? [...targets]
				: existing?.targets
					?? binaryTargets.filter(target =>
						chosen.every(build =>
							candidates.find(candidate => candidate.build.name === build.name)?.targets.includes(target) ?? true
						)
					),
		};
	});
}

function generated(
	plan: SetupPlan,
	stream: string,
	role: 'prepare' | 'promote',
	packages: readonly string[],
	given: Record<string, unknown>,
): Effect.Effect<Record<string, unknown>, CLIError> {
	return Effect.gen(function*() {
		const file = text.safeParse(given.file);
		if (!file.success) return given;
		const evidence = plan.workflows.find(workflow => workflow.file === file.data);
		const owned = evidence?.roles.filter(entry => entry.stream === stream && entry.operation === role) ?? [];
		const inferred = owned.length === 1 ? owned[0]?.job : evidence?.jobs.length === 1 ? evidence.jobs[0] : undefined;
		const job = text.safeParse(given.job).data ?? (evidence ? inferred : role === 'prepare' ? 'prepare' : 'publish');
		if (job === undefined) {
			return yield* Effect.fail(
				failure(
					`--${role}-job names the job in ${file.data}`,
					'JOB_REQUIRED',
					`Jobs: ${evidence?.jobs.join(', ') ?? 'none'}`,
				),
			);
		}
		const integrated = role === 'prepare'
			? evidence?.preparationJobs.includes(job)
			: evidence?.reportingJobs.includes(job);
		const selection: Selection = {
			name: stream,
			packages: plan.packageIds.flatMap((id, index) => {
				const pkg = plan.inventory.packages[index];
				return pkg && packages.includes(id) ? [{ ...pkg, id }] : [];
			}),
		};
		if (given.commands === undefined && !integrated && ungenerated(selection).length) {
			return yield* Effect.fail(
				failure(
					`Beepboop cannot generate ${role} commands for ${ungenerated(selection).map(pkg => pkg.name).join(', ')}`,
					'COMMANDS_REQUIRED',
					`Give them with --${role}-commands`,
				),
			);
		}
		return {
			...given,
			job,
			commands: given.commands ?? (integrated ? '' : suggestedCommands(role, selection, plan)),
		};
	});
}

export function applySetupFlags(
	choices: SetupChoices,
	values: SetupFlagValues,
	plan: SetupPlan,
): Effect.Effect<SetupChoices, CLIError> {
	return Effect.gen(function*() {
		const streams = structuredClone(choices.streams);
		const value = (name: string) => values.get(name);
		const strings = (name: string) => {
			const parsed = list.safeParse(value(name));
			return parsed.success ? parsed.data : undefined;
		};
		const streamPaths = setupFlagPaths.filter(entry => !choicesFields.some(field => field === entry.path));
		const streamFlagged = streamPaths.some(entry =>
			entry.kind !== 'stream' && entry.names.some(name => values.has(name))
		);
		const requested = text.safeParse(value('stream'));
		let target: Stream | undefined;
		if (requested.success) {
			target = streams.find(stream => stream.name === requested.data);
			if (!target) {
				target = { name: requested.data, packages: [], required: [], versioning: 'workspace' };
				streams.push(target);
			}
		} else if (streamFlagged) {
			const [only, ...more] = streams;
			if (!only || more.length) {
				return yield* Effect.fail(
					failure(
						'Name the release group these flags change with --stream',
						'STREAM_REQUIRED',
						`Release groups: ${streams.map(stream => stream.name).join(', ') || 'none'}`,
					),
				);
			}
			target = only;
		}
		if (target) {
			const current = target;
			const entered: Record<string, unknown> = { ...current };
			const roleEntries: Record<string, Record<string, unknown> | undefined> = {
				prepare: current.prepare ? { ...current.prepare } : undefined,
				promote: current.promote ? { ...current.promote } : undefined,
			};
			for (const entry of streamPaths) {
				if (entry.kind === 'stream' || entry.kind === 'binaries') continue;
				const name = entry.names.find(candidate => values.has(candidate));
				if (name === undefined) continue;
				const [field, nested] = entry.path.split('.');
				const role = roles.find(candidate => candidate === field);
				const given = entry.kind === 'packages'
					? yield* packageIds(plan, name, strings(name) ?? [])
					: internal(nested ?? field ?? '', value(name));
				if (role && nested) {
					roleEntries[role] = { ...roleEntries[role], [nested]: given };
					continue;
				}
				if (field) entered[field] = given;
			}
			const packages = list.safeParse(entered.packages).data ?? current.packages;
			if (values.has('package') && !values.has('must-publish') && !values.has('required')) {
				entered.required = [...packages];
			}
			const builds = strings('binary'), targets = strings('target');
			if (builds || targets) {
				if (!roleEntries.promote) {
					return yield* Effect.fail(
						failure('--binary and --target need a publishing workflow', 'PROMOTE_REQUIRED', 'Add --promote-file'),
					);
				}
				roleEntries.promote.binaries = yield* binaries(plan, current, packages, builds, targets);
			}
			for (const role of roles) {
				const next = roleEntries[role];
				if (!next) continue;
				entered[role] = current[role] ? next : yield* generated(plan, current.name, role, packages, next);
			}
			const parsed = setupStream.safeParse(entered);
			if (!parsed.success) {
				const [issue] = parsed.error.issues;
				return yield* Effect.fail(
					failure(
						issue ? `${flagOf(issue.path)}: ${issue.message}` : parsed.error.message,
						'INVALID_FLAG',
					),
				);
			}
			streams[streams.indexOf(current)] = parsed.data;
		}
		const revision = text.safeParse(value('actions-revision'));
		const result = setupChoicesSchema.safeParse({
			...choices,
			streams,
			...(revision.success ? { actionsRevision: revision.data } : {}),
		});
		if (!result.success) {
			const [issue] = result.error.issues;
			return yield* Effect.fail(
				failure(
					issue && issue.path[0] === 'actionsRevision'
						? `--actions-revision: ${issue.message}`
						: issue
						? `${issue.path.join('.')}: ${issue.message}`
						: result.error.message,
					'INVALID_FLAG',
				),
			);
		}
		return result.data;
	});
}
