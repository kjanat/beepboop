import { expect, test } from 'bun:test';
import { crateMetadata, npmManifest, pythonMetadata } from '@root/test/support/repositories.ts';
import { discover } from '@/automation/managers';
import { metadataProblems } from '@/automation/package-metadata';
import type { Snapshot } from '@/automation/types';

function snapshot(files: Record<string, string>, extra: string[] = []): Snapshot {
	return {
		repository: { id: 1, name: 'octo/example', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: [...Object.keys(files), ...extra],
	};
}
function problems(files: Record<string, string>, extra: string[] = []): string[] {
	const inventory = discover(snapshot(files, extra));
	return metadataProblems(inventory, inventory.packages);
}

const workspace = '[workspace]\nmembers = ["crates/core"]\n';

test('a crate with a README, description, license and repository passes', () => {
	expect(problems({
		'Cargo.toml': workspace,
		'README.md': '# example\n',
		'crates/core/Cargo.toml': `[package]\nname = "core"\nversion = "1.0.0"\n${crateMetadata}`,
	})).toEqual([]);
});

test('a crate without a README is blocked with its name, manifest and the field', () => {
	expect(problems({
		'Cargo.toml': workspace,
		'crates/core/Cargo.toml': `[package]\nname = "core"\nversion = "1.0.0"\n${crateMetadata}`,
	})).toEqual(['core (crates/core/Cargo.toml) lacks README']);
});

test('cargo finds a README in the crate directory and reads inherited workspace fields', () => {
	const shared =
		'[workspace]\nmembers = ["crates/core"]\n\n[workspace.package]\ndescription = "Shared"\nlicense-file = "LICENSE"\nrepository = "https://github.com/octo/example"\nreadme = "README.md"\n';
	const inherited =
		'[package]\nname = "core"\nversion = "1.0.0"\ndescription.workspace = true\nlicense-file.workspace = true\nrepository.workspace = true\n';
	expect(problems({ 'Cargo.toml': workspace, 'crates/core/Cargo.toml': inherited }, ['crates/core/README.txt']))
		.toEqual(['core (crates/core/Cargo.toml) lacks description, license, repository']);
	expect(problems({ 'Cargo.toml': shared, 'crates/core/Cargo.toml': `${inherited}readme.workspace = true\n` }, [
		'README.md',
	])).toEqual([]);
	expect(problems({ 'Cargo.toml': shared, 'crates/core/Cargo.toml': inherited }, ['README.md']))
		.toEqual(['core (crates/core/Cargo.toml) lacks README']);
});

test('readme = false and a readme path that does not exist both block a crate', () => {
	const crate = (readme: string) => ({
		'Cargo.toml': workspace,
		'crates/core/README.md': '# core\n',
		'crates/core/Cargo.toml':
			`[package]\nname = "core"\nversion = "1.0.0"\ndescription = "Core"\nlicense = "MIT"\nrepository = "https://github.com/octo/example"\nreadme = ${readme}\n`,
	});
	expect(problems(crate('false'))).toEqual(['core (crates/core/Cargo.toml) lacks README']);
	expect(problems(crate('"../../docs/README.md"'))).toEqual(['core (crates/core/Cargo.toml) lacks README']);
	expect(problems(crate('"README.md"'))).toEqual([]);
});

test('an unpublished crate is never checked', () => {
	expect(problems({ 'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\npublish = false\n' })).toEqual([]);
});

test('an npm package needs a README next to package.json and its description, license and repository', () => {
	expect(problems({ 'package.json': npmManifest('widget', '1.0.0'), 'readme.markdown': '# widget\n' })).toEqual([]);
	expect(problems({ 'package.json': npmManifest('widget', '1.0.0', { repository: { url: 'git+https://x' } }) }, [
		'README',
	])).toEqual([]);
	expect(problems({ 'package.json': npmManifest('widget', '1.0.0'), 'docs/README.md': '# widget\n' })).toEqual([
		'widget (package.json) lacks README',
	]);
	expect(problems({ 'package.json': '{"name":"widget","version":"1.0.0","repository":{}}\n', 'README.md': '#\n' }))
		.toEqual(['widget (package.json) lacks description, license, repository']);
	expect(problems({ 'package.json': '{"name":"widget","version":"1.0.0","private":true}\n' })).toEqual([]);
});

test('a Python project needs a readme, a license and a project URL', () => {
	const project = (fields: string) => ({
		'pyproject.toml': `[project]\nname = "lint-py"\nversion = "1.0.0"\n${fields}`,
	});
	expect(problems(project(pythonMetadata))).toEqual([]);
	expect(problems(project('readme = "README.md"\nlicense = { file = "LICENSE" }\n'), ['README.md', 'LICENSE']))
		.toEqual(['lint-py (pyproject.toml) lacks urls']);
	expect(problems(project('readme = "README.md"\nlicense = "MIT"\nurls = { Home = "https://x" }\n'))).toEqual([
		'lint-py (pyproject.toml) lacks README',
	]);
	expect(problems(project('dynamic = ["readme", "license", "urls"]\n'))).toEqual([]);
	expect(problems(project(''))).toEqual(['lint-py (pyproject.toml) lacks README, license, urls']);
});

test('the check reports only the selected packages', () => {
	const inventory = discover(snapshot({
		'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\n',
		'crates/core/Cargo.toml': '[package]\nname = "core"\nversion = "1.0.0"\n',
		'crates/cli/Cargo.toml': '[package]\nname = "cli"\nversion = "1.0.0"\n',
	}));
	const cli = inventory.packages.filter(pkg => pkg.name === 'cli');
	expect(metadataProblems(inventory, cli)).toEqual([
		'cli (crates/cli/Cargo.toml) lacks README, description, license, repository',
	]);
});
