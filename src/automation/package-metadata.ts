import { Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Inventory, Package, Snapshot } from '@/automation/types';
import type { Diagnostic } from '@/contract/diagnostics';
import { filled, lacking, readmeFile } from '@/contract/package-metadata';
import { parentDirectory, walkRelative } from '@/relative-path';

const cargoReadmes = ['README.md', 'README.txt', 'README'];

function exists(snapshot: Snapshot, base: string, relative: string): boolean {
	const { path, escaped } = walkRelative(base, relative);
	return !escaped && snapshot.paths.includes(path);
}
function toml(source: string | undefined): Record<string, unknown> | undefined {
	const parsed = Result.try(() => object(parseToml(source ?? '')));
	return Result.isSuccess(parsed) ? parsed.success : undefined;
}

function cargoMissing(snapshot: Snapshot, pkg: Package): string[] {
	const manifest = toml(snapshot.files[pkg.manifest]);
	if (!manifest) return [];
	const own = object(manifest.package);
	const shared = object(object(toml(snapshot.files['Cargo.toml'])?.workspace).package);
	const dir = parentDirectory(pkg.manifest);
	const field = (key: string) =>
		object(own[key]).workspace === true ? { value: shared[key], base: '' } : { value: own[key], base: dir };
	const readme = field('readme');
	return lacking({
		README: typeof readme.value === 'string'
			? exists(snapshot, readme.base, readme.value)
			: readme.value === true
			? exists(snapshot, readme.base, 'README.md')
			: readme.value === undefined && cargoReadmes.some(name => exists(snapshot, dir, name)),
		description: filled(field('description').value),
		license: filled(field('license').value) || filled(field('license-file').value),
		repository: filled(field('repository').value),
	});
}

function npmMissing(snapshot: Snapshot, pkg: Package): string[] {
	const parsed = Result.try(() => object(JSON.parse(snapshot.files[pkg.manifest] ?? '')));
	if (Result.isFailure(parsed)) return [];
	const manifest = parsed.success;
	const dir = parentDirectory(pkg.manifest);
	return lacking({
		README: snapshot.paths.some(path =>
			parentDirectory(path) === dir && readmeFile.test(path.slice(path.lastIndexOf('/') + 1))
		),
		description: filled(manifest.description),
		license: filled(manifest.license),
		repository: filled(manifest.repository) || filled(object(manifest.repository).url),
	});
}

function pypiMissing(snapshot: Snapshot, pkg: Package): string[] {
	const project = object(toml(snapshot.files[pkg.manifest])?.project);
	const dynamic = Array.isArray(project.dynamic) ? project.dynamic : [];
	const dir = parentDirectory(pkg.manifest);
	const file = (value: unknown) => typeof value === 'string' && exists(snapshot, dir, value);
	const readme = project.readme;
	const license = project.license;
	return lacking({
		README: dynamic.includes('readme') || file(readme) || filled(object(readme).text) || file(object(readme).file),
		license: dynamic.includes('license') || filled(license) || filled(object(license).text)
			|| file(object(license).file)
			|| (Array.isArray(project['license-files']) && project['license-files'].length > 0),
		urls: dynamic.includes('urls') || Object.values(object(project.urls)).some(filled),
	});
}

function missing(snapshot: Snapshot, pkg: Package): string[] {
	if (!publishable(pkg) || pkg.generated) return [];
	if (pkg.manager === 'cargo') return cargoMissing(snapshot, pkg);
	if (pkg.manager === 'npm') return npmMissing(snapshot, pkg);
	if (pkg.manager === 'pypi') return pypiMissing(snapshot, pkg);
	return [];
}

export function metadataDiagnostics(snapshot: Snapshot, packages: readonly Package[]): Diagnostic[] {
	return packages.flatMap(pkg => {
		const fields = missing(snapshot, pkg);
		return fields.length
			? [{
				code: 'package-metadata' as const,
				severity: 'warning' as const,
				subject: { kind: 'package' as const, key: packageId(pkg) },
				message: `${pkg.name} (${pkg.manifest}) lacks ${fields.join(', ')}`,
			}]
			: [];
	});
}

export function metadataProblems(inventory: Inventory, packages: readonly Package[]): string[] {
	const ids = new Set(packages.map(packageId));
	return inventory.diagnostics.flatMap(entry =>
		entry.code === 'package-metadata' && entry.subject?.kind === 'package' && ids.has(entry.subject.key)
			? [entry.message]
			: []
	);
}
