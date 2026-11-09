import { Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import { packageId } from '@/automation/package-identity';
import type { Inventory, Package, Snapshot } from '@/automation/types';
import type { BinaryCandidate } from '@/contract/setup';
import { binaryTargets } from '@/contract/setup';
import { parentDirectory, walkRelative } from '@/relative-path';

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
	const targets = unix.length ? binaryTargets.filter(target => !target.startsWith('windows-')) : [...binaryTargets];
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

function goCandidates(snapshot: Snapshot, pkg: Package): BinaryCandidate[] {
	const module = parentDirectory(pkg.manifest);
	const prefix = module ? `${module}/` : '';
	const nested = snapshot.paths.filter(path =>
		path !== pkg.manifest && path.startsWith(prefix) && path.endsWith('/go.mod')
	)
		.map(parentDirectory);
	return snapshot.paths.flatMap(path => {
		if (!path.startsWith(prefix) || !path.endsWith('main.go') || !/(?:^|\/)main\.go$/.test(path)) return [];
		const directory = parentDirectory(path);
		const relative = directory.slice(prefix.length);
		if (skippedGo.test(relative) || nested.some(other => directory === other || directory.startsWith(`${other}/`))) {
			return [];
		}
		const name = (relative || pkg.name).split('/').at(-1) ?? pkg.name;
		return [{
			package: packageId(pkg),
			build: {
				toolchain: 'go',
				name,
				module: module || '.',
				package: relative ? `./${relative}` : '.',
				asset: '{name}-{go.os}-{go.arch}{ext}',
			},
			targets: [...binaryTargets],
		}];
	});
}

export function binaryCandidates(snapshot: Snapshot, inventory: Inventory): BinaryCandidate[] {
	const candidates = inventory.packages.flatMap(pkg =>
		pkg.manager === 'cargo' ? cargoCandidates(snapshot, pkg) : pkg.manager === 'go' ? goCandidates(snapshot, pkg) : []
	);
	return candidates.filter((candidate, index) =>
		candidates.findIndex(other => other.build.name === candidate.build.name) === index
	);
}
