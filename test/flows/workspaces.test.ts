import { afterEach, beforeEach, expect, test } from 'bun:test';
import { bearer } from '@root/test/support/http.ts';
import { World } from '@root/test/support/world.ts';
import { z } from 'zod';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

const inventory = z.object({
	inventory: z.object({
		packages: z.array(z.object({
			manager: z.string(),
			name: z.string(),
			manifest: z.string(),
			publication: z.looseObject({ kind: z.string() }),
		})),
	}),
});
async function packages(files: Record<string, string>) {
	const repository = world.github.create('octo/workspace', files);
	const api = bearer(world, await world.cliSession());
	const discovered = await api('/api/repositories/discover', { repository: repository.name });
	expect(discovered.status).toBe(200);
	return inventory.parse(discovered.body).inventory.packages.map(pkg => [
		pkg.manager,
		pkg.name,
		pkg.manifest,
		pkg.publication.kind,
		...(typeof pkg.publication.reason === 'string' ? [pkg.publication.reason] : []),
	]).sort((left, right) => String(left[2]).localeCompare(String(right[2])));
}

test('Cargo workspace members under vendor are discovered, with the path dependencies Cargo adds', async () => {
	expect(
		await packages({
			'Cargo.toml':
				'[workspace]\nmembers = ["crates/*", "vendor/sqlparser"]\nexclude = ["vendor/sqlparser/bench"]\n\n[workspace.package]\nversion = "0.1.0"\n\n[workspace.dependencies]\nsqlparser = { package = "fsql-sqlparser", path = "vendor/sqlparser", version = "0.1.0" }\n',
			'crates/fsql/Cargo.toml':
				'[package]\nname = "fsql"\nversion.workspace = true\n\n[dependencies]\nsqlparser = { workspace = true }\n',
			'vendor/sqlparser/Cargo.toml':
				'[package]\nname = "fsql-sqlparser"\nversion.workspace = true\n\n[dependencies]\nsqlparser_derive = { path = "derive", version = "0.6.0", optional = true }\n\n[dev-dependencies]\nbench = { path = "bench" }\n',
			'vendor/sqlparser/derive/Cargo.toml':
				'[package]\nname = "sqlparser_derive"\nversion = "0.6.0"\npublish = false\n',
			'vendor/sqlparser/bench/Cargo.toml': '[package]\nname = "sqlparser_bench"\nversion = "0.1.0"\n',
			'vendor/sqlparser/fuzz/Cargo.toml': '[package]\nname = "fuzz"\nversion = "0.1.0"\n',
			'vendor/other/Cargo.toml': '[package]\nname = "other"\nversion = "0.1.0"\n',
		}),
	).toEqual([
		['cargo', 'fsql', 'crates/fsql/Cargo.toml', 'registry'],
		['cargo', 'fsql-sqlparser', 'vendor/sqlparser/Cargo.toml', 'registry'],
		['cargo', 'sqlparser_derive', 'vendor/sqlparser/derive/Cargo.toml', 'excluded', 'publish-disabled'],
	]);
});

test('npm and Bun workspaces under vendor are discovered and unclaimed fixtures stay out', async () => {
	expect(
		await packages({
			'package.json': '{"name":"root","private":true,"workspaces":["vendor/*","!vendor/skipped"]}',
			'vendor/lib/package.json': '{"name":"vendored-lib","version":"1.0.0"}',
			'vendor/skipped/package.json': '{"name":"skipped","version":"1.0.0"}',
			'fixtures/demo/package.json': '{"name":"demo","version":"1.0.0"}',
		}),
	).toEqual([
		['npm', 'root', 'package.json', 'excluded', 'private'],
		['npm', 'vendored-lib', 'vendor/lib/package.json', 'registry'],
	]);
});

test('pnpm workspaces under fixtures are discovered', async () => {
	expect(
		await packages({
			'package.json': '{"name":"root","private":true}',
			'pnpm-workspace.yaml': 'packages:\n  - fixtures/published\n',
			'fixtures/published/package.json': '{"name":"published","version":"1.0.0"}',
			'fixtures/other/package.json': '{"name":"other","version":"1.0.0"}',
		}),
	).toEqual([
		['npm', 'published', 'fixtures/published/package.json', 'registry'],
		['npm', 'root', 'package.json', 'excluded', 'private'],
	]);
});

test('uv workspace members under testdata are discovered', async () => {
	expect(
		await packages({
			'pyproject.toml':
				'[project]\nname = "root"\nversion = "1.0.0"\n\n[tool.uv.workspace]\nmembers = ["testdata/*"]\nexclude = ["testdata/skipped"]\n',
			'testdata/bench/pyproject.toml': '[project]\nname = "bench"\nversion = "1.0.0"\n',
			'testdata/skipped/pyproject.toml': '[project]\nname = "skipped"\nversion = "1.0.0"\n',
		}),
	).toEqual([
		['pypi', 'root', 'pyproject.toml', 'registry'],
		['pypi', 'bench', 'testdata/bench/pyproject.toml', 'registry'],
	]);
});
