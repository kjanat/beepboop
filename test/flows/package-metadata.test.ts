import { expect, test } from 'bun:test';
import { crateMetadata, licenseText, npmManifest, pythonMetadata } from '@root/test/support/repositories.ts';
import { Effect } from 'effect';
import { discover } from '@/automation/managers';
import { metadataProblems } from '@/automation/package-metadata';
import { buildSnapshot } from '@/automation/snapshot';
import type { Snapshot } from '@/automation/types';

function snapshot(files: Record<string, string>, extra: string[] = [], links: string[] = []): Snapshot {
	return {
		repository: { id: 1, name: 'octo/example', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: [...Object.keys(files), ...extra],
		...(links.length ? { links } : {}),
	};
}
function problems(files: Record<string, string>, extra: string[] = [], links: string[] = []): string[] {
	const inventory = discover(snapshot(files, extra, links));
	return metadataProblems(inventory, inventory.packages);
}

const workspace = '[workspace]\nmembers = ["crates/core"]\n';
const coreFields = 'description = "Core"\nrepository = "https://github.com/octo/example"\n';
const core = (fields: string) => `[package]\nname = "core"\nversion = "1.0.0"\n${fields}`;

test('a crate with a README, description, license, license file and repository passes', () => {
	expect(problems({
		'Cargo.toml': workspace,
		'README.md': '# example\n',
		LICENSE: licenseText,
		'crates/core/Cargo.toml': core(crateMetadata),
	})).toEqual([]);
});

test('a crate without a README is blocked with its name, manifest and the field', () => {
	expect(problems({ 'Cargo.toml': workspace, LICENSE: licenseText, 'crates/core/Cargo.toml': core(crateMetadata) }))
		.toEqual(['core (crates/core/Cargo.toml) lacks README']);
});

test('a crate with only the license field and no license file is blocked', () => {
	const crate = { 'Cargo.toml': workspace, 'crates/core/README.md': '# core\n' };
	const manifest = core(`${coreFields}license = "MIT"\n`);
	expect(problems({ ...crate, LICENSE: licenseText, 'crates/core/Cargo.toml': manifest })).toEqual([
		'core (crates/core/Cargo.toml) lacks a license file',
	]);
	expect(problems({ ...crate, 'crates/core/LICENSE-MIT': licenseText, 'crates/core/Cargo.toml': manifest }))
		.toEqual([]);
	expect(problems({ ...crate, 'crates/core/copying.txt': licenseText, 'crates/core/Cargo.toml': manifest }))
		.toEqual([]);
	expect(problems({ ...crate, 'crates/core/Cargo.toml': manifest }, [], ['crates/core/LICENSE'])).toEqual([]);
});

test('a symlinked LICENSE in the crate directory counts as the license file', async () => {
	const files: Record<string, string> = {
		'Cargo.toml': workspace,
		LICENSE: licenseText,
		'crates/core/README.md': '# core\n',
		'crates/core/Cargo.toml': core(`${coreFields}license = "MIT"\n`),
	};
	const built = (link: boolean) =>
		Effect.runPromise(buildSnapshot({
			repository: { id: 1, name: 'octo/example', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: [
				...Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
				...(link ? [{ path: 'crates/core/LICENSE', type: 'blob', mode: '120000' }] : []),
			],
			read: path => Effect.succeed(files[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
	const linked = await built(true);
	expect([linked.links, linked.paths.includes('crates/core/LICENSE')]).toEqual([['crates/core/LICENSE'], false]);
	const inventory = discover(linked);
	expect(metadataProblems(inventory, inventory.packages)).toEqual([]);
	const bare = discover(await built(false));
	expect(metadataProblems(bare, bare.packages)).toEqual(['core (crates/core/Cargo.toml) lacks a license file']);
});

test('a crate license-file must name a file that exists', () => {
	const crate = { 'Cargo.toml': workspace, 'crates/core/README.md': '# core\n' };
	expect(problems({ ...crate, 'crates/core/Cargo.toml': core(`${coreFields}license-file = "legal/TERMS.txt"\n`) }))
		.toEqual(['core (crates/core/Cargo.toml) lacks a license file']);
	expect(problems({
		...crate,
		'crates/core/legal/TERMS.txt': licenseText,
		'crates/core/Cargo.toml': core(`${coreFields}license-file = "legal/TERMS.txt"\n`),
	})).toEqual([]);
});

test('cargo finds a README in the crate directory and reads inherited workspace fields', () => {
	const shared =
		'[workspace]\nmembers = ["crates/core"]\n\n[workspace.package]\ndescription = "Shared"\nlicense-file = "LICENSE"\nrepository = "https://github.com/octo/example"\nreadme = "README.md"\n';
	const inherited = core('description.workspace = true\nlicense-file.workspace = true\nrepository.workspace = true\n');
	expect(problems({ 'Cargo.toml': workspace, 'crates/core/Cargo.toml': inherited }, ['crates/core/README.txt']))
		.toEqual(['core (crates/core/Cargo.toml) lacks description, license, a license file, repository']);
	expect(problems({ 'Cargo.toml': shared, 'crates/core/Cargo.toml': `${inherited}readme.workspace = true\n` }, [
		'README.md',
		'LICENSE',
	])).toEqual([]);
	expect(problems({ 'Cargo.toml': shared, 'crates/core/Cargo.toml': inherited }, ['README.md', 'LICENSE']))
		.toEqual(['core (crates/core/Cargo.toml) lacks README']);
});

test('readme = false and a readme path that does not exist both block a crate', () => {
	const crate = (readme: string) => ({
		'Cargo.toml': workspace,
		'crates/core/README.md': '# core\n',
		'crates/core/LICENSE': licenseText,
		'crates/core/Cargo.toml': core(`${coreFields}license = "MIT"\nreadme = ${readme}\n`),
	});
	expect(problems(crate('false'))).toEqual(['core (crates/core/Cargo.toml) lacks README']);
	expect(problems(crate('"../../docs/README.md"'))).toEqual(['core (crates/core/Cargo.toml) lacks README']);
	expect(problems(crate('"README.md"'))).toEqual([]);
});

test('an unpublished crate is never checked', () => {
	expect(problems({ 'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\npublish = false\n' })).toEqual([]);
});

test('an npm package needs a README and a license file next to package.json and its metadata fields', () => {
	const complete = { 'package.json': npmManifest('widget', '1.0.0'), LICENSE: licenseText };
	expect(problems({ ...complete, 'readme.markdown': '# widget\n' })).toEqual([]);
	expect(problems({ 'package.json': npmManifest('widget', '1.0.0', { repository: { url: 'git+https://x' } }) }, [
		'README',
		'licence.md',
	])).toEqual([]);
	expect(problems({ ...complete, 'docs/README.md': '# widget\n' })).toEqual(['widget (package.json) lacks README']);
	expect(problems({ 'package.json': npmManifest('widget', '1.0.0'), 'README.md': '# widget\n' })).toEqual([
		'widget (package.json) lacks a license file',
	]);
	expect(problems({ 'package.json': '{"name":"widget","version":"1.0.0","repository":{}}\n', 'README.md': '#\n' }))
		.toEqual(['widget (package.json) lacks description, license, a license file, repository']);
	expect(problems({ 'package.json': '{"name":"widget","version":"1.0.0","private":true}\n' })).toEqual([]);
});

test('a Python project needs a readme, a license, a license file and a project URL', () => {
	const project = (fields: string, files: Record<string, string> = { LICENSE: licenseText }) => ({
		'pyproject.toml': `[project]\nname = "lint-py"\nversion = "1.0.0"\n${fields}`,
		...files,
	});
	expect(problems(project(pythonMetadata))).toEqual([]);
	expect(problems(project(pythonMetadata, {}))).toEqual(['lint-py (pyproject.toml) lacks a license file']);
	expect(problems(project(`${pythonMetadata}license-files = ["legal/*.txt"]\n`, { 'legal/MIT.txt': licenseText })))
		.toEqual([]);
	expect(problems(project(pythonMetadata, { 'LICENSES/MIT.txt': licenseText }))).toEqual([]);
	expect(problems(project('readme = "README.md"\nlicense = { file = "TERMS" }\n'), ['README.md', 'TERMS']))
		.toEqual(['lint-py (pyproject.toml) lacks urls']);
	expect(problems(project('readme = "README.md"\nlicense = "MIT"\nurls = { Home = "https://x" }\n'))).toEqual([
		'lint-py (pyproject.toml) lacks README',
	]);
	expect(problems(project('dynamic = ["readme", "license", "urls"]\n'))).toEqual([]);
	expect(problems(project('', {}))).toEqual(['lint-py (pyproject.toml) lacks README, license, a license file, urls']);
});

test('the check reports only the selected packages', () => {
	const inventory = discover(snapshot({
		'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\n',
		'crates/core/Cargo.toml': '[package]\nname = "core"\nversion = "1.0.0"\n',
		'crates/cli/Cargo.toml': '[package]\nname = "cli"\nversion = "1.0.0"\n',
	}));
	const cli = inventory.packages.filter(pkg => pkg.name === 'cli');
	expect(metadataProblems(inventory, cli)).toEqual([
		'cli (crates/cli/Cargo.toml) lacks README, description, license, a license file, repository',
	]);
});
