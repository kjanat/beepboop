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

test('a card with an open onboarding PR links it instead of offering the button', async () => {
	const { discover } = await import('#automation/managers');
	const snapshot = {
		repository: { id: 9, name: 'example/linked', defaultBranch: 'main' },
		sha: 'b'.repeat(40),
		files: { 'package.json': '{"name":"linked","version":"1.0.0"}' },
	};
	const repository = {
		...snapshot.repository,
		sha: snapshot.sha,
		inventory: discover(snapshot),
		diagnostics: [],
		presetShas: {},
		updatedAt: 0,
	};
	const page = await renderDashboard([repository], [], new Map([[9, 'https://github.com/example/linked/pull/4']]))
		.text();
	expect(page).toContain('Onboarding PR: <a href="https://github.com/example/linked/pull/4">');
	expect(page).not.toContain('data-onboard=');
	expect(await renderDashboard([repository], []).text()).toContain('data-onboarding="9"');
});

test('onboarding rows yield each repository PR and skip rows without one', async () => {
	const { onboardingPulls } = await import('#automation/store');
	expect(onboardingPulls([
		{ repository_id: 1, document: JSON.stringify({ url: 'https://github.com/a/b/pull/1', head: 'x' }) },
		{ repository_id: 2, document: JSON.stringify({ head: 'y' }) },
	])).toEqual(new Map([[1, 'https://github.com/a/b/pull/1']]));
});

test('same-origin form posts carry the Origin header the administrator check requires', async () => {
	const response = renderDashboard([], []);
	expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
	expect(await response.text()).toContain('<form action="/auth/logout" method="post">');
});

test('repository cards link the repository, commit, workflows, manifests and published versions', async () => {
	const { discover } = await import('#automation/managers');
	const sha = 'c'.repeat(40);
	const snapshot = {
		repository: { id: 11, name: 'example/linked-refs', defaultBranch: 'main' },
		sha,
		files: {
			'package.json': '{"name":"@scope/tool","version":"1.2.0"}',
			'.github/workflows/release.yml': 'on:\n  push:\n    tags: ["v*"]\njobs: {}\n',
		},
	};
	const repository = {
		...snapshot.repository,
		sha,
		inventory: discover(snapshot),
		diagnostics: [],
		presetShas: {},
		updatedAt: 0,
	};
	const page = await renderDashboard([repository], []).text();
	expect(page).toContain('<h3><a href="https://github.com/example/linked-refs">example/linked-refs</a></h3>');
	expect(page).toContain(`<a href="https://github.com/example/linked-refs/commit/${sha}">${sha.slice(0, 12)}</a>`);
	expect(page).toContain(
		`<a href="https://github.com/example/linked-refs/blob/${sha}/.github/workflows/release.yml">release.yml</a>`,
	);
	expect(page).toContain(`<a href="https://github.com/example/linked-refs/blob/${sha}/package.json">@scope/tool</a>`);
	expect(page).toContain('<a href="https://www.npmjs.com/package/%40scope/tool/v/1.2.0">1.2.0</a>');
});

test('link helpers encode path segments and only link registries they know', async () => {
	const { githubHref, link, registryHref } = await import('../src/ui/templates/html.ts');
	expect(githubHref('o/r', 'blob', 'abc', 'dir/a b.json')).toBe('https://github.com/o/r/blob/abc/dir/a%20b.json');
	expect(registryHref('cargo', 'crate', '0.1.0')).toBe('https://crates.io/crates/crate/0.1.0');
	expect(registryHref('workflow', 'x', '1')).toBeUndefined();
	expect(link('https://x/"', '<b>')).toBe('<a href="https://x/&quot;">&lt;b&gt;</a>');
});

test('execution cards link the repository, source commit and workflow run', async () => {
	const { parseRepositoryConfiguration } = await import('#automation/configuration');
	const sha = 'd'.repeat(40);
	const execution: import('#automation/types').Execution = {
		id: 'exec-1',
		repositoryId: 12,
		repository: 'example/runs',
		stream: 'main',
		operation: 'release',
		eventId: 'event-1',
		configuration: parseRepositoryConfiguration({}),
		configurationSha: sha,
		presetShas: {},
		sourceSha: sha,
		state: 'succeeded',
		dependencies: [],
		runId: 4242,
		attempts: 1,
		publications: [],
		artifacts: [],
		createdAt: 0,
		updatedAt: 0,
	};
	const page = await renderDashboard([], [execution]).text();
	expect(page).toContain('<h3><a href="https://github.com/example/runs">example/runs</a> · main / release</h3>');
	expect(page).toContain(`<a href="https://github.com/example/runs/commit/${sha}">${sha}</a>`);
	expect(page).toContain('<a href="https://github.com/example/runs/actions/runs/4242">Workflow run 4242</a>');
});
