import { expect, test } from 'bun:test';
import { Script } from 'node:vm';
import { renderDashboard } from '#automation/ui';

test('release-set dashboard exposes preview, preparation and merged-revision controls', async () => {
	const page = await renderDashboard([], []).text();
	expect(page).toContain('id="release-set"');
	expect(page).toContain('id="start-set"');
	expect(page).toContain('Preview these groups and operations before preparing.');
	expect(page).toContain('/api/releases/start-set');
	const script = page.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
	if (!script) throw new Error('Missing dashboard script');
	expect(() => new Script(script)).not.toThrow();
});

test('every element the dashboard script looks up is on the page', async () => {
	const page = await renderDashboard([], []).text();
	const script = page.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1] ?? '';
	const ids = new Set([...script.matchAll(/["'`]#([a-z][\w-]*)/g)].map(([, id]) => id));
	expect([...ids]).toEqual(
		expect.arrayContaining(['feedback', 'credential-result', 'start-result', 'execution-result']),
	);
	for (const id of ids) expect(page).toContain(`id="${id}"`);
});

test('the feedback box is a contained block that hides when empty', async () => {
	const page = await renderDashboard([], []).text();
	const rule = page.match(/#feedback\s*\{([^}]*)\}/)?.[1]?.replace(/\s/g, '') ?? '';
	for (const declaration of ['display:block', 'max-height:35vh', 'overflow:auto', 'z-index:10']) {
		expect(rule).toContain(declaration);
	}
	expect(page).toMatch(/#feedback\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

test('a repository card offers onboarding only until it has a configuration', async () => {
	const { parseRepositoryConfiguration } = await import('#automation/configuration');
	const { discover } = await import('#automation/managers');
	const snapshot = {
		repository: { id: 7, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: { 'package.json': '{"name":"tool","version":"1.0.0"}' },
	};
	const awaiting = {
		...snapshot.repository,
		sha: snapshot.sha,
		inventory: discover(snapshot),
		diagnostics: ['Onboarding configuration is not merged'],
		presetShas: {},
		updatedAt: 0,
	};
	const awaitingPage = await renderDashboard([awaiting], []).text();
	expect(awaitingPage).toContain('data-onboard="example/tool" data-repository-id="7"');
	expect(awaitingPage).toContain('[data-onboard]');
	const configured = {
		...awaiting,
		diagnostics: [],
		configuration: parseRepositoryConfiguration({ streams: { main: { versioning: 'independent' } } }),
	};
	expect(await renderDashboard([configured], []).text()).not.toContain('data-onboard=');
});
