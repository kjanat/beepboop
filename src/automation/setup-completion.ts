import { gateJobs, workflowJobs } from '@/automation/job-gate';
import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { ReleaseGraph } from '@/automation/release-graph/graph';
import { ledgerCommand } from '@/automation/setup-defaults';
import type { SetupChoices } from '@/automation/setup-types';
import type { Inventory, Package, Snapshot } from '@/automation/types';
import { isLockfile } from '@/contract/catalog';
import { parentDirectory } from '@/relative-path';

type Stream = SetupChoices['streams'][number];

const lockCommands: [RegExp, string][] = [
	[/(?:^|\/)Cargo\.lock$/, 'cargo update --workspace'],
	[/(?:^|\/)package-lock\.json$/, 'npm install --package-lock-only'],
	[/(?:^|\/)bun\.lock$/, 'bun install'],
	[/(?:^|\/)pnpm-lock\.yaml$/, 'pnpm install --lockfile-only'],
	[/(?:^|\/)yarn\.lock$/, 'yarn install --mode update-lockfile'],
	[/(?:^|\/)uv\.lock$/, 'uv lock'],
];

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
function within(path: string, command: string): string {
	const parent = parentDirectory(path);
	return parent ? `(cd ${quote(parent)} && ${command})` : command;
}
function unusedFile(base: string, taken: string[]): string {
	let file = `${base}.yml`, index = 2;
	while (taken.includes(file)) file = `${base}-${index++}.yml`;
	taken.push(file);
	return file;
}
export function completeTaggedStreams(
	streams: Stream[],
	snapshot: Snapshot,
	inventory: Inventory,
	graph: ReleaseGraph,
): Stream[] {
	const tagged = streams.filter(stream => stream.observe?.some(entry => entry.ref?.startsWith('refs/tags/')));
	const [stream] = tagged;
	if (tagged.length !== 1 || !stream || stream.prepare || stream.promote) return streams;
	const refs = [
		...new Set(
			(stream.observe ?? []).flatMap(entry =>
				entry.ref?.startsWith('refs/tags/') && entry.ref.endsWith('*') ? [entry.ref.slice(10, -1)] : []
			),
		),
	];
	const [tagPrefix] = refs;
	if (refs.length !== 1 || !tagPrefix) return streams;
	const targeted = new Set(graph.streams.flatMap(proposal => proposal.targets.flatMap(target => target.packages)));
	const byId = new Map(inventory.packages.map(pkg => [packageId(pkg), pkg]));
	const versions = new Set(
		stream.packages.flatMap(id => {
			const pkg = byId.get(id);
			return pkg?.version && !pkg.versionSource.startsWith('tags:') ? [pkg.version] : [];
		}),
	);
	const [version] = versions;
	if (versions.size !== 1 || !version) return streams;
	const open = (pkg: Package) =>
		publishable(pkg) && !targeted.has(packageId(pkg)) && !stream.packages.includes(packageId(pkg));
	const order = inventory.publicationOrder;
	const rank = (pkg: Package) => {
		const index = order.indexOf(packageId(pkg));
		return index < 0 ? order.length : index;
	};
	const crates = inventory.packages.filter(pkg => pkg.manager === 'cargo' && open(pkg) && pkg.version === version)
		.sort((left, right) => rank(left) - rank(right));
	if (!crates.length) return streams;
	const modulePrefix = (pkg: Package) => pkg.versionSource.slice('tags:'.length);
	const released = (pkg: Package) => (snapshot.tags ?? []).some(tag => tag.startsWith(modulePrefix(pkg)));
	const modules = inventory.packages.filter(pkg =>
		pkg.manager === 'go' && open(pkg) && pkg.versionSource.startsWith('tags:')
	);
	const added = [...crates, ...modules.filter(pkg => !released(pkg))].map(packageId);
	const taken = inventory.workflows.map(workflow => workflow.file);
	const lockfiles = snapshot.paths.filter(isLockfile);
	const tests = Object.entries(snapshot.files).filter(([path]) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
		.flatMap(([, source]) =>
			[...source.matchAll(/^\s*(?:-\s+)?run:\s*(cargo test\b[^\n#]*)$/gm)].map(match => match[1]?.trim())
		)
		.filter((command): command is string => !!command && !/\$\{\{/.test(command));
	const preparation = [
		...lockfiles.flatMap(path => {
			const command = lockCommands.find(([pattern]) => pattern.test(path))?.[1];
			return command ? [within(path, command)] : [];
		}),
		tests[0] ?? 'cargo test --workspace --locked',
	];
	const joined = modules.filter(pkg => !released(pkg));
	const moduleIds = joined.map(packageId);
	const crateIds = new Map(crates.map(pkg => [pkg.name, packageId(pkg)]));
	const proposal = graph.streams.find(entry => entry.id === stream.name);
	const phases = new Map(
		(proposal?.targets ?? []).flatMap(target => target.packages.map(id => [id, target.phase] as const)),
	);
	const starter = (stream.observe ?? []).find(entry => entry.ref === `refs/tags/${tagPrefix}*`);
	const observed = [...new Set(starter?.publications ?? [])];
	const starterJobs = starter && workflowJobs(snapshot.files[`.github/workflows/${starter.file}`] ?? '');
	const gate = starter && starterJobs
		? gateJobs(
			starterJobs,
			(proposal?.targets ?? []).flatMap(target =>
				target.operations.flatMap(operation =>
					operation.startsWith(`${starter.file}#`) ? [operation.slice(starter.file.length + 1)] : []
				)
			),
		)
		: [];
	const needs: Record<string, string[]> = {};
	const depend = (id: string, dependencies: readonly string[]) => {
		const unique = [...new Set(dependencies)].filter(dependency => dependency !== id);
		if (unique.length) needs[id] = unique;
	};
	for (const id of observed) {
		const phase = phases.get(id) ?? 0;
		depend(id, [...moduleIds, ...observed.filter(other => (phases.get(other) ?? 0) < phase)]);
	}
	for (const pkg of crates) {
		depend(packageId(pkg), [
			...(starter ? gate.length ? moduleIds : observed : []),
			...pkg.dependencies.flatMap(name => crateIds.get(name) ?? []),
		]);
	}
	if (!starter) { for (const id of moduleIds) depend(id, crates.map(packageId)); }
	const publish = {
		triggers: 'review' as const,
		commands: ledgerCommand,
		publicationSteps: {},
		credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' },
	};
	const { versionSource: _, ...rest } = stream;
	const completed: Stream = {
		...rest,
		...(starter
			? { observe: (stream.observe ?? []).map(entry => entry === starter ? { ...entry, needs: ['promote'] } : entry) }
			: {}),
		...(Object.keys(needs).length ? { needs } : {}),
		packages: [...stream.packages, ...added],
		required: [...stream.required, ...added.filter(id => !byId.get(id)?.optional)],
		...(preparation.length
			? {
				prepare: {
					file: unusedFile('prepare-release', taken),
					triggers: 'review',
					commands: preparation.join('\n'),
					publicationSteps: {},
				},
			}
			: {}),
		...(starter
			? {
				promote: {
					file: unusedFile(`release-${stream.name}`, taken),
					triggers: 'review',
					commands: '',
					publicationSteps: {},
					tagPrefix,
				},
				operations: [{
					name: 'crates',
					file: unusedFile('publish-crates', taken),
					...publish,
					needs: [starter.name],
					...(gate.length ? { needsJobs: { [starter.name]: gate } } : {}),
					publications: crates.map(packageId),
				}],
			}
			: { promote: { file: unusedFile('release-crates', taken), ...publish, tagPrefix } }),
	};
	const names = new Set(streams.map(entry => entry.name));
	const independent = modules.filter(released).map((pkg): Stream => {
		const prefix = modulePrefix(pkg);
		const base = prefix.replace(/\/?v$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'go';
		let name = /^[a-z]/.test(base) ? base.slice(0, 64) : `go-${base}`.slice(0, 64), index = 2;
		while (names.has(name)) name = `${base}-${index++}`;
		names.add(name);
		return {
			name,
			packages: [packageId(pkg)],
			versioning: 'workspace',
			required: [packageId(pkg)],
			versionSource: { kind: 'tags', prefix },
			prepare: {
				file: unusedFile(`prepare-${name}`, taken),
				triggers: 'review',
				commands: within(pkg.manifest, 'go mod tidy -diff'),
				publicationSteps: {},
			},
			promote: {
				file: unusedFile(`release-${name}`, taken),
				triggers: 'review',
				commands: '',
				publicationSteps: {},
				tagPrefix: prefix,
			},
		};
	});
	return [...streams.map(entry => entry === stream ? completed : entry), ...independent];
}
