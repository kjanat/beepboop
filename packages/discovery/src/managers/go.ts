import type { DiscovererOf } from '@/discovery/managers/registry.ts';
import { emptyInventory } from '@/discovery/managers/registry.ts';
import type { Package } from '@/domain/inventory.ts';
import { excluded, registry } from '@/domain/package-publication.ts';
import { latestTag, majorSuffix, tagSource } from '@/domain/version-tags.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';
import { parentDirectory } from '@/kernel/path/relative-path.ts';

const pseudoVersion =
	/^v[0-9]+\.(?:0\.0-|\d+\.\d+-(?:[^+]*\.)?0\.)\d{14}-[A-Za-z0-9]+(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isGoPseudoVersion(version: string): boolean {
	return pseudoVersion.test(`v${version.replace(/^v/, '')}`);
}

interface GoMod {
	module: string;
	requires: string[];
}
interface ModulePath {
	prefix: string;
	majors: number[];
	suffix?: string;
}

function unquote(token: string): string {
	return /^".*"$|^`.*`$/.test(token) ? token.slice(1, -1) : token;
}
function parseGoMod(source: string): GoMod | undefined {
	let module: string | undefined;
	const requires: string[] = [];
	let block = false;
	for (const raw of source.split('\n')) {
		const line = raw.replace(/\/\/.*$/, '').trim();
		if (block) {
			if (line === ')') block = false;
			else if (line) requires.push(unquote(line.split(/\s+/)[0] ?? ''));
			continue;
		}
		const [verb, ...rest] = line.split(/\s+/);
		if (verb === 'module' && rest[0]) module = unquote(rest[0]);
		if (verb === 'require' && rest[0] === '(') block = true;
		else if (verb === 'require' && rest[0]) requires.push(unquote(rest[0]));
	}
	return module ? { module, requires: requires.filter(Boolean) } : undefined;
}
export function splitModulePath(path: string): ModulePath | undefined {
	if (!/^[A-Za-z0-9.~_+-]+(?:\/[A-Za-z0-9.~_+-]+)*$/.test(path) || !path.split('/')[0]?.includes('.')) {
		return undefined;
	}
	const gopkg = /^gopkg\.in\/.+\.v(0|[1-9][0-9]*)$/.exec(path);
	if (gopkg) return { prefix: path, majors: [Number(gopkg[1])] };
	const versioned = /^(.+)\/v([0-9.]+)$/.exec(path);
	if (!versioned) return { prefix: path, majors: [0, 1] };
	const [, prefix, major] = versioned;
	if (!prefix || !major || !majorSuffix.test(`v${major}`)) return undefined;
	return { prefix, majors: [Number(major)], suffix: `v${major}` };
}
function join(...parts: string[]): string {
	return parts.filter(Boolean).join('/');
}
function codeRoot(split: ModulePath, dir: string, repository: string, vanity: string | undefined): string | undefined {
	if (split.prefix.startsWith('github.com/')) {
		const root = split.prefix.split('/').slice(0, 3).join('/');
		return root.toLowerCase() === repository ? root : undefined;
	}
	if (vanity !== undefined) return vanity;
	const base = split.suffix && (dir === split.suffix || dir.endsWith(`/${split.suffix}`)) ? parentDirectory(dir) : dir;
	if (!base) return split.prefix;
	return split.prefix.endsWith(`/${base}`) ? split.prefix.slice(0, -base.length - 1) : undefined;
}

export const goDiscoverer: DiscovererOf<'go'> = {
	name: 'go',
	discover(snapshot) {
		const inventory = emptyInventory();
		const modules: { path: string; mod: GoMod }[] = [];
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			if (path !== 'go.mod' && !path.endsWith('/go.mod')) continue;
			const mod = parseGoMod(source);
			if (mod) modules.push({ path, mod });
			else inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', `cannot safely discover configuration`));
		}
		const rootModule = modules.find(entry => entry.path === 'go.mod');
		const vanityRoot = rootModule ? splitModulePath(rootModule.mod.module)?.prefix : undefined;
		const repository = `github.com/${snapshot.repository.name}`.toLowerCase();
		for (const { path, mod } of modules) {
			const dir = parentDirectory(path);
			const split = splitModulePath(mod.module);
			const root = split && codeRoot(split, dir, repository, vanityRoot);
			const codeDir = !split || root === undefined
				? undefined
				: split.prefix === root
				? ''
				: split.prefix.startsWith(`${root}/`)
				? split.prefix.slice(root.length + 1)
				: undefined;
			const located = codeDir !== undefined && split !== undefined
				&& (dir === codeDir || (split.suffix !== undefined && dir === join(codeDir, split.suffix)));
			const prefix = located ? (codeDir ? `${codeDir}/v` : 'v') : dir ? `${dir}/v` : 'v';
			const version = split && located
				? latestTag(
					snapshot.tags ?? [],
					prefix,
					value =>
						/^\d/.test(value) && !value.includes('+') && !isGoPseudoVersion(value)
						&& split.majors.includes(Number(value.split('.')[0])),
				)
				: undefined;
			const pkg: Package = {
				manager: 'go',
				name: mod.module,
				...(version === undefined ? {} : { version }),
				manifest: path,
				versionSource: tagSource(prefix),
				publication: located ? registry : excluded('unlocated-module'),
				dependencies: mod.requires,
			};
			inventory.packages.push(pkg);
		}
		if (modules.length) inventory.managers = ['go'];
		return inventory;
	},
};
