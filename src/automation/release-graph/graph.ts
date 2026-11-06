import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import { tagPrefix } from '@/automation/managers/tags';
import { packageId } from '@/automation/package-identity';
import { exclusionLabel, publishable } from '@/automation/package-publication';
import {
	crossesDirectories,
	directoryFlagPattern,
	directoryOverride,
	publishFolder,
	workspaceScope,
	workspaceSelectors,
} from '@/automation/release-graph/package-managers';
import { escapeRegExp, packDirectories, within } from '@/automation/release-graph/shell';
import {
	type Destination,
	declaredWorkspaces,
	inWorkspaces,
	type Job,
	literalPrefix,
	type StepEffect,
	type Workflow,
	workflowModels,
} from '@/automation/release-graph/workflows';
import type { Inventory, Package, Snapshot } from '@/automation/types';

export type EvidenceStatus = 'declared' | 'inferred' | 'conflicting' | 'unresolved';
export interface Evidence {
	status: EvidenceStatus;
	rule: string;
	source: string;
	detail: string;
}
export interface Target {
	destination: Destination;
	selection: 'cited' | 'all';
	names: string[];
	packages: string[];
	variants: string[];
	optionalVariants: string[];
	operations: string[];
	phase: number;
	required: boolean;
	downstream: boolean;
	repository?: string;
	binaries?: string[];
	sources?: Record<string, string[]>;
}
export type Carrier = { path: string; status: 'declared' | 'derived' | 'inferred' };
export interface VersionGroup {
	source: { kind: 'tags'; prefix: string } | { kind: 'file'; path: string } | { kind: 'none' };
	carriers: Carrier[];
	lockstep: EvidenceStatus;
	evidence: Evidence[];
}
export type EntryRole = 'entry' | 'called' | 'recovery' | 'channel' | 'initiator' | 'maintenance';
export interface StreamWorkflow {
	file: string;
	role: EntryRole;
	events: string[];
	tagPatterns: string[];
	branchPatterns: string[];
	starts: string[];
	conditions: Record<string, string>;
}
export interface StreamProposal {
	id: string;
	name: string;
	trigger:
		| { kind: 'tags'; prefix: string; patterns: string[] }
		| { kind: 'release' }
		| { kind: 'dispatch'; workflow: string }
		| { kind: 'schedule'; workflow: string }
		| { kind: 'branch'; workflow: string };
	workflows: StreamWorkflow[];
	channels: string[];
	facets: string[];
	versionGroup: VersionGroup;
	targets: Target[];
	aliases: string[];
	evidence: Evidence[];
	gaps: string[];
}
export interface IncompleteProduct {
	name: string;
	kind: 'vscode-extension' | 'zed-extension';
	manifest: string;
	recipe?: string;
	destinations: Destination[];
	gaps: string[];
}
export interface Omission {
	subject: string;
	reason: string;
}
export interface ReleaseGraph {
	streams: StreamProposal[];
	incomplete: IncompleteProduct[];
	omissions: Omission[];
	mirror?: { producer: string; source: string };
	generators: { source: string; workflows: string[] }[];
	notes: string[];
	unresolved: string[];
}

const entryEvents = ['push', 'release', 'workflow_dispatch', 'schedule', 'workflow_run', 'repository_dispatch'];
const downstreamDestinations: readonly Destination[] = ['aur', 'homebrew', 'scoop', 'winget', 'zed-extensions'];
const optionalDestinations: readonly Destination[] = [...downstreamDestinations, 'docs', 'oci-artifact'];

function code(value: string): string {
	return `\`${value}\``;
}
function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'main';
}
function identifier(value: string): string {
	const result = slug(value);
	return /^[a-z]/.test(result) ? result : `release-${result}`.slice(0, 63);
}

class Graph {
	readonly byFile: ReadonlyMap<string, Workflow>;
	readonly callers = new Map<string, Set<string>>();
	constructor(readonly snapshot: Snapshot, readonly inventory: Inventory, readonly workflows: Workflow[]) {
		this.byFile = new Map(workflows.map(workflow => [workflow.file, workflow]));
		for (const workflow of workflows) {
			for (const job of workflow.jobs) {
				if (!job.calls) continue;
				const set = this.callers.get(job.calls) ?? new Set();
				set.add(workflow.file);
				this.callers.set(job.calls, set);
			}
		}
	}
	jobs(file: string, seen = new Set<string>()): { workflow: string; job: Job }[] {
		if (seen.has(file)) return [];
		seen.add(file);
		const workflow = this.byFile.get(file);
		if (!workflow) return [];
		return workflow.jobs.flatMap(job => [
			{ workflow: file, job },
			...(job.calls ? this.jobs(job.calls, seen) : []),
		]);
	}
	view(job: Job, members: readonly string[]): Job {
		if (!job.callers) return job;
		return {
			...job,
			runs: [
				...job.ownRuns ?? [],
				...job.callers.filter(entry => members.includes(entry.caller)).flatMap(entry => entry.runs),
			],
		};
	}
	memberJobs(file: string, members: readonly string[]): Job[] {
		return (this.byFile.get(file)?.jobs ?? []).map(job => this.view(job, members));
	}
	memberEffects(file: string, members: readonly string[]): { workflow: string; job: Job; effect: StepEffect }[] {
		return this.jobs(file).filter(entry => entry.workflow === file).flatMap(({ workflow, job }) => {
			const effects = job.callers
				? [
					...job.own ?? [],
					...job.callers.filter(entry => members.includes(entry.caller)).flatMap(entry => entry.effects),
				]
				: job.effects;
			return effects.map(effect => ({ workflow, job: this.view(job, members), effect }));
		});
	}
	effects(file: string): { workflow: string; job: Job; effect: StepEffect }[] {
		return this.jobs(file).flatMap(entry => entry.job.effects.map(effect => ({ ...entry, effect })));
	}
	publishes(file: string): boolean {
		return this.effects(file).some(({ effect }) =>
			(effect.kind === 'publish' && effect.destination !== 'docs') || effect.kind === 'release'
			|| effect.kind === 'alias'
		);
	}
	entry(workflow: Workflow): boolean {
		return workflow.events.some(event => entryEvents.includes(event));
	}
	starts(file: string): string[] {
		const workflow = this.byFile.get(file);
		if (!workflow) return [];
		return [
			...new Set([
				...workflow.jobs.flatMap(job => [
					...(job.calls ? [job.calls] : []),
					...job.effects.flatMap(effect => effect.kind === 'dispatch' ? [effect.workflow] : []),
				]),
				...this.workflows.filter(other =>
					other.file !== file && other.workflowRuns.some(source => source === file || source === workflow.name)
				).map(other => other.file),
			]),
		];
	}
}

function tagFamilies(workflow: Workflow): string[] {
	return [...new Set(workflow.tagPatterns.filter(pattern => !pattern.startsWith('!')).map(literalPrefix))];
}

function streamKey(graph: Graph, workflow: Workflow, seen = new Set<string>()): string {
	if (seen.has(workflow.file)) return `workflow:${workflow.file}`;
	seen.add(workflow.file);
	const [family] = tagFamilies(workflow);
	if (family !== undefined) return `tags:${family}`;
	if (workflow.releaseTypes.length || workflow.events.includes('release')) {
		const creators = graph.workflows.filter(candidate =>
			candidate.file !== workflow.file && graph.entry(candidate) && !candidate.events.includes('release')
			&& graph.effects(candidate.file).some(({ effect }) => effect.kind === 'release')
		);
		const tagged = [...new Set(creators.flatMap(tagFamilies))];
		if (tagged.length === 1 && tagged[0] !== undefined) return `tags:${tagged[0]}`;
		const drafting = creators.filter(candidate =>
			graph.effects(candidate.file).some(({ effect }) => effect.kind === 'release' && effect.action === 'create')
		);
		const [creator] = drafting.length === 1 ? drafting : creators.length === 1 ? creators : [];
		if (creator) return streamKey(graph, creator, seen);
		return `release:${workflow.file}`;
	}
	for (const source of workflow.workflowRuns) {
		const upstream = graph.workflows.find(candidate =>
			candidate.file !== workflow.file && (candidate.name === source || candidate.file === source)
		);
		if (upstream) return streamKey(graph, upstream, seen);
	}
	const callers = [...graph.callers.get(workflow.file) ?? []].flatMap(file => graph.byFile.get(file) ?? []);
	const caller = callers.find(candidate => graph.entry(candidate) && graph.publishes(candidate.file));
	if (caller) return streamKey(graph, caller, seen);
	const dispatchers = graph.workflows.filter(candidate =>
		candidate.file !== workflow.file
		&& graph.effects(candidate.file).some(({ effect }) =>
			effect.kind === 'dispatch' && effect.workflow === workflow.file
		)
	);
	if (
		dispatchers.length && workflow.events.every(event => event === 'workflow_dispatch' || event === 'workflow_call')
	) {
		return `dispatch:${workflow.file}`;
	}
	if (workflow.events.includes('push') && workflow.branchPatterns.length && !workflow.events.includes('schedule')) {
		return `branch:${workflow.file}`;
	}
	if (workflow.events.includes('workflow_dispatch') && !workflow.events.includes('schedule')) {
		return `dispatch:${workflow.file}`;
	}
	if (workflow.events.includes('schedule')) return `schedule:${workflow.file}`;
	return `branch:${workflow.file}`;
}

function pyprojects(snapshot: Snapshot): { path: string; name: string; private: boolean }[] {
	return Object.entries(snapshot.files).flatMap(([path, source]) => {
		if (!/(?:^|\/)pyproject\.toml$/.test(path) || path.startsWith('.github/') || !source) return [];
		try {
			const document = object(parseToml(source));
			const project = object(document.project);
			const classifiers = Array.isArray(project.classifiers) ? project.classifiers : [];
			const name = project.name;
			return typeof name === 'string'
				? [{
					path,
					name,
					private: object(object(document.tool).uv).package === false
						|| classifiers.includes('Private :: Do Not Upload'),
				}]
				: [];
		} catch {
			return [];
		}
	});
}
function goreleaserConfigs(snapshot: Snapshot, text: string): string[] {
	if (!/\bgoreleaser(?:\/goreleaser-action@|\s+release\b)/.test(text)) return [];
	const configured = new Set(
		[...text.matchAll(/(?:--config|-f)[= ]["']?([^\s"']+)/g)].flatMap(match => match[1] ?? []),
	);
	return Object.entries(snapshot.files).filter(([path]) =>
		/^(?:\.config\/)?\.?goreleaser\.ya?ml$/.test(path) || configured.has(path)
	).map(([, source]) => source);
}
function cargoBinaries(snapshot: Snapshot): { name: string; manifest: string }[] {
	return Object.entries(snapshot.files).flatMap(([path, source]) => {
		if (!/(?:^|\/)Cargo\.toml$/.test(path) || !source) return [];
		const directory = path.slice(0, -'Cargo.toml'.length);
		try {
			const document = object(parseToml(source));
			const bins = (Array.isArray(document.bin) ? document.bin : []).map(object);
			const declared = bins.flatMap(entry => typeof entry.name === 'string' ? [entry.name] : []);
			const pkg = object(document.package);
			const main = typeof pkg.name === 'string' && pkg.autobins !== false
					&& !bins.some(entry => entry.path === 'src/main.rs')
					&& snapshot.paths.includes(`${directory}src/main.rs`)
				? [pkg.name]
				: [];
			return [...new Set([...declared, ...main])].map(binary => ({ name: binary, manifest: path }));
		} catch {
			return [];
		}
	});
}
function compatibilityNames(snapshot: Snapshot, text: string, binaries: readonly string[]): Map<string, string[]> {
	const scripts = Object.entries(snapshot.files).filter(([path]) =>
		/\.(?:sh|bash|ps1|py|[cm]?[jt]s|rb)$/.test(path) && text.includes(path)
	).map(([, source]) => source);
	const corpus = [text, ...scripts].join('\n');
	const result = new Map<string, string[]>();
	for (const binary of new Set(binaries)) {
		const escaped = escapeRegExp(binary);
		const patterns = [
			new RegExp(`\\bbinary\\s+["']${escaped}["']\\s*,\\s*target:\\s*["']([\\w.-]+)["']`, 'g'),
			new RegExp(`\\[\\s*["']${escaped}(?:\\.exe)?["']\\s*,\\s*["']([\\w.-]+)["']\\s*\\]`, 'g'),
			new RegExp(`\\bln\\s+(?:-\\w+\\s+)*["']?\\S*/${escaped}["']?\\s+["']?\\S*/([\\w.-]+)["']?`, 'g'),
		];
		const names = [
			...new Set(patterns.flatMap(pattern => [...corpus.matchAll(pattern)].flatMap(match => match[1] ?? []))),
		].filter(name => name !== binary && !binaries.includes(name));
		if (names.length) result.set(binary, names.sort());
	}
	return result;
}
function mentions(text: string, name: string): boolean {
	return new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`).test(text);
}
function normalized(name: string): string {
	return `(?<![\\w-])${name.toLowerCase().split(/[-_.]+/).map(escapeRegExp).join('[-_.]')}(?![\\w]|-[A-Za-z])`;
}
function goModules(snapshot: Snapshot): string[] {
	return Object.entries(snapshot.files).flatMap(([path, source]) => {
		if (!/(?:^|\/)go\.mod$/.test(path)) return [];
		const module = /^module\s+(\S+)/m.exec(source)?.[1];
		return module ? [module] : [];
	});
}
function images(text: string, repository: string): string[] {
	const expanded = text.replace(
		/\$\{\{\s*github\.repository\s*\}\}|\$\{(?:GITHUB_REPOSITORY|repository)(?:,,)?\}|\$(?:GITHUB_REPOSITORY|repository)\b/g,
		repository,
	);
	const found = [
		...expanded.matchAll(
			/\b((?:ghcr\.io|docker\.io|quay\.io|registry\.gitlab\.com|public\.ecr\.aws)\/[\w.-]+\/[\w.-]+)(?![\w$.{-])/g,
		),
	].map(match => (match[1] ?? '').toLowerCase());
	return [...new Set(found)];
}
const assetKinds: readonly [RegExp, string][] = [
	[/\.tar\.(?:gz|xz|zst)\b|\.tgz\b/, 'archives'],
	[/\.zip\b/, 'zip archives'],
	[/\.deb\b|nfpm/, 'Debian packages'],
	[/\.whl\b/, 'Python wheels'],
	[/\bplugin\.wasm\b/, 'plugin.wasm'],
	[/\bplugin\.json\b/, 'plugin.json'],
	[/\bschema\.json\b/, 'schema.json'],
	[/\.vsix\b/, 'VSIX packages'],
	[/checksums?|sha256sums|\.sha256\b/i, 'checksums'],
	[/\bsbom\b|\.spdx\b|cyclonedx/i, 'SBOMs'],
	[/\.wasm\b/, 'WebAssembly modules'],
];

const verificationOnly =
	/\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|check|typecheck)|cargo\s+(?:test|clippy|check|fmt)|deno\s+(?:test|lint|check|fmt)|go\s+(?:test|vet))\b/;
function publicationRuns(
	graph: Graph,
	workflow: string,
	found: { workflow: string; job: Job }[],
	members: readonly string[],
	scoped = false,
): string[] {
	const jobs = graph.memberJobs(workflow, members);
	const pending = found.filter(entry => entry.workflow === workflow).map(entry => entry.job.id);
	const reached = new Set<string>();
	while (pending.length) {
		const id = pending.pop();
		if (id === undefined || reached.has(id)) continue;
		reached.add(id);
		pending.push(...(jobs.find(job => job.id === id)?.needs ?? []));
	}
	const own = new Set(found.filter(entry => entry.workflow === workflow).map(entry => entry.job.id));
	return jobs.filter(job => reached.has(job.id) && !(scoped && own.has(job.id))).flatMap(job => job.runs).filter(run =>
		!verificationOnly.test(run) || /\b(?:publish|pack|package|build)\b/.test(run)
	);
}
const qualified = crossesDirectories;
const pathArgument = /\bpublish\s+["']?\$|\bpublish\b[^\n;&|]*\s["']?(?:\.{0,2}\/|[\w.-]+\/|[^\s"']+\.tgz\b)/;
const installing =
	/\b(?:npx|bunx|pnpm\s+(?:dlx|add|i|install)|yarn\s+(?:dlx|add)|npm\s+(?:view|info|show|install|i|ci|add|exec|x))\b/;
function directoryOf(pkg: Package): string {
	return pkg.manifest.split('/').slice(0, -1).join('/');
}
function defaultMembers(snapshot: Snapshot, directory: string): string[] {
	const source = snapshot.files[directory ? `${directory}/Cargo.toml` : 'Cargo.toml'];
	if (source === undefined) return [];
	try {
		const members = object(object(parseToml(source)).workspace)['default-members'];
		return Array.isArray(members)
			? members.flatMap(member => typeof member === 'string' ? [within(directory, member)] : [])
			: [];
	} catch {
		return [];
	}
}
function sourceKey(entry: { workflow: string; job: Job; effect: StepEffect }): string {
	const guard = entry.effect.kind === 'publish' ? entry.effect.condition : undefined;
	return `${entry.workflow}#${entry.job.id}${guard ? `#${guard}` : ''}`;
}
function globMatches(pattern: string, name: string): boolean {
	const source = [...pattern].map(character =>
		character === '*'
			? '.*'
			: character === '?'
			? '.'
			: character === '[' || character === ']'
			? character
			: escapeRegExp(character)
	).join('');
	try {
		return new RegExp(`^${source}$`).test(name);
	} catch {
		return pattern === name;
	}
}
function targetsOf(
	graph: Graph,
	files: string[],
	entries: { workflow: string; job: Job; effect: StepEffect }[],
	phases: ReadonlyMap<string, number>,
): Target[] {
	const { snapshot, inventory } = graph;
	const repository = snapshot.repository.name;
	const text = files.flatMap(file => graph.memberJobs(file, files)).flatMap(job => job.runs).join('\n');
	const publishing = entries.filter(entry => entry.effect.kind === 'publish' || entry.effect.kind === 'release');
	const byDestination = new Map<Destination, typeof publishing>();
	for (const entry of publishing) {
		const destination = entry.effect.kind === 'publish' ? entry.effect.destination : 'github-release';
		byDestination.set(destination, [...byDestination.get(destination) ?? [], entry]);
	}
	const targets: Target[] = [];
	for (const [destination, found] of byDestination) {
		const operations = [...new Set(found.map(entry => `${entry.workflow}#${entry.job.id}`))];
		const phase = Math.min(...found.map(entry => phases.get(`${entry.workflow}#${entry.job.id}`) ?? 0));
		const repositoryTarget =
			found.flatMap(entry =>
				(entry.effect.kind === 'publish' || entry.effect.kind === 'release') && entry.effect.repository
					&& entry.effect.repository.toLowerCase() !== repository.toLowerCase()
					? [entry.effect.repository]
					: []
			)[0];
		const base: Omit<Target, 'names' | 'packages' | 'variants' | 'optionalVariants'> = {
			destination,
			selection: 'cited',
			operations,
			phase,
			downstream: downstreamDestinations.includes(destination),
			required: !optionalDestinations.includes(destination),
			...(repositoryTarget ? { repository: repositoryTarget } : {}),
		};
		const effectText = found.map(entry =>
			`${entry.effect.kind === 'publish' || entry.effect.kind === 'release' ? entry.effect.text : ''}\n${
				entry.job.runs.join('\n')
			}`
		).join('\n');
		const managed = (manager: Package['manager']) =>
			inventory.packages.filter(pkg => pkg.manager === manager && publishable(pkg));
		if (destination === 'npm' || destination === 'jsr' || destination === 'crates-io') {
			const manager = destination === 'npm' ? 'npm' : destination === 'jsr' ? 'jsr' : 'cargo';
			const candidates = managed(manager);
			const selections = [...new Set(found.map(sourceKey))].map(operation => {
				const own = found.filter(entry => sourceKey(entry) === operation);
				const workflow = own[0]?.workflow ?? '';
				const effects = own.map(entry =>
					entry.effect.kind === 'publish' || entry.effect.kind === 'release' ? entry.effect.text : ''
				);
				const runs = publicationRuns(
					graph,
					workflow,
					own,
					files,
					own.some(entry => entry.effect.kind === 'publish' && entry.effect.condition !== undefined),
				);
				const directories = [
					...new Set([
						...own.flatMap(entry => {
							if (entry.effect.kind !== 'publish') return [];
							const base = entry.effect.directory ?? '';
							const override = directoryOverride(entry.effect.text);
							if (override !== undefined) return within(base, override);
							const folder = publishFolder(entry.effect.text);
							const resolved = folder === undefined ? undefined : within(base, folder);
							return resolved !== undefined && candidates.some(pkg => directoryOf(pkg) === resolved)
								? resolved
								: base || [];
						}),
						...runs.flatMap(packDirectories),
					]),
				];
				const commands = effects.join('\n');
				const invoked = own.flatMap(entry =>
					entry.effect.kind === 'publish' || entry.effect.kind === 'release'
						? [{
							command: entry.effect.text,
							directory: entry.effect.kind === 'publish' ? entry.effect.directory ?? '' : '',
						}]
						: []
				);
				const text = [...effects, ...graph.memberJobs(workflow, files).flatMap(job => job.runs)].join('\n');
				const publishing = [...effects, ...runs].join('\n');
				const mentioning = publishing.split('\n').filter(line => !installing.test(line)).join('\n');
				const cites = (value: string) => new RegExp(`(?<![\\w./-])${escapeRegExp(value)}(?![\\w-])`).test(text);
				const citesDirectory = (value: string) =>
					new RegExp(
						`(?:(?:(?:^|[\\s;&|(])(?:${directoryFlagPattern})[= ]|\\b(?:publish|pack)\\s+)["']?(?:\\./)?${
							escapeRegExp(value)
						}/?["']?(?:\\s|$|[;&)])|(?<![\\w./-])${escapeRegExp(value)}/package\\.json)`,
						'm',
					).test(publishing);
				const descriptors = Object.entries(snapshot.files).filter(([path]) =>
					path.endsWith('.json') && !/(?:^|\/)(?:package|deno|jsr|composer|tsconfig[^/]*)\.json$/.test(path)
					&& cites(path)
				).map(([, source]) => source);
				const workspaces = workspaceSelectors(publishing).map(selector =>
					selector.replace(/^\.\//, '').replace(/\/$/, '')
				);
				const covered = (pkg: Package) =>
					workspaces.some(selector =>
						selector === pkg.name || (directoryOf(pkg) !== ''
							&& (directoryOf(pkg) === selector || directoryOf(pkg).startsWith(`${selector}/`)))
					)
					|| (pkg.name.startsWith('@')
						&& new RegExp(`(?<![\\w@/.-])${escapeRegExp(pkg.name)}(?![\\w-])`).test(mentioning))
					|| (!!pkg.generated
						&& (directoryOf(pkg)
							? new RegExp(`(?<![\\w./-])${escapeRegExp(directoryOf(pkg))}/`).test(text)
							: cites(pkg.manifest)))
					|| (directoryOf(pkg) !== ''
						&& (directories.includes(directoryOf(pkg)) || citesDirectory(directoryOf(pkg))))
					|| descriptors.some(source => new RegExp(`"${escapeRegExp(pkg.name)}"(?!\\s*:)`).test(source));
				if (manager === 'cargo') {
					const packed = [...new Set(runs.flatMap(packDirectories))];
					const resolve = ({ command, directory }: { command: string; directory: string }) => {
						const named = [...command.matchAll(/(?:-p|--package)(?:\s+|=)["']?([\w-]+)/g)].flatMap(match =>
							match[1] ?? []
						);
						const manifests = [...command.matchAll(/--manifest-path[= ]["']?(?:\.\/)?([^\s"';&|]*Cargo\.toml)/g)]
							.flatMap(match => within(directory, match[1] ?? ''));
						const everyCrate = /--workspace\b|--all\b/.test(command);
						const scope = directory ? [directory] : packed.length ? packed : [''];
						const excluded = everyCrate
							? [...command.matchAll(/--exclude[= ]["']?([^\s"';&|]+)/g)].flatMap(match => match[1] ?? [])
							: [];
						return (named.length && named.every(name => candidates.some(pkg => pkg.name === name))
							? candidates.filter(pkg => named.includes(pkg.name))
							: !everyCrate && manifests.length
									&& manifests.every(path => candidates.some(pkg => pkg.manifest === path))
							? candidates.filter(pkg => manifests.includes(pkg.manifest))
							: !everyCrate && scope.includes(directory) && defaultMembers(snapshot, directory).length
							? candidates.filter(pkg => inWorkspaces(defaultMembers(snapshot, directory), directoryOf(pkg)))
							: !everyCrate && scope.every(path => candidates.some(pkg => directoryOf(pkg) === path))
							? candidates.filter(pkg => scope.includes(directoryOf(pkg)))
							: candidates).filter(pkg => !excluded.some(pattern => globMatches(pattern, pkg.name)));
					};
					const resolved = (invoked.length ? invoked : [{ command: '', directory: '' }]).map(resolve);
					return {
						operation,
						packages: candidates.filter(pkg => resolved.some(list => list.includes(pkg))),
						cited: true,
					};
				}
				const root = candidates.filter(pkg => directoryOf(pkg) === '');
				const rooted = own.some(entry =>
					entry.effect.kind === 'publish' && !entry.effect.directory && !qualified.test(entry.effect.text)
					&& !pathArgument.test(entry.effect.text)
				);
				const scope = workspaceScope(commands);
				const nested = scope.all || scope.recursive
					? candidates.filter(pkg =>
						inWorkspaces(declaredWorkspaces(snapshot), directoryOf(pkg))
						|| (scope.root && directoryOf(pkg) === '')
					)
					: [];
				const chosen = candidates.filter(pkg => covered(pkg) || (rooted && root.includes(pkg)) || nested.includes(pkg));
				const elsewhere = directories.length > 0 || qualified.test(commands);
				return chosen.length
					? { operation, packages: chosen, cited: true }
					: root.length && !elsewhere
					? { operation, packages: root, cited: true }
					: { operation, packages: candidates, cited: false };
			});
			const packages = candidates.filter(pkg => selections.some(selection => selection.packages.includes(pkg)));
			const selection: Target['selection'] = selections.every(entry => entry.cited) ? 'cited' : 'all';
			if (!packages.length) {
				const workflowText = [...new Set(found.map(entry => entry.workflow))].flatMap(workflow =>
					graph.memberJobs(workflow, files).flatMap(job => job.runs)
				).join('\n');
				const cited = destination === 'npm'
					? [
						...new Set(
							[
								...workflowText.matchAll(
									/\bnpm\s+(?:view|info|show|dist-tag\s+add)\s+["']?((?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*)/g,
								),
								...workflowText.matchAll(/npmjs\.com\/package\/((?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*)/g),
							].flatMap(match => match[1] ?? []),
						),
					]
					: [];
				targets.push({
					...base,
					selection: cited.length ? 'cited' : selection,
					names: cited,
					packages: [],
					variants: [],
					optionalVariants: [],
				});
				continue;
			}
			const depth = new Map<string, number>();
			const level = (pkg: Package, seen = new Set<string>()): number => {
				const known = depth.get(pkg.name);
				if (known !== undefined) return known;
				if (seen.has(pkg.name)) return 0;
				seen.add(pkg.name);
				const result = Math.max(
					0,
					...pkg.dependencies.flatMap(name => {
						const dependency = packages.find(candidate => candidate.name === name);
						return dependency ? [level(dependency, seen) + 1] : [];
					}),
				);
				depth.set(pkg.name, result);
				return result;
			};
			const levels = new Map<string, { offset: number; group: Package[] }>();
			for (const pkg of packages) {
				const platform = !!pkg.generated && pkg.dependencies.length === 0;
				const key = `${level(pkg)}:${platform ? 1 : 0}`;
				const entry = levels.get(key) ?? { offset: level(pkg), group: [] };
				entry.group.push(pkg);
				levels.set(key, entry);
			}
			for (const [, { offset, group }] of [...levels].sort(([a], [b]) => a.localeCompare(b))) {
				const variants = group.filter(pkg => pkg.generated && pkg.dependencies.length === 0);
				targets.push({
					...base,
					selection,
					phase: phase + offset / 100,
					names: variants.length === group.length
						? [`${variants.length} generated platform packages`]
						: group.map(pkg => pkg.name),
					packages: group.map(packageId),
					variants: variants.map(pkg => pkg.name),
					optionalVariants: group.filter(pkg => pkg.optional).map(pkg => pkg.name),
					sources: Object.fromEntries(
						selections.map(entry => [
							entry.operation,
							group.filter(pkg => entry.packages.includes(pkg)).map(packageId),
						]),
					),
				});
			}
			continue;
		}
		if (destination === 'pypi') {
			const projects = pyprojects(snapshot).filter(project => !project.private);
			const matched = projects.filter(project =>
				new RegExp(normalized(project.name), 'i').test(effectText)
				|| new RegExp(normalized(project.name), 'i').test(found.map(entry => entry.workflow).join(' '))
			);
			const declared = [
				...new Set(
					[...effectText.matchAll(/pypi\.org\/(?:project|p)\/([A-Za-z0-9](?:[\w.-]*[A-Za-z0-9])?)(?=\/|\s|$)/g)]
						.flatMap(match => match[1] ?? []),
				),
			];
			const located = projects.filter(project => {
				const directory = escapeRegExp(project.path.split('/').slice(0, -1).join('/'));
				return directory !== '' && new RegExp(
					`(?:\\b(?:cd|--directory|--project|-C)\\s+["']?(?:\\./)?${directory}/?["']?(?:\\s|$|[;&)])|(?<![\\w./-])${directory}/(?:dist|pyproject\\.toml)\\b)`,
					'm',
				).test(effectText);
			});
			const chosen = declared.length
				? declared
				: matched.length
				? matched.map(project => project.name)
				: located.length
				? located.map(project => project.name)
				: projects.filter(project => project.path === 'pyproject.toml').map(project => project.name);
			targets.push({
				...base,
				names: chosen,
				packages: chosen.map(name => `pkg:pypi/${name.toLowerCase().replace(/[-_.]+/g, '-')}`),
				variants: [],
				optionalVariants: [],
			});
			continue;
		}
		if (destination === 'oci' || destination === 'oci-artifact') {
			const names = images(effectText, repository);
			targets.push({
				...base,
				names: names.length ? names : [`ghcr.io/${repository.toLowerCase()}`],
				packages: [],
				variants: [],
				optionalVariants: [],
			});
			continue;
		}
		if (destination === 'github-release') {
			const releaseText = `${text}\n${effectText}`;
			const goreleaser = goreleaserConfigs(snapshot, releaseText);
			const kindsText = [releaseText, ...goreleaser].join('\n');
			const matched = assetKinds.filter(([pattern]) => pattern.test(kindsText)).map(([, label]) => label);
			const kinds = matched.includes('plugin.wasm') ? matched.filter(kind => kind !== 'WebAssembly modules') : matched;
			const callerText = files.flatMap(file => graph.jobs(file)).filter(({ job }) =>
				found.some(entry => job.calls === entry.workflow)
			).flatMap(({ job }) => job.runs).join('\n');
			const shipping = `${effectText}\n${callerText}`.split('\n').filter(line => !/\bcargo\s+(?:run|r)\b/.test(line))
				.join('\n');
			const binaries = [
				...new Set(cargoBinaries(snapshot).map(binary => binary.name).filter(name => mentions(shipping, name))),
			];
			const releaseRepository = (entry: typeof found[number]) =>
				entry.effect.kind === 'release' && entry.effect.repository
					&& entry.effect.repository.toLowerCase() !== repository.toLowerCase()
					? entry.effect.repository
					: '';
			const { repository: _foreign, ...shared } = base;
			for (const target of [...new Set(found.map(releaseRepository))]) {
				const subset = found.filter(entry => releaseRepository(entry) === target);
				targets.push({
					...shared,
					operations: [...new Set(subset.map(entry => `${entry.workflow}#${entry.job.id}`))],
					phase: Math.min(...subset.map(entry => phases.get(`${entry.workflow}#${entry.job.id}`) ?? 0)),
					...(target ? { repository: target } : binaries.length ? { binaries } : {}),
					names: [target ? `${target} releases` : `${repository} releases`],
					packages: target
						? []
						: inventory.packages.filter(pkg => pkg.manager === 'github-release' || pkg.manager === 'goreleaser')
							.filter(publishable).map(packageId),
					variants: kinds,
					optionalVariants: [],
				});
			}
			continue;
		}
		if (destination === 'go-proxy') {
			const modules = goModules(snapshot);
			targets.push({
				...base,
				names: modules,
				packages: managed('go').filter(pkg => modules.includes(pkg.name)).map(packageId),
				variants: [],
				optionalVariants: [],
			});
			continue;
		}
		if (destination === 'vscode-marketplace' || destination === 'open-vsx') {
			const extensions = managed('vscode');
			const textOf = (subset: typeof found) =>
				subset.map(entry =>
					`${entry.effect.kind === 'publish' || entry.effect.kind === 'release' ? entry.effect.text : ''}\n${
						entry.job.runs.join('\n')
					}`
				).join('\n');
			const choose = (subset: typeof found) => {
				const subsetText = textOf(subset);
				const directories = new Set(
					subset.flatMap(entry => entry.effect.kind === 'publish' ? entry.effect.directory ?? [] : []),
				);
				const rooted = subset.some(entry => entry.effect.kind === 'publish' && !entry.effect.directory);
				const located = extensions.filter(pkg =>
					directories.has(directoryOf(pkg))
					|| mentions(subsetText, pkg.name)
					|| (directoryOf(pkg) !== ''
						&& new RegExp(`(?<![\\w./-])${escapeRegExp(directoryOf(pkg))}(?![\\w-])`).test(subsetText))
				);
				return located.length
					? located
					: rooted && extensions.some(pkg => directoryOf(pkg) === '')
					? extensions.filter(pkg => directoryOf(pkg) === '')
					: extensions;
			};
			const chosen = choose(found);
			targets.push({
				...base,
				names: chosen.length ? chosen.map(pkg => pkg.name) : [destination],
				packages: chosen.map(packageId),
				variants: [],
				optionalVariants: [],
				sources: Object.fromEntries(
					[...new Set(found.map(sourceKey))].map(operation => [
						operation,
						choose(found.filter(entry => sourceKey(entry) === operation)).map(packageId),
					]),
				),
			});
			continue;
		}
		targets.push({ ...base, names: [destination], packages: [], variants: [], optionalVariants: [] });
	}
	return targets.sort((a, b) => a.phase - b.phase || a.destination.localeCompare(b.destination));
}

function phasesOf(graph: Graph, files: string[]): Map<string, number> {
	const result = new Map<string, number>();
	const visit = (file: string, offset: number, seen: Set<string>) => {
		if (seen.has(file)) return;
		seen.add(file);
		const workflow = graph.byFile.get(file);
		if (!workflow) return;
		const depth = new Map<string, number>();
		const of = (job: Job, trail = new Set<string>()): number => {
			const known = depth.get(job.id);
			if (known !== undefined) return known;
			if (trail.has(job.id)) return 0;
			trail.add(job.id);
			const value = Math.max(
				0,
				...job.needs.flatMap(name => {
					const needed = workflow.jobs.find(candidate => candidate.id === name);
					return needed ? [of(needed, trail) + 1] : [];
				}),
			);
			depth.set(job.id, value);
			return value;
		};
		for (const job of workflow.jobs) {
			const value = offset + of(job);
			const key = `${file}#${job.id}`;
			result.set(key, Math.min(result.get(key) ?? value, value));
			if (job.calls) visit(job.calls, value + 1, new Set(seen));
		}
	};
	const starts = files.filter(file =>
		!files.some(other => other !== file && graph.jobs(other).some(entry => entry.job.calls === file))
	);
	const later = (file: string) => {
		const workflow = graph.byFile.get(file);
		return !!workflow && (workflow.events.includes('release') || workflow.events.includes('workflow_run'));
	};
	const roots = starts.length ? starts : files;
	for (const file of roots.filter(file => !later(file))) visit(file, 0, new Set());
	const after = Math.max(-1, ...result.values()) + 1;
	for (const file of roots.filter(later)) visit(file, after, new Set());
	return result;
}

function carrierPaths(graph: Graph, files: string[]): string[] {
	const { snapshot } = graph;
	const scripts = files.flatMap(file => graph.jobs(file)).flatMap(({ job }) => job.actions);
	const declared = new Set<string>();
	const carrier =
		/(?:^|\/)(?:package\.json|tree-sitter\.json|Makefile|CMakeLists\.txt|pyproject\.toml|build\.zig\.zon|pom\.xml|extension\.toml|Cargo\.toml|deno\.jsonc?|jsr\.json|[^/]+\.csproj|VERSION|version\.txt)$/;
	const quoted = (source: string, value: string) =>
		source.includes(`'${value}'`) || source.includes(`"${value}"`) || source.includes(`\`${value}\``);
	const candidates = snapshot.paths.filter(candidate => carrier.test(candidate));
	for (const action of new Set(scripts)) {
		if (!/version|carrier/i.test(action)) continue;
		for (const [path, source] of Object.entries(snapshot.files)) {
			if (!path.startsWith(`${action}/`)) continue;
			for (const candidate of candidates) {
				const name = candidate.slice(candidate.lastIndexOf('/') + 1);
				const parent = candidate.split('/').slice(-2, -1)[0];
				if (
					quoted(source, candidate)
					|| (parent !== undefined && quoted(source, parent) && source.includes(`/${name}\``))
				) declared.add(candidate);
			}
		}
	}
	for (const { job } of files.flatMap(file => graph.jobs(file))) {
		for (const run of job.runs) {
			if (
				!/\b(?:bump|set-version|npm\s+version|cargo\s+set-version|sed\b[^\n]*version|version\s*[:=]\s*["'$])/i.test(run)
			) continue;
			const quotedCarriers = candidates.filter(candidate => quoted(run, candidate));
			if (quotedCarriers.length >= 2) { for (const path of quotedCarriers) declared.add(path); }
		}
	}
	return [...declared].sort();
}

function versionGroupOf(
	graph: Graph,
	files: string[],
	trigger: StreamProposal['trigger'],
	targets: Target[],
): VersionGroup {
	const { snapshot, inventory } = graph;
	const evidence: Evidence[] = [];
	const ids = new Set(targets.flatMap(target => target.packages));
	const packages = inventory.packages.filter(pkg => ids.has(packageId(pkg)));
	const carriers = new Map<string, Carrier['status']>();
	for (const path of carrierPaths(graph, files)) carriers.set(path, 'declared');
	if (carriers.size) {
		evidence.push({
			status: 'declared',
			rule: 'version-check script',
			source: files.join(', '),
			detail: `A version check lists ${carriers.size} version carriers.`,
		});
	}
	const workspace = object(
		(() => {
			try {
				return parseToml(snapshot.files['Cargo.toml'] ?? '');
			} catch {
				return {};
			}
		})(),
	).workspace;
	const inherited = typeof object(object(workspace).package).version === 'string';
	for (const pkg of packages) {
		const source = tagPrefix(pkg.versionSource) === undefined ? pkg.versionSource.split('#')[0] ?? '' : '';
		if (!source || carriers.has(source)) continue;
		const status: Carrier['status'] = pkg.generated
			? 'derived'
			: pkg.manager === 'cargo' && inherited && pkg.versionSource.startsWith('Cargo.toml#workspace')
			? 'declared'
			: 'inferred';
		carriers.set(pkg.generated ? pkg.manifest : source, status);
	}
	for (const pkg of packages.filter(pkg => pkg.manager === 'jsr' && !pkg.generated)) {
		const manifest = pkg.manifest;
		const derived = files.flatMap(file => graph.jobs(file)).some(({ job }) =>
			job.runs.some(run =>
				run.includes(manifest.split('/').pop() ?? manifest) && /write|generate|sync|version/i.test(run)
			)
		);
		if (derived) carriers.set(manifest, 'derived');
	}
	if (inherited && packages.some(pkg => pkg.manager === 'cargo')) {
		evidence.push({
			status: 'declared',
			rule: 'Cargo workspace inheritance',
			source: 'Cargo.toml',
			detail: 'Crates inherit `workspace.package.version`.',
		});
	}
	const statuses = [...carriers.values()];
	const versions = new Set(packages.filter(pkg => !pkg.generated).flatMap(pkg => pkg.version ? [pkg.version] : []));
	const fileVersions = new Set(
		packages.flatMap(pkg =>
			!pkg.generated && tagPrefix(pkg.versionSource) === undefined && pkg.version ? [pkg.version] : []
		),
	);
	const lockstep: EvidenceStatus = carriers.size > 1 && fileVersions.size > 1
		? 'conflicting'
		: statuses.filter(status => status === 'inferred').length <= 1
		? 'declared'
		: versions.size > 1
		? 'conflicting'
		: 'unresolved';
	if (lockstep === 'unresolved') {
		evidence.push({
			status: 'unresolved',
			rule: 'matching versions',
			source: [...carriers].filter(([, status]) => status === 'inferred').map(([path]) => path).join(', '),
			detail: 'These manifests carry the same version, but nothing in the repository keeps them equal.',
		});
	}
	if (lockstep === 'conflicting') {
		evidence.push({
			status: 'conflicting',
			rule: 'distinct versions',
			source: [...carriers.keys()].join(', '),
			detail: `Selected packages carry versions ${[...versions].map(code).join(', ')}.`,
		});
	}
	const counts = new Map<string, number>();
	for (const tag of snapshot.tags ?? []) {
		const prefix = /^(.*?)v?\d+\.\d+\.\d+/.exec(tag)?.[1];
		if (prefix !== undefined) {
			const full = tag.slice(prefix.length).startsWith('v') ? `${prefix}v` : prefix;
			counts.set(full, (counts.get(full) ?? 0) + 1);
		}
	}
	const ranked = trigger.kind === 'release'
			|| (trigger.kind !== 'tags' && targets.some(target => target.destination === 'github-release'))
		? [...counts].sort(([, a], [, b]) => b - a).map(([prefix]) => prefix)
		: [];
	const releasePrefix = trigger.kind === 'release' && ranked.length > 1 ? '' : ranked[0];
	if (releasePrefix !== undefined) {
		evidence.push({
			status: 'inferred',
			rule: 'release tags',
			source: 'repository tags',
			detail: `The stream creates GitHub releases, and existing release tags start with ${code(releasePrefix)}.`,
		});
	}
	const fileSource = [...carriers].find(([, status]) => status === 'declared')?.[0]
		?? [...carriers].find(([, status]) => status === 'inferred')?.[0];
	return {
		source: trigger.kind === 'tags'
			? { kind: 'tags', prefix: trigger.prefix }
			: releasePrefix !== undefined
			? { kind: 'tags', prefix: releasePrefix }
			: fileSource
			? { kind: 'file', path: fileSource }
			: { kind: 'none' },
		carriers: [...carriers].map(([path, status]) => ({ path, status })).sort((a, b) => a.path.localeCompare(b.path)),
		lockstep,
		evidence,
	};
}

function streamName(key: string, members: Workflow[], repository: string): string {
	const [kind, value = ''] = key.split(/:(.*)/s);
	if (kind === 'tags') {
		const stem = value.replace(/[-_/.]?v?$/, '');
		return stem ? identifier(stem) : 'main';
	}
	const file = (value || members[0]?.file || 'release').replace(/\.ya?ml$/, '');
	const stem = file.replace(/(?:^|[-_])(?:publish|release|deploy)(?:[-_]|$)/g, '-').replace(/^-+|-+$/g, '');
	if (stem && !/^(?:ci|main|build|prepare|nightly|snapshot)$/.test(stem)) return identifier(stem);
	return identifier(repository.split('/').pop() ?? 'main');
}

function facetsOf(graph: Graph, files: string[], targets: Target[]): string[] {
	const text = files.flatMap(file => graph.jobs(file)).flatMap(({ job }) => job.runs).join('\n')
		+ Object.entries(graph.snapshot.files).filter(([path]) => /goreleaser|nfpm/.test(path)).map(([, source]) => source)
			.join('\n');
	const facets = new Set<string>();
	if (/\bplugin\.wasm\b|wasm32-(?:unknown|wasip)/.test(text)) facets.add('wasm-plugin');
	if (/\bplugin\.json\b/.test(text) && /checksum/i.test(text)) facets.add('process-plugin');
	if (/\bnfpm|\.deb\b|debuild/.test(text)) facets.add('debian-package');
	if (targets.some(target => target.destination === 'oci')) facets.add('container-image');
	if (targets.some(target => target.destination === 'oci-artifact')) facets.add('oci-binary-artifact');
	if (targets.some(target => target.variants.some(variant => /linux|darwin|win32|windows/.test(variant)))) {
		facets.add('native-platform-packages');
	}
	if (/\bskip:\s*true\b/.test(text) && /goreleaser/i.test(text)) facets.add('no-native-go-binary');
	if (
		/\btree-sitter\b/.test(text)
		|| graph.snapshot.paths.some(path => /(?:^|\/)grammars?\/[^/]+\/grammar\.js$/.test(path))
	) {
		facets.add('grammar');
	}
	return [...facets].sort();
}

const dependencyManifest =
	/(?:^|\/)(?:Cargo\.(?:toml|lock)|go\.(?:mod|sum)|package\.json|[\w.-]*lock[\w.-]*|deno\.jsonc?)$/;
function workflowEvidence(workflow: Workflow): Evidence[] {
	const evidence: Evidence[] = [];
	const file = workflow.file;
	const manifests = workflow.pathPatterns.filter(pattern => dependencyManifest.test(pattern));
	if (workflow.branchPatterns.length && manifests.length) {
		evidence.push({
			status: 'declared',
			rule: 'dependency-driven initiation',
			source: file,
			detail: `${code(file)} starts a release when ${manifests.map(code).join(', ')} changes on ${
				workflow.branchPatterns.map(code).join(', ')
			}. A dependency update starts the release, and the dependency revision stays separate from this product's version.`,
		});
	}
	const text = workflow.jobs.flatMap(job => job.runs).join('\n');
	const commits = /["']commit["']|\bgit\s+(?:-c\s+\S+\s+)*commit\b/.test(text);
	const tagOnly = /\bpush\b[^\n]*refs\/tags\//.test(text)
		&& !/\bpush\b[^\n]*(?:\bHEAD\b|refs\/heads\/|--all\b|github\.ref_name|\bmaster\b|\bmain\b)/.test(text);
	if (commits && tagOnly) {
		evidence.push({
			status: 'declared',
			rule: 'prepared release commit',
			source: file,
			detail: `${
				code(file)
			} commits the version bump and pushes only the release tag. The released commit is not on the source branch, so the tag's commit is the release source.`,
		});
	}
	if (/\bgit\s+bundle\s+(?:create|verify)\b/.test(text)) {
		evidence.push({
			status: 'declared',
			rule: 'prepared candidate',
			source: file,
			detail: `${
				code(file)
			} builds a candidate commit and carries it as a Git bundle. The version tag points at that tested candidate, which differs from the source commit it was prepared from.`,
		});
	}
	const embedded = [
		...new Set(
			[
				...text.matchAll(/\bgo\s+list\s+-m\b[^\n]*?\s["']?([a-z0-9.-]+\.[a-z]{2,}\/[^\s'"()]+)/g),
				...text.matchAll(/\bcargo\s+pkgid\s+["']?([\w-]+)/g),
			].flatMap(match => match[1] ?? []),
		),
	];
	if (embedded.length) {
		evidence.push({
			status: 'declared',
			rule: 'embedded dependency version',
			source: file,
			detail: `${code(file)} records the version of ${
				embedded.map(code).join(', ')
			} in the release. That version describes the bundled engine and is distinct from the release's own version.`,
		});
	}
	return evidence;
}

export function inferReleaseGraph(snapshot: Snapshot, inventory: Inventory): ReleaseGraph {
	const workflows = workflowModels(snapshot);
	const graph = new Graph(snapshot, inventory, workflows);
	const omissions: Omission[] = [];
	const unresolved: string[] = [];
	const groups = new Map<string, Workflow[]>();
	const initiators: { workflow: Workflow; dispatches: string[]; tags: boolean }[] = [];
	for (const workflow of workflows) {
		const effects = graph.effects(workflow.file);
		const previews = effects.filter(({ effect }) => effect.kind === 'preview');
		if (previews.length && workflow.events.every(event => /^pull_request/.test(event) || event === 'push')) {
			omissions.push({
				subject: code(workflow.file),
				reason: 'publishes pull-request preview packages, which are not releases',
			});
			continue;
		}
		if (!graph.entry(workflow)) continue;
		if (!graph.publishes(workflow.file)) {
			const dispatches = effects.flatMap(({ effect }) => effect.kind === 'dispatch' ? [effect.workflow] : []);
			const tags = effects.some(({ effect }) => effect.kind === 'tag');
			if (dispatches.length || (tags && workflow.events.some(event => event !== 'pull_request'))) {
				initiators.push({ workflow, dispatches, tags });
			} else if (effects.some(({ effect }) => effect.kind === 'publish' && effect.destination === 'docs')) {
				omissions.push({ subject: code(workflow.file), reason: 'deploys documentation outside a release' });
			}
			continue;
		}
		if (workflow.events.every(event => /^pull_request/.test(event))) continue;
		const own = effects.filter(entry => entry.workflow === workflow.file).map(entry => entry.effect);
		const callees = [...new Set(workflow.jobs.flatMap(job => job.calls ? [job.calls] : []))];
		const tagged = new Set(
			workflows.filter(candidate => candidate.file !== workflow.file && tagFamilies(candidate).length)
				.flatMap(candidate => graph.jobs(candidate.file).map(entry => entry.workflow)),
		);
		const shared = callees.length > 0 && callees.every(callee =>
			tagged.has(callee)
			&& !graph.effects(callee).some(({ effect }) => effect.kind === 'publish' || effect.kind === 'release')
		);
		if (
			shared && !own.some(effect => effect.kind === 'publish' || effect.kind === 'release' || effect.kind === 'alias')
		) {
			omissions.push({
				subject: code(workflow.file),
				reason: 'runs the shared build of a tagged release without publishing anything itself',
			});
			continue;
		}
		const key = streamKey(graph, workflow);
		groups.set(key, [...groups.get(key) ?? [], workflow]);
	}
	const merged = new Map<string, EntryRole>();
	const destinationsOf = (members: Workflow[]) =>
		new Set(
			members.flatMap(member => graph.effects(member.file)).flatMap(({ effect }) =>
				effect.kind === 'publish' ? [effect.destination] : effect.kind === 'release' ? ['github-release'] : []
			),
		);
	const primary = (key: string) =>
		key.startsWith('tags:')
		|| (groups.get(key) ?? []).some(member =>
			member.events.includes('release')
			|| graph.effects(member.file).some(({ effect }) => effect.kind === 'release' && effect.action === 'create')
		);
	for (const key of [...groups.keys()]) {
		if (primary(key)) continue;
		const members = groups.get(key) ?? [];
		const effects = members.flatMap(member => graph.effects(member.file)).map(entry => entry.effect);
		const maintenance = effects.every(effect =>
			effect.kind === 'alias' || effect.kind === 'artifact' || effect.kind === 'dispatch' || effect.kind === 'tag'
			|| (effect.kind === 'release' && effect.action !== 'create')
			|| (effect.kind === 'publish' && downstreamDestinations.includes(effect.destination))
		);
		const own = destinationsOf(members);
		const hosts = [...groups.keys()].filter(other => other !== key && primary(other));
		const packagesOf = (group: Workflow[]) => {
			const files = [...new Set(group.flatMap(member => graph.jobs(member.file).map(entry => entry.workflow)))];
			const entries = files.flatMap(file => graph.memberEffects(file, files));
			return new Set(
				targetsOf(graph, files, entries, new Map()).filter(target => target.selection === 'cited')
					.flatMap(target => target.packages),
			);
		};
		const ownPackages = packagesOf(members);
		const host = maintenance
			? hosts.find(other => destinationsOf(groups.get(other) ?? []).has('github-release')) ?? hosts[0]
			: hosts.find(other => {
				const theirs = destinationsOf(groups.get(other) ?? []);
				const theirPackages = packagesOf(groups.get(other) ?? []);
				return own.size > 0 && [...own].every(destination => theirs.has(destination))
					&& [...ownPackages].every(id => theirPackages.has(id));
			});
		if (!host) continue;
		for (const member of members) merged.set(member.file, maintenance ? 'maintenance' : 'channel');
		groups.set(host, [...groups.get(host) ?? [], ...members]);
		groups.delete(key);
	}
	const streams: StreamProposal[] = [];
	const used = new Set<string>();
	const upstreamOf = (workflow: Workflow): Workflow | undefined =>
		workflow.workflowRuns.flatMap(source =>
			graph.workflows.filter(candidate =>
				candidate.file !== workflow.file && (candidate.name === source || candidate.file === source)
			)
		)[0];
	const topOf = (workflow: Workflow): Workflow => {
		const seen = new Set<string>();
		let current = workflow;
		for (let next = upstreamOf(current); next && !seen.has(next.file); next = upstreamOf(current)) {
			seen.add(current.file);
			current = next;
		}
		return current;
	};
	for (const [key, roots] of groups) {
		const tops = roots.map(topOf).filter(top =>
			!roots.includes(top) && graph.entry(top) && streamKey(graph, top) === key
			&& ![...groups.values()].flat().some(other => other.file === top.file)
		);
		const heads = [...new Set([...tops, ...roots])];
		const files = [...new Set(heads.map(head => head.file))];
		const called = new Set(files.flatMap(file => graph.jobs(file)).map(entry => entry.workflow));
		const memberFiles = [...new Set([...files, ...called])];
		const entries = memberFiles.flatMap(file => graph.memberEffects(file, memberFiles));
		const phases = phasesOf(graph, files);
		const targets = targetsOf(graph, memberFiles, entries, phases);
		const [kind, value = ''] = key.split(/:(.*)/s);
		const tagWorkflow = heads.find(head => tagFamilies(head).length);
		const trigger: StreamProposal['trigger'] = kind === 'tags'
			? { kind: 'tags', prefix: value, patterns: tagWorkflow?.tagPatterns ?? [] }
			: kind === 'release'
			? { kind: 'release' }
			: kind === 'dispatch'
			? { kind: 'dispatch', workflow: value }
			: kind === 'schedule'
			? { kind: 'schedule', workflow: value }
			: { kind: 'branch', workflow: value };
		if (trigger.kind === 'tags' && !targets.some(target => target.destination === 'go-proxy')) {
			const modules = inventory.packages.filter(pkg => {
				if (pkg.manager !== 'go' || !publishable(pkg)) return false;
				const prefix = tagPrefix(pkg.versionSource);
				return prefix !== undefined && (trigger.prefix === prefix || trigger.prefix === prefix.replace(/v$/, ''));
			});
			const last = Math.max(0, ...targets.map(target => target.phase));
			if (modules.length) {
				targets.push({
					destination: 'go-proxy',
					selection: 'cited',
					names: modules.map(pkg => pkg.name),
					packages: modules.map(packageId),
					variants: [],
					optionalVariants: [],
					operations: [...new Set(targets.flatMap(target => target.operations))],
					phase: last + 1,
					required: true,
					downstream: false,
				});
			}
		}
		const base = streamName(key, heads, snapshot.repository.name);
		let name = base;
		for (let index = 2; used.has(name); index++) {
			const suffix = `-${index}`;
			name = `${base.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`;
		}
		used.add(name);
		const roles: StreamWorkflow[] = memberFiles.map(file => {
			const workflow = graph.byFile.get(file);
			const recovery = !!workflow && workflow.events.includes('workflow_dispatch')
				&& (workflow.callInputs.length > 0 || (graph.callers.get(file)?.size ?? 0) > 0
					|| workflow.dispatchInputs.some(input => /run[-_]?id|recover|backfill|destination/i.test(input)));
			const calledHere = files.some(other =>
				other !== file
				&& (graph.jobs(other).some(entry => entry.job.calls === file) || graph.starts(other).includes(file))
			);
			const role: EntryRole = merged.get(file) ?? (files.includes(file) && !calledHere
				? recovery && workflow && !tagFamilies(workflow).length && !workflow.events.includes('release')
					? 'recovery'
					: 'entry'
				: recovery
				? 'recovery'
				: 'called');
			return {
				file,
				role,
				events: workflow?.events ?? [],
				tagPatterns: workflow?.tagPatterns ?? [],
				branchPatterns: workflow?.branchPatterns ?? [],
				starts: graph.starts(file),
				conditions: Object.fromEntries(
					(workflow?.jobs ?? []).flatMap(job => job.condition ? [[job.id, job.condition]] : []),
				),
			};
		});
		if (!roles.some(entry => entry.role === 'entry')) {
			for (const entry of roles) {
				if (entry.role === 'recovery' && files.includes(entry.file) && !merged.has(entry.file)) entry.role = 'entry';
			}
		}
		const untagged = trigger.kind === 'schedule' || trigger.kind === 'branch';
		const channels = new Set<string>(untagged ? [] : ['stable']);
		const allText = memberFiles.flatMap(file => graph.jobs(file)).flatMap((
			{ job },
		) => [...job.runs, job.condition ?? ''])
			.join('\n');
		if (!untagged && /prerelease|\bnext\b|-rc|alpha|beta|preview/i.test(allText)) channels.add('prerelease');
		const channelRoots = heads.filter(head => merged.get(head.file) !== 'maintenance');
		const afterTag = (head: Workflow) => {
			const reached = new Set<string>();
			const pending = heads.filter(other => tagFamilies(other).length > 0 || other.events.includes('release')).map(
				other => other.file,
			);
			while (pending.length) {
				const file = pending.pop();
				if (file === undefined || reached.has(file)) continue;
				reached.add(file);
				pending.push(...graph.starts(file));
			}
			return reached.has(head.file) && !(tagFamilies(head).length > 0 || head.events.includes('release'));
		};
		if (
			channelRoots.some(head =>
				head.events.includes('schedule') || (head.events.includes('workflow_run') && !afterTag(head))
			)
			|| /\b(?:dist-tag|--tag|channel|tag_name|release)[\s=:]+["']?nightly\b|\bnightly\s+release/i.test(allText)
		) channels.add('nightly');
		if (
			trigger.kind === 'branch'
			|| channelRoots.some(root => merged.get(root.file) === 'channel' && root.branchPatterns.length)
		) {
			channels.add('snapshot');
		}
		const recoveries = memberFiles.flatMap(file => {
			const workflow = graph.byFile.get(file);
			if (!workflow) return [];
			const inputs = object(JSON.parse(workflow.dispatchText));
			return Object.entries(inputs).filter(([input, value]) => {
				if (
					/run[-_]?id|existing|resume|recover|backfill|destination|registry/i.test(`${input} ${JSON.stringify(value)}`)
				) {
					return true;
				}
				const options = object(value).options;
				return options !== undefined
					&& (JSON.stringify(options).match(/"(?:npm|jsr|pypi|crates-io|mirror|oci|docker|aur|winget)"/g)?.length ?? 0)
						>= 2;
			}).map(([input]) => `${code(file)} input ${code(input)}`);
		});
		const aliases = [
			...new Set(
				entries.flatMap(({ effect, workflow, job }) => effect.kind === 'alias' ? [`${workflow}#${job.id}`] : []),
			),
		];
		const evidence: Evidence[] = [];
		for (const { workflow, job } of memberFiles.flatMap(file => graph.jobs(file))) {
			if (!job.calls || !job.callRef) continue;
			evidence.push({
				status: 'declared',
				rule: 'helper revision',
				source: workflow,
				detail: `${code(workflow)} runs ${code(job.calls)} from ${
					code(job.callRef)
				}, so the helper revision can differ from the released source.`,
			});
		}
		const compatibility = compatibilityNames(
			snapshot,
			[allText, ...entries.map(({ effect }) => effect.kind === 'artifact' ? '' : effect.text)].join('\n'),
			targets.flatMap(target => target.binaries ?? []),
		);
		for (const [binary, names] of compatibility) {
			evidence.push({
				status: 'declared',
				rule: 'compatibility name',
				source: memberFiles.join(', '),
				detail: `${code(binary)} also ships as ${
					names.map(code).join(', ')
				}. These are compatibility aliases of the same product, so they get no stream or product of their own.`,
			});
		}
		for (const file of memberFiles) {
			const workflow = graph.byFile.get(file);
			if (workflow) evidence.push(...workflowEvidence(workflow));
		}
		if (recoveries.length) {
			evidence.push({
				status: 'declared',
				rule: 'destination recovery',
				source: memberFiles.join(', '),
				detail: `Manual dispatch resumes selected destinations from an existing payload: ${recoveries.join(', ')}.`,
			});
		}
		if (trigger.kind === 'tags') {
			evidence.push({
				status: 'declared',
				rule: 'tag trigger',
				source: roots.filter(root => tagFamilies(root).length).map(root => root.file).join(', '),
				detail: `Tags matching ${trigger.patterns.map(code).join(', ')} start this stream.`,
			});
		} else if (trigger.kind === 'dispatch') {
			evidence.push({
				status: 'declared',
				rule: 'manual dispatch',
				source: trigger.workflow,
				detail: `${code(trigger.workflow)} runs on manual dispatch and publishes on its own.`,
			});
		} else if (trigger.kind === 'schedule') {
			evidence.push({
				status: 'declared',
				rule: 'schedule',
				source: trigger.workflow,
				detail: `${
					code(trigger.workflow)
				} publishes on its schedule without a version tag, so it forms its own nightly stream.`,
			});
		} else if (trigger.kind === 'branch') {
			evidence.push({
				status: 'declared',
				rule: 'branch push',
				source: trigger.workflow,
				detail: `${
					code(trigger.workflow)
				} publishes from branch pushes without a version tag, so it forms its own snapshot stream.`,
			});
		}
		const versionGroup = versionGroupOf(graph, memberFiles, trigger, targets);
		const gaps: string[] = [];
		for (const initiator of initiators) {
			const linked = initiator.dispatches.some(file => memberFiles.includes(file))
				|| (initiator.tags && trigger.kind === 'tags'
					&& [...groups.keys()].filter(other => other.startsWith('tags:')).length === 1);
			if (!linked) continue;
			roles.push({
				file: initiator.workflow.file,
				role: 'initiator',
				events: initiator.workflow.events,
				tagPatterns: initiator.workflow.tagPatterns,
				branchPatterns: initiator.workflow.branchPatterns,
				starts: graph.starts(initiator.workflow.file),
				conditions: {},
			});
			evidence.push(...workflowEvidence(initiator.workflow));
			evidence.push({
				status: 'declared',
				rule: 'release initiation',
				source: initiator.workflow.file,
				detail: `${code(initiator.workflow.file)} prepares the release${
					initiator.workflow.events.includes('push') ? ' when its paths change on push' : ''
				}${initiator.tags ? ', pushes the release tag' : ''}${
					initiator.dispatches.length ? ` and dispatches ${initiator.dispatches.map(code).join(', ')}` : ''
				}. Beepboop observes the release it starts.`,
			});
		}
		streams.push({
			id: name,
			name,
			trigger,
			workflows: roles,
			channels: [...channels],
			facets: facetsOf(graph, memberFiles, targets),
			versionGroup,
			targets,
			aliases,
			evidence,
			gaps,
		});
	}
	for (const stream of streams) {
		const elsewhere = new Set(
			streams.filter(other => other !== stream).flatMap(other =>
				other.targets.filter(target => target.selection === 'cited').flatMap(target => target.packages)
			),
		);
		for (const target of stream.targets) {
			if (target.selection !== 'all') continue;
			const removed = new Set(
				inventory.packages.filter(pkg => target.packages.includes(packageId(pkg)) && elsewhere.has(packageId(pkg)))
					.map(pkg => pkg.name),
			);
			const before = target.packages.length;
			target.packages = target.packages.filter(id => !elsewhere.has(id));
			target.names = target.names.filter(name => !removed.has(name));
			if (before && !target.packages.length) stream.targets = stream.targets.filter(other => other !== target);
		}
	}
	for (const stream of streams) {
		const members = stream.workflows.map(entry => entry.file);
		const names = members.flatMap(file => [file, graph.byFile.get(file)?.name ?? file]);
		const followers = workflows.filter(workflow =>
			!streams.some(other => other.workflows.some(entry => entry.file === workflow.file))
			&& (members.some(file =>
				graph.effects(file).some(({ effect }) => effect.kind === 'dispatch' && effect.workflow === workflow.file)
			)
				|| workflow.workflowRuns.some(source => names.includes(source)))
		);
		const last = Math.max(0, ...stream.targets.map(target => target.phase));
		for (const follower of followers) {
			stream.workflows.push({
				file: follower.file,
				role: 'called',
				events: follower.events,
				tagPatterns: follower.tagPatterns,
				branchPatterns: follower.branchPatterns,
				starts: graph.starts(follower.file),
				conditions: Object.fromEntries(
					follower.jobs.flatMap(job => job.condition ? [[job.id, job.condition]] : []),
				),
			});
			const docs = graph.effects(follower.file).filter(({ effect }) =>
				effect.kind === 'publish' && effect.destination === 'docs'
			);
			if (docs.length) {
				stream.targets.push({
					destination: 'docs',
					selection: 'cited',
					names: [follower.name],
					packages: [],
					variants: [],
					optionalVariants: [],
					operations: [...new Set(docs.map(entry => `${entry.workflow}#${entry.job.id}`))],
					phase: last + 1,
					required: false,
					downstream: false,
				});
			}
			const index = omissions.findIndex(omission => omission.subject === code(follower.file));
			if (index >= 0) omissions.splice(index, 1);
		}
	}
	for (const initiator of initiators) {
		if (!streams.some(stream => stream.workflows.some(entry => entry.file === initiator.workflow.file))) {
			unresolved.push(
				`${code(initiator.workflow.file)} starts releases, but no publishing workflow it starts could be identified.`,
			);
		}
	}
	const targeted = new Set(streams.flatMap(stream => stream.targets.flatMap(target => target.packages)));
	const untargeted = new Map<string, Package[]>();
	for (const pkg of inventory.packages) {
		if (pkg.generated && publishable(pkg) && !targeted.has(packageId(pkg))) {
			untargeted.set(pkg.manifest, [...untargeted.get(pkg.manifest) ?? [], pkg]);
			continue;
		}
		if (!publishable(pkg)) {
			omissions.push({
				subject: code(pkg.name),
				reason: `${exclusionLabel(pkg.publication) ?? 'excluded'} (${code(pkg.manifest)})`,
			});
		} else if (!targeted.has(packageId(pkg)) && pkg.manager !== 'github-release' && pkg.manager !== 'goreleaser') {
			const destination = pkg.manager === 'cargo'
				? 'crates.io'
				: pkg.manager === 'go'
				? 'the Go module proxy under a matching tag'
				: pkg.manager === 'vscode'
				? 'the Visual Studio Marketplace'
				: pkg.manager;
			omissions.push({
				subject: code(pkg.name),
				reason: `${code(pkg.manifest)} is publishable, but no release workflow publishes it to ${destination}`,
			});
		}
	}
	const pypiNames = new Set(
		streams.flatMap(stream =>
			stream.targets.filter(target => target.destination === 'pypi').flatMap(target =>
				target.names.map(name => name.toLowerCase().replace(/[-_.]+/g, '-'))
			)
		),
	);
	for (const project of pyprojects(snapshot)) {
		if (pypiNames.has(project.name.toLowerCase().replace(/[-_.]+/g, '-'))) continue;
		omissions.push({
			subject: code(project.name),
			reason: project.private
				? `private (${code(project.path)})`
				: `${code(project.path)} describes a Python project, but no release workflow publishes it to PyPI`,
		});
	}
	const shipped = streams.flatMap(stream => stream.targets.flatMap(target => target.binaries ?? []));
	if (shipped.length) {
		for (const binary of cargoBinaries(snapshot)) {
			if (shipped.includes(binary.name)) continue;
			omissions.push({
				subject: code(binary.name),
				reason: `${code(binary.manifest)} builds a binary, but GitHub releases ship only ${
					[...new Set(shipped)].map(code).join(', ')
				}`,
			});
		}
	}
	for (const [manifest, packages] of untargeted) {
		omissions.push({
			subject: code(manifest),
			reason: `describes ${packages.length} generated npm packages, but no release workflow publishes them`,
		});
	}
	const targetedNames = new Set(
		inventory.packages.filter(pkg => targeted.has(packageId(pkg))).map(pkg => pkg.name),
	);
	const incomplete = incompleteProducts(snapshot, streams, targetedNames);
	const mirror = mirrorOf(snapshot, workflows);
	if (mirror) {
		unresolved.push(
			`This repository holds no buildable source. ${
				code(mirror.producer)
			} builds and publishes its assets; configure releases there.`,
		);
	}
	const generators = [...new Set(workflows.flatMap(workflow => workflow.generator ? [workflow.generator] : []))].map(
		source => ({
			source,
			workflows: workflows.filter(workflow => workflow.generator === source).map(workflow => workflow.file),
		}),
	);
	for (const generator of generators) {
		unresolved.push(
			`${code(generator.source)} generates ${
				generator.workflows.map(code).join(', ')
			}. Make adoption changes in the generator and regenerate; edits to the generated files would be overwritten.`,
		);
	}
	const notes = workflows.filter(workflow =>
		workflow.jobs.some(job => job.actions.length || job.runs.length)
		&& /(?:\$\/|\.\/|kjanat\/beepboop\/)actions\/token\b/.test(
			snapshot.files[`.github/workflows/${workflow.file}`] ?? '',
		)
		&& !/(?:\$\/|\.\/|kjanat\/beepboop\/)actions\/(?:begin|report)\b/.test(
			snapshot.files[`.github/workflows/${workflow.file}`] ?? '',
		)
	).map(workflow =>
		`${code(workflow.file)} already requests a Beepboop token, but reports no executions; observation adds that.`
	);
	if (!streams.length && !mirror) unresolved.push('No workflow publishes a release.');
	return {
		streams,
		incomplete,
		omissions,
		...(mirror ? { mirror } : {}),
		generators,
		notes,
		unresolved,
	};
}

function incompleteProducts(
	snapshot: Snapshot,
	streams: StreamProposal[],
	targeted: ReadonlySet<string>,
): IncompleteProduct[] {
	const published = new Set(streams.flatMap(stream => stream.targets.map(target => target.destination)));
	const binaries = streams.flatMap(stream =>
		stream.targets.filter(target => target.destination === 'github-release').flatMap(target => target.binaries ?? [])
	);
	const products: IncompleteProduct[] = [];
	for (const [path, source] of Object.entries(snapshot.files)) {
		if (/(?:^|\/)package\.json$/.test(path) && source) {
			let manifest: Record<string, unknown>;
			try {
				manifest = object(JSON.parse(source));
			} catch {
				continue;
			}
			if (typeof object(manifest.engines).vscode !== 'string') continue;
			const name = `${String(manifest.publisher ?? '')}.${String(manifest.name ?? path)}`;
			if (targeted.has(name)) continue;
			const scripts = object(manifest.scripts);
			const recipe = Object.entries(scripts).find(([, command]) =>
				typeof command === 'string' && /\bvsce\s+package\b/.test(command)
			)?.[0];
			const dependencies = object(manifest.dependencies);
			const local = Object.entries(dependencies).filter(([, spec]) =>
				typeof spec === 'string' && /^(?:file|link|workspace):/.test(spec)
			).map(([dependency]) => dependency);
			const servers = [...new Set([...source.matchAll(/\b([a-z][\w-]*-lsp)\b/g)].map(match => match[1] ?? ''))];
			const gaps = [
				'No release workflow publishes this extension to the Visual Studio Marketplace.',
				'Open VSX is a possible second destination; no workflow publishes there.',
				'Marketplace publication needs a publisher token or trusted publishing setup.',
				...local.map(dependency => `The extension bundles the local package ${code(dependency)}; build it first.`),
				...servers.filter(server => !binaries.includes(server)).map(server =>
					`The extension starts ${code(server)}, which no release delivers. Decide how users get the server.`
				),
			];
			products.push({
				name,
				kind: 'vscode-extension',
				manifest: path,
				...(recipe ? { recipe: `npm run ${recipe}` } : {}),
				destinations: ['vscode-marketplace', 'open-vsx'],
				gaps,
			});
		}
		if (/(?:^|\/)extension\.toml$/.test(path) && source && !published.has('zed-extensions')) {
			let manifest: Record<string, unknown>;
			try {
				manifest = object(parseToml(source));
			} catch {
				continue;
			}
			const grammars = Object.entries(object(manifest.grammars)).map(([grammar, value]) =>
				`${grammar}@${String(object(value).rev ?? object(value).commit ?? 'unpinned')}`
			);
			products.push({
				name: String(manifest.id ?? path),
				kind: 'zed-extension',
				manifest: path,
				destinations: ['zed-extensions'],
				gaps: [
					'No workflow submits this extension to the Zed extension registry.',
					...(grammars.length ? [`Pinned grammars: ${grammars.map(code).join(', ')}.`] : []),
				],
			});
		}
	}
	return products.sort((a, b) => a.manifest.localeCompare(b.manifest));
}

function mirrorOf(snapshot: Snapshot, workflows: Workflow[]): { producer: string; source: string } | undefined {
	const buildable = snapshot.paths.some(path =>
		/(?:^|\/)(?:Cargo\.toml|package\.json|go\.mod|pyproject\.toml|deno\.jsonc?|build\.zig|Makefile)$/.test(path)
		|| /\.(?:rs|ts|go|py|zig|c|cs|ps1)$/.test(path)
	);
	if (buildable || workflows.length) return undefined;
	const readme = snapshot.files['README.md'] ?? '';
	const own = snapshot.repository.name.toLowerCase();
	const producer = [...readme.matchAll(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?=[/)#\s"'>]|$)/g)].map(match =>
		match[1] ?? ''
	).find(name => name.toLowerCase() !== own);
	return producer ? { producer, source: 'README.md' } : undefined;
}
