import type { ParseError } from 'jsonc-parser';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { jsonIndent, object } from '@/discovery/managers/manifest-editing.ts';
import type { DiscovererOf } from '@/discovery/managers/registry.ts';
import { emptyInventory } from '@/discovery/managers/registry.ts';
import { jsrManifest, jsrPackageNamePattern } from '@/domain/catalog.ts';
import { registry } from '@/domain/package-publication.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';
import { parentDirectory } from '@/kernel/path/relative-path.ts';

const precedence = ['jsr.json', 'jsr.jsonc', 'deno.json', 'deno.jsonc'];
function rank(path: string): number {
	return precedence.indexOf(path.slice(path.lastIndexOf('/') + 1));
}
const licenseTerm = String.raw`\(?(?!UNLICENSED\b|LicenseRef-)[A-Za-z0-9][A-Za-z0-9.+-]*\)?`;
const spdxLicense = new RegExp(`^${licenseTerm}(?: (?:AND|OR|WITH) ${licenseTerm})*$`);

export const jsrDiscoverer: DiscovererOf<'jsr'> = {
	name: 'jsr',
	discover(snapshot) {
		const inventory = emptyInventory();
		const manifests = new Map<string, string>();
		for (const path of Object.keys(snapshot.files).filter(path => jsrManifest.test(path))) {
			const dir = parentDirectory(path);
			const chosen = manifests.get(dir);
			if (!chosen || rank(path) < rank(chosen)) manifests.set(dir, path);
		}
		for (const path of manifests.values()) {
			const source = snapshot.files[path] ?? '';
			const errors: ParseError[] = [];
			const manifest = object(parse(source, errors, { allowTrailingComma: true }));
			const deno = /(?:^|\/)deno\.jsonc?$/.test(path);
			if (deno && !errors.length && manifest.name === undefined) continue;
			inventory.managers = ['jsr'];
			if (errors.length || typeof manifest.name !== 'string' || !jsrPackageNamePattern.test(manifest.name)) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', `invalid JSR manifest`));
				continue;
			}
			if (
				manifest.license !== undefined
				&& (typeof manifest.license !== 'string' || !spdxLicense.test(manifest.license))
			) {
				inventory.diagnostics.push(
					fileProblem(path, 'license-missing', `JSR requires an SPDX license expression in "license"`),
				);
			}
			inventory.packages.push({
				manager: 'jsr',
				name: manifest.name,
				manifest: path,
				...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
				versionSource: `${path}#version`,
				publication: registry,
				dependencies: [],
			});
		}
		return inventory;
	},
	ownsVersionSource: source => /(?:^|\/)(?:jsr|deno)\.jsonc?#version$/.test(source),
	editVersion({ before, version }) {
		const indent = jsonIndent(before);
		return fromSync(() =>
			applyEdits(
				before,
				modify(before, ['version'], version, {
					formattingOptions: { insertSpaces: !indent.startsWith('\t'), tabSize: indent.length },
				}),
			)
		);
	},
};
