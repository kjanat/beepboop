import { Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { unsettableVersion } from '@/discovery/analysis/go-version.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import type { BinaryCandidate } from '@/domain/binary-platforms.ts';
import { supportedTargets } from '@/domain/binary-platforms.ts';
import type { Inventory, Package, Snapshot } from '@/domain/inventory.ts';
import { packageId } from '@/domain/package-identity.ts';
import { parentDirectory, walkRelative } from '@/kernel/path/relative-path.ts';

const unixCrates = new Set(['nix', 'uzers', 'users', 'termios', 'daemonize', 'fork', 'pty-process']);
const windowsRustix = new Set(['std', 'alloc', 'core', 'net', 'event', 'use-libc', 'rustc-dep-of-std']);
const skippedGo = /(?:^|\/)(?:testdata|vendor|internal|examples?|_[^/]*)(?:\/|$)/;

function toml(source: string | undefined): Record<string, unknown> | undefined {
	const parsed = Result.try(() => object(parseToml(source ?? '')));
	return Result.isSuccess(parsed) ? parsed.success : undefined;
}
function features(value: unknown): string[] {
	const list = object(value).features;
	return Array.isArray(list) ? list.map(String) : [];
}

export function cargoBinaryNames(snapshot: Snapshot, manifest: string): string[] {
	const document = toml(snapshot.files[manifest]);
	if (!document) return [];
	const directory = parentDirectory(manifest);
	const prefix = directory ? `${directory}/` : '';
	const bins = (Array.isArray(document.bin) ? document.bin : []).map(object);
	const declared = bins.flatMap(entry => typeof entry.name === 'string' ? [entry.name] : []);
	const pkg = object(document.package);
	const main = typeof pkg.name === 'string' && pkg.autobins !== false
			&& !bins.some(entry => entry.path === 'src/main.rs')
			&& snapshot.paths.includes(`${prefix}src/main.rs`)
		? [pkg.name]
		: [];
	return [...new Set([...declared, ...main])];
}

export function unixDependencies(snapshot: Snapshot, manifest: string, seen = new Set<string>()): string[] {
	if (seen.has(manifest)) return [];
	seen.add(manifest);
	const document = toml(snapshot.files[manifest]);
	if (!document) return [];
	const shared = object(object(toml(snapshot.files['Cargo.toml'])?.workspace).dependencies);
	const found: string[] = [];
	for (const [key, value] of Object.entries(object(document.dependencies))) {
		const inherited = object(value).workspace === true;
		const spec = inherited ? object(shared[key]) : object(value);
		const base = inherited ? '' : parentDirectory(manifest);
		const name = typeof spec.package === 'string' ? spec.package : key;
		if (typeof spec.path === 'string') {
			const { path, escaped } = walkRelative(base, spec.path);
			if (!escaped) found.push(...unixDependencies(snapshot, path ? `${path}/Cargo.toml` : 'Cargo.toml', seen));
			continue;
		}
		if (unixCrates.has(name)) found.push(name);
		if (name === 'rustix') {
			const unix = [...new Set([...features(spec), ...(inherited ? features(value) : [])])].filter(feature =>
				!windowsRustix.has(feature)
			);
			if (unix.length) found.push(`rustix (${unix.sort().join(', ')})`);
		}
	}
	return [...new Set(found)];
}

function cargoCandidates(snapshot: Snapshot, pkg: Package): BinaryCandidate[] {
	const unix = unixDependencies(snapshot, pkg.manifest);
	const available = supportedTargets('cargo');
	const targets = unix.length ? available.filter(target => !target.startsWith('windows-')) : available;
	return cargoBinaryNames(snapshot, pkg.manifest).map(name => ({
		package: packageId(pkg),
		build: { toolchain: 'cargo', name, manifest: pkg.manifest, asset: '{name}-{rust.target}{ext}' },
		targets,
		...(unix.length
			? {
				reason: `${pkg.name} depends on ${unix.join(' and ')}, which build only for Unix`,
			}
			: {}),
	}));
}

interface GoMain {
	module: string;
	directory: string;
	relative: string;
}
function goMainPackages(paths: readonly string[]): GoMain[] {
	const modules = paths.filter(path => /(?:^|\/)go\.mod$/.test(path)).map(parentDirectory);
	return paths.flatMap(path => {
		if (!/(?:^|\/)main\.go$/.test(path)) return [];
		const directory = parentDirectory(path);
		const [module] = modules.filter(entry => !entry || directory === entry || directory.startsWith(`${entry}/`))
			.sort((a, b) => b.length - a.length);
		if (module === undefined) return [];
		const relative = directory.slice(module ? module.length + 1 : 0);
		return skippedGo.test(relative) ? [] : [{ module, directory, relative }];
	});
}
const goSource = (path: string) => /(?:^|\/)[^/_.][^/]*\.go$/.test(path) && !path.endsWith('_test.go');
export function goMainSources(paths: readonly string[]): string[] {
	const directories = new Set(goMainPackages(paths).map(entry => entry.directory));
	return paths.filter(path => goSource(path) && directories.has(parentDirectory(path)));
}

function goCandidates(snapshot: Snapshot, pkg: Package): BinaryCandidate[] {
	const module = parentDirectory(pkg.manifest);
	return goMainPackages(snapshot.paths).filter(entry => entry.module === module).map(({ directory, relative }) => {
		const name = (relative || pkg.name).split('/').at(-1) ?? pkg.name;
		const version = unsettableVersion(
			[...snapshot.paths, ...(snapshot.links ?? [])].filter(path =>
				goSource(path) && parentDirectory(path) === directory
			).sort((a, b) => a.localeCompare(b)).map(file => [file, snapshot.goSources?.[file]]),
		);
		return {
			package: packageId(pkg),
			build: {
				toolchain: 'go',
				name,
				module: module || '.',
				package: relative ? `./${relative}` : '.',
				asset: '{name}-{go.os}-{go.arch}{ext}',
			},
			targets: supportedTargets('go'),
			...(version ? { unsettableVersion: version } : {}),
		};
	});
}

export function binaryCandidates(snapshot: Snapshot, inventory: Inventory): BinaryCandidate[] {
	return inventory.packages.flatMap(pkg =>
		pkg.manager === 'cargo' ? cargoCandidates(snapshot, pkg) : pkg.manager === 'go' ? goCandidates(snapshot, pkg) : []
	);
}
