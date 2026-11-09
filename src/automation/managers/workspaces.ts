import { Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { inWorkspace, object, yaml } from '@/automation/managers/helpers';
import { parentDirectory, walkRelative } from '@/relative-path';

type Read = (path: string) => string | undefined;

function toml(source: string | undefined): Record<string, unknown> | undefined {
	if (source === undefined) return undefined;
	const parsed = Result.try(() => object(parseToml(source)));
	return Result.isSuccess(parsed) ? parsed.success : undefined;
}
function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
function resolve(base: string, relative: string): string | undefined {
	const { path, escaped } = walkRelative(base, relative);
	return escaped ? undefined : path;
}
function pathDependencies(manifest: Record<string, unknown>, shared: Record<string, unknown>): string[] {
	const tables = [manifest, ...Object.values(object(manifest.target)).map(object)].flatMap(table =>
		['dependencies', 'dev-dependencies', 'build-dependencies'].map(key => object(table[key]))
	);
	return tables.flatMap(table =>
		Object.entries(table).flatMap(([name, value]) => {
			const dependency = object(value);
			const declared = dependency.workspace === true ? object(shared[name]) : undefined;
			const path = declared ? declared.path : dependency.path;
			return typeof path === 'string' ? [declared ? `/${path}` : path] : [];
		})
	);
}

export function cargoMembers(read: Read, paths: readonly string[]): (path: string) => boolean {
	const root = toml(read('Cargo.toml'));
	if (!root || !('workspace' in root)) return () => false;
	const workspace = object(root.workspace);
	const members = strings(workspace.members);
	const exclude = strings(workspace.exclude);
	const shared = object(workspace.dependencies);
	const explicit = (path: string) => inWorkspace(path, members, exclude);
	const implicit = new Set<string>();
	const queue = paths.filter(path => path === 'Cargo.toml' || path.endsWith('/Cargo.toml')).map(parentDirectory).filter(
		path => path === '' || explicit(path),
	);
	for (let index = 0; index < queue.length; index++) {
		const base = queue[index] ?? '';
		const manifest = toml(read(base ? `${base}/Cargo.toml` : 'Cargo.toml'));
		if (!manifest) continue;
		for (const dependency of pathDependencies(manifest, shared)) {
			const member = dependency.startsWith('/') ? resolve('', dependency.slice(1)) : resolve(base, dependency);
			if (member === undefined || member === '' || explicit(member) || implicit.has(member)) continue;
			if (inWorkspace(member, exclude, [])) continue;
			implicit.add(member);
			queue.push(member);
		}
	}
	return path => explicit(path) || implicit.has(path);
}

export function workspaceMembers(read: Read, paths: readonly string[]): (path: string) => boolean {
	const cargo = cargoMembers(read, paths);
	const npm = Result.try(() => object(JSON.parse(read('package.json') ?? '{}')));
	const workspaces = Result.isSuccess(npm) ? npm.success.workspaces : undefined;
	const pnpm = yaml(read('pnpm-workspace.yaml') ?? read('pnpm-workspace.yml') ?? '{}');
	const uv = object(object(object(toml(read('pyproject.toml'))?.tool).uv).workspace);
	const globs = [
		...strings(Array.isArray(workspaces) ? workspaces : object(workspaces).packages),
		...strings(Result.isSuccess(pnpm) ? pnpm.success.packages : undefined),
	];
	const included = globs.filter(pattern => !pattern.startsWith('!')).map(pattern => pattern.replace(/^\.\//, ''));
	const negated = globs.filter(pattern => pattern.startsWith('!')).map(pattern =>
		pattern.slice(1).replace(/^\.\//, '')
	);
	return path =>
		!/(?:^|\/)(?:node_modules|\.git)(?:\/|$)/.test(path)
		&& (cargo(path) || inWorkspace(path, included, negated)
			|| inWorkspace(path, strings(uv.members), strings(uv.exclude)));
}
