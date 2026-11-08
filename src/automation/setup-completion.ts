import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { ReleaseGraph } from '@/automation/release-graph/graph';
import type { SetupChoices } from '@/automation/setup-types';
import type { Inventory, Package, Snapshot } from '@/automation/types';
import { isLockfile } from '@/contract/catalog';

type Stream = SetupChoices['streams'][number];
type VersionFile = NonNullable<Stream['versionFiles']>[number];

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
	const directory = path.split('/').slice(0, -1).join('/');
	return directory ? `(cd ${quote(directory)} && ${command})` : command;
}
function unusedFile(base: string, taken: string[]): string {
	let file = `${base}.yml`, index = 2;
	while (taken.includes(file)) file = `${base}-${index++}.yml`;
	taken.push(file);
	return file;
}
function normalizedPython(name: string): string {
	return name.toLowerCase().replace(/[-_.]+/g, '-');
}
function pythonVersionFiles(snapshot: Snapshot, names: Set<string>, version: string): VersionFile[] {
	return Object.entries(snapshot.files).flatMap(([path, source]): VersionFile[] => {
		if (!/(?:^|\/)pyproject\.toml$/.test(path) || path.startsWith('.github/') || !source) return [];
		try {
			const project = object(object(parseToml(source)).project);
			return typeof project.name === 'string' && names.has(normalizedPython(project.name))
					&& project.version === version
				? [{ path, format: 'toml', key: ['project', 'version'], template: '{version}' }]
				: [];
		} catch {
			return [];
		}
	});
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
	const modules = inventory.packages.filter(pkg =>
		pkg.manager === 'go' && open(pkg) && pkg.versionSource.startsWith('tags:')
	);
	const added = [...crates, ...modules].map(packageId);
	const taken = inventory.workflows.map(workflow => workflow.file);
	const python = new Set(
		graph.streams.flatMap(proposal =>
			proposal.targets.filter(target => target.destination === 'pypi').flatMap(target =>
				target.names.map(normalizedPython)
			)
		),
	);
	const versionFiles = [...(stream.versionFiles ?? []), ...pythonVersionFiles(snapshot, python, version)];
	const lockfiles = snapshot.paths.filter(isLockfile);
	const preparation = lockfiles.flatMap(path => {
		const command = lockCommands.find(([pattern]) => pattern.test(path))?.[1];
		return command ? [within(path, command)] : [];
	});
	const { versionSource: _, ...rest } = stream;
	const completed: Stream = {
		...rest,
		packages: [...stream.packages, ...added],
		required: [...stream.required, ...added.filter(id => !byId.get(id)?.optional)],
		...(versionFiles.length ? { versionFiles } : {}),
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
		promote: {
			file: unusedFile('release-crates', taken),
			triggers: 'review',
			commands: crates.map(pkg => `cargo publish --locked --package ${quote(pkg.name)}`).join('\n'),
			publicationSteps: {},
			credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' },
			tagPrefix,
		},
	};
	return streams.map(entry => entry === stream ? completed : entry);
}
