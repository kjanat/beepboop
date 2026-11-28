import type { BinaryBuild, BinaryTarget } from '@/domain/binary-platforms.ts';
import {
	binaryTargets,
	candidateOf,
	defaultBinaryTargets,
	supportedTargets,
	unconfigured,
} from '@/domain/binary-platforms.ts';
import { publishable } from '@/domain/package-publication.ts';
import { configurableStarts, versionBumps } from '@/domain/release-start.ts';
import { versionPrMerges } from '@/domain/setup-terms.ts';
import { bumpable, startable } from '@/setup/contract.ts';
import type { SetupChoices, SetupOption, SetupPlan, SetupWorkflow } from '@/setup/types.ts';
import { approvals, triggerHandovers, versionings } from '@/setup/types.ts';

export type Operation = 'prepare' | 'release';
const operations: Operation[] = ['prepare', 'release'];
export function setupOptions(plan: SetupPlan): SetupOption[] {
	const candidates = plan.packageIds.filter((_, index) => {
		const pkg = plan.inventory.packages[index];
		return pkg !== undefined && publishable(pkg);
	});
	const assigned = new Set(plan.choices.streams.flatMap(stream => stream.packages));
	const unassigned = candidates.filter(id => !assigned.has(id));
	return plan.choices.streams.flatMap((stream, index): SetupOption[] => [
		...[...new Set([...stream.packages, ...(index === 0 ? unassigned : [])])].map((id): SetupOption => ({
			kind: 'package',
			stream: stream.name,
			package: id,
		})),
		...operations.flatMap(operation => {
			const current = stream[operation];
			const suggested = plan.workflows.flatMap(evidence => {
				const role = evidence.roles.find(role => role.stream === stream.name && role.operation === operation);
				return role && evidence.file !== current?.file ? [{ file: evidence.file, job: role.job }] : [];
			});
			return [...(current ? [{ file: current.file, job: current.job }] : []), ...suggested].map((
				binding,
			): SetupOption => ({
				kind: 'workflow',
				stream: stream.name,
				operation,
				file: binding.file,
				...(binding.job === undefined ? {} : { job: binding.job }),
			}));
		}),
		...versionings.map((value): SetupOption => ({ kind: 'versioning', stream: stream.name, value })),
		...(stream.release
			? approvals.map((value): SetupOption => ({ kind: 'approval', stream: stream.name, value }))
			: []),
		...(startable(stream)
			? configurableStarts.map((value): SetupOption => ({ kind: 'start', stream: stream.name, value }))
			: []),
		...(bumpable(stream)
			? versionBumps.map((value): SetupOption => ({ kind: 'bump', stream: stream.name, value }))
			: []),
		...(bumpable(stream)
			? versionPrMerges.map((value): SetupOption => ({ kind: 'versionPrMerge', stream: stream.name, value }))
			: []),
		...operations.flatMap(operation =>
			stream[operation]
				? triggerHandovers.map((value): SetupOption => ({ kind: 'triggers', stream: stream.name, operation, value }))
				: []
		),
		...binaryOptions(plan, stream),
	]);
}
function binaryOptions(plan: SetupPlan, stream: SetupChoices['streams'][number]): SetupOption[] {
	if (!stream.release) return [];
	const candidates = (plan.binaryCandidates ?? []).filter(candidate => stream.packages.includes(candidate.package));
	const builds = [
		...(stream.release.binaries?.builds ?? []).map(build => ({
			build,
			targets: candidateOf(candidates, build)?.targets ?? [...binaryTargets],
		})),
		...unconfigured(candidates, stream.release?.binaries?.builds ?? []),
	];
	if (!builds.length) return [];
	return [
		...builds.map(({ build, targets }): SetupOption => ({ kind: 'binary', stream: stream.name, build, targets })),
		...offeredTargets(builds.map(({ build }) => build)).map((target): SetupOption => ({
			kind: 'target',
			stream: stream.name,
			target,
		})),
	];
}
export function offeredTargets(builds: readonly BinaryBuild[]): BinaryTarget[] {
	const buildable = new Set(builds.flatMap(build => supportedTargets(build.toolchain)));
	return binaryTargets.filter(target => buildable.has(target));
}
export function optionId(option: SetupOption): string {
	const parts = option.kind === 'workflow'
		? [option.kind, option.stream, option.operation, option.file]
		: option.kind === 'binary'
		? [option.kind, option.stream, option.build.name]
		: option.kind === 'target'
		? [option.kind, option.stream, option.target]
		: option.kind === 'versioning' || option.kind === 'approval' || option.kind === 'start' || option.kind === 'bump'
				|| option.kind === 'versionPrMerge'
		? [option.kind, option.stream, option.value]
		: option.kind === 'triggers'
		? [option.kind, option.stream, option.operation, option.value]
		: [option.kind, option.stream, option.package];
	return parts.map(part => encodeURIComponent(part).replaceAll('-', '%2D')).join(':');
}
export function selected(option: SetupOption, choices: SetupChoices): boolean {
	const stream = choices.streams.find(row => row.name === option.stream);
	if (option.kind === 'workflow') return stream?.[option.operation]?.file === option.file;
	if (option.kind === 'versioning') return stream?.versioning === option.value;
	if (option.kind === 'approval') return stream?.approval === option.value;
	if (option.kind === 'start') return stream?.start?.includes(option.value) ?? false;
	if (option.kind === 'bump') return stream?.bump === option.value;
	if (option.kind === 'versionPrMerge') return (stream?.versionPrMerge ?? 'manual') === option.value;
	if (option.kind === 'triggers') return stream?.[option.operation]?.triggers === option.value;
	if (option.kind === 'binary') {
		return stream?.release?.binaries?.builds.some(build => build.name === option.build.name) ?? false;
	}
	if (option.kind === 'target') return stream?.release?.binaries?.targets.includes(option.target) ?? false;
	return (option.kind === 'package' ? stream?.packages : stream?.required)?.includes(option.package) ?? false;
}
export function bodyChoices(body: string, options: SetupOption[], base: SetupChoices): SetupChoices {
	const known = new Set(options.map(optionId));
	const ticked = new Map<string, boolean>();
	for (const [, mark, id] of body.matchAll(/^[ \t]*[-*+] \[([ xX])\] <!-- beepboop:choice:([^\s>]+) -->/gm)) {
		if (id && known.has(id) && !ticked.has(id)) ticked.set(id, mark !== ' ');
	}
	const state = (option: SetupOption) => ticked.get(optionId(option)) ?? selected(option, base);
	return {
		streams: base.streams.map(stream => {
			const own = options.filter(option => option.stream === stream.name);
			const pick = (kind: 'package' | 'required', current: string[]) => {
				const offered = own.flatMap(option =>
					option.kind === kind && (option.kind === 'package' || option.kind === 'required') ? [option.package] : []
				);
				return [...new Set([...current, ...offered])].filter(id => state({ kind, stream: stream.name, package: id }));
			};
			const packages = pick('package', stream.packages);
			const binding = (operation: Operation): SetupWorkflow | undefined => {
				const current = stream[operation];
				const candidates = own.flatMap(option =>
					option.kind === 'workflow' && option.operation === operation ? [option] : []
				);
				if (current && !candidates.some(option => option.file === current.file)) return current;
				const chosen = candidates.filter(state);
				const next = chosen.find(option => option.file !== current?.file) ?? chosen[0];
				if (!next) return undefined;
				if (next.file === current?.file) return current;
				return {
					file: next.file,
					...(next.job === undefined ? {} : { job: next.job }),
					triggers: 'review',
					commands: '',
					publicationSteps: {},
				};
			};
			const handover = (operation: Operation, chosen: SetupWorkflow | undefined): SetupWorkflow | undefined => {
				if (!chosen) return undefined;
				const ticked = own.flatMap(option =>
					option.kind === 'triggers' && option.operation === operation && state(option) ? [option.value] : []
				);
				const value = ticked.find(value => value !== chosen.triggers) ?? ticked[0] ?? chosen.triggers;
				return value === chosen.triggers ? chosen : { ...chosen, triggers: value };
			};
			const built = (chosen: SetupWorkflow | undefined): SetupWorkflow | undefined => {
				const offered = own.flatMap(option => option.kind === 'binary' ? [option] : []);
				if (!chosen || !offered.length) return chosen;
				const kept = offered.filter(state);
				const builds = kept.map(option =>
					chosen.binaries?.builds.find(build => build.name === option.build.name) ?? option.build
				);
				const ticked = own.flatMap(option => option.kind === 'target' && state(option) ? [option.target] : []);
				const targets = ticked.length || chosen.binaries
					? ticked
					: defaultBinaryTargets.filter(target => kept.every(option => option.targets.includes(target)));
				const { binaries: _binaries, ...rest } = chosen;
				return builds.length && targets.length ? { ...rest, binaries: { builds, targets } } : rest;
			};
			const prepare = handover('prepare', binding('prepare')),
				releaseWorkflow = built(handover('release', binding('release')));
			const versions = own.flatMap(option => option.kind === 'versioning' && state(option) ? [option.value] : []);
			const policies = own.flatMap(option => option.kind === 'approval' && state(option) ? [option.value] : []);
			const approval = policies.find(value => value !== stream.approval) ?? policies[0];
			const starting = own.flatMap(option => option.kind === 'start' ? [option] : []);
			const starts = starting.filter(state).map(option => option.value);
			const start = starting.length ? starts.length || stream.start ? starts : undefined : stream.start;
			const bumps = own.flatMap(option => option.kind === 'bump' && state(option) ? [option.value] : []);
			const bump = bumps.find(value => value !== stream.bump) ?? bumps[0];
			const merges = own.flatMap(option => option.kind === 'versionPrMerge' && state(option) ? [option.value] : []);
			const merge = merges.find(value => value !== (stream.versionPrMerge ?? 'manual')) ?? merges[0]
				?? stream.versionPrMerge;
			const {
				prepare: _prepare,
				release: _release,
				observe: _observe,
				approval: _approval,
				start: _start,
				bump: _bump,
				versionPrMerge: _merge,
				...kept
			} = stream;
			return {
				...kept,
				...(approval ? { approval } : {}),
				...(start ? { start } : {}),
				...(bump ? { bump } : {}),
				...(merge && (merge !== 'manual' || stream.versionPrMerge) ? { versionPrMerge: merge } : {}),
				name: stream.name,
				packages,
				versioning: versions.find(value => value !== stream.versioning) ?? versions[0] ?? stream.versioning,
				required: stream.observe
					? [
						...stream.required.filter(id => packages.includes(id)),
						...packages.filter(id => !stream.packages.includes(id) && !stream.required.includes(id)),
					]
					: packages,
				...(stream.versionSource ? { versionSource: stream.versionSource } : {}),
				...(stream.observe
					? {
						observe: stream.observe.map(entry => ({
							...entry,
							publications: entry.publications.filter(id =>
								packages.includes(id)
								|| !own.some(option => option.kind === 'package' && option.package === id)
							),
						})),
					}
					: {}),
				...(prepare ? { prepare } : {}),
				...(releaseWorkflow ? { release: releaseWorkflow } : {}),
			};
		}),
		...(base.actionsRevision ? { actionsRevision: base.actionsRevision } : {}),
	};
}
