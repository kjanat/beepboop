import { expect, test } from 'bun:test';
import { applyVersionFiles, versionFileSchema } from '#automation/editors';
import { discover } from '#automation/managers';
import { planReleaseSet } from '#automation/planning';
import type { Snapshot } from '#automation/types';

const snapshot: Snapshot = {
	repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: {
		'package.json': '{"name":"tool","version":"1.0.0"}',
		'version.json': '{ "release": { "version": "1.0.0" }, "untouched": 10 }\n',
		'version.yaml': '# document\nrelease:\n  version: "1.0.0" # retained\nother: true\n',
		'version.toml': '# document\n[release]\nversion = "1.0.0" # retained\nother = true\n',
		'version.txt': 'before\nVERSION="1.0.0"\nafter\n',
	},
};
const rules = [
	{ path: 'version.json', format: 'json', key: ['release', 'version'] },
	{ path: 'version.yaml', format: 'yaml', key: ['release', 'version'] },
	{ path: 'version.toml', format: 'toml', key: ['release', 'version'] },
	{ path: 'version.txt', format: 'text', prefix: 'VERSION="', suffix: '"' },
].map(rule => versionFileSchema.parse(rule));

test('version editors preserve surrounding content in all four formats', () => {
	const files = { ...snapshot.files };
	applyVersionFiles(snapshot, files, rules, { tool: '2.0.0' });
	for (const rule of rules) expect(files[rule.path]).toBe(snapshot.files[rule.path]?.replace('1.0.0', '2.0.0'));
	const after = { ...snapshot, files };
	applyVersionFiles(after, files, rules, { tool: '2.0.0' });
	expect(files).toEqual(after.files);
});
test('configured version fields compose with ecosystem release edits', () => {
	const plan = planReleaseSet(
		snapshot,
		discover(snapshot),
		{
			groups: [{ id: 'tool', packages: ['npm:tool'], version: { bump: 'minor' } }],
		},
		undefined,
		rules,
	);
	expect(plan.edits).toHaveLength(5);
	expect(plan.edits.every(edit => edit.after.includes('1.1.0'))).toBe(true);
});
test('rejects unsafe paths, ambiguous selectors, unsupported TOML, and conflicting targets', () => {
	expect(() => versionFileSchema.parse({ ...rules[0], path: '../version.json' })).toThrow();
	expect(() =>
		applyVersionFiles(snapshot, { ...snapshot.files }, [rules[0], rules[0]].filter(rule => rule !== undefined), {
			tool: '2.0.0',
		})
	).toThrow('Duplicate');
	expect(() => applyVersionFiles(snapshot, { ...snapshot.files }, rules, { cli: '2.0.0', core: '3.0.0' })).toThrow(
		'known release group',
	);
	const edited = { ...snapshot.files, 'version.json': '{"release":{"version":"3.0.0"}}' };
	expect(() => applyVersionFiles(snapshot, edited, rules, { tool: '2.0.0' })).toThrow('Conflicting');
	const inline = { ...snapshot, files: { 'version.toml': 'release = { version = "1.0.0" }\n' } };
	expect(() =>
		applyVersionFiles(inline, { ...inline.files }, rules.filter(rule => rule.format === 'toml'), { tool: '2.0.0' })
	).toThrow('safely locate');
});
test('YAML aliases and shared anchors cannot cause hidden version changes', () => {
	const anchored = { ...snapshot, files: { 'version.yaml': 'release: {version: &v "1.0.0"}\nother: *v\n' } };
	expect(() =>
		applyVersionFiles(anchored, { ...anchored.files }, rules.filter(rule => rule.format === 'yaml'), { tool: '2.0.0' })
	).toThrow('anchors');
});
