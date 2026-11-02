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
	expect(registryHref('cargo', 'crate', '0.1.0', 'o/r')).toBe('https://crates.io/crates/crate/0.1.0');
	expect(registryHref('go', 'actionlint.kjanat.dev/v2', '2.0.0-rc.1', 'o/r')).toBe(
		'https://pkg.go.dev/actionlint.kjanat.dev/v2@v2.0.0-rc.1',
	);
	expect(registryHref('goreleaser', 'actionlint', '1.17.0', 'kjanat/actionlint')).toBe(
		'https://github.com/kjanat/actionlint/releases/tag/v1.17.0',
	);
	expect(registryHref('workflow', 'x', '1', 'o/r')).toBeUndefined();
	expect(link('https://x/"', '<b>')).toBe('<a href="https://x/&quot;">&lt;b&gt;</a>');
});

test('repository cards show the published version, the differing manifest version and unreleased packages', async () => {
	const { discover, resolvePublished } = await import('#automation/managers');
	const { edgeFetch } = await import('./edge-fetch.ts');
	const sha = 'e'.repeat(40);
	const snapshot = {
		repository: { id: 13, name: 'kjanat/actionlint', defaultBranch: 'master' },
		sha,
		files: {
			'distribution/npm/facade/package.json': '{"name":"@kjanat/actionlint","version":"0.0.0"}',
			'packages/feed/package.json': '{"name":"feed","version":"0.0.3"}',
			'.goreleaser.yaml': 'version: 2\nproject_name: actionlint\n',
			'go.mod': 'module actionlint.kjanat.dev/v2\n',
		},
		tags: ['v1.16.1', 'v1.17.0'],
	};
	const registry = edgeFetch(url =>
		url.includes('%40kjanat%2Factionlint') ? Response.json({ latest: '1.17.0' }) : Response.json({ latest: '0.0.3' })
	);
	const repository = {
		...snapshot.repository,
		sha,
		inventory: await resolvePublished(discover(snapshot), registry.fetch),
		diagnostics: [],
		presetShas: {},
		updatedAt: 0,
	};
	const page = await renderDashboard([repository], []).text();
	expect(page).toContain(
		'<td><a href="https://www.npmjs.com/package/%40kjanat/actionlint/v/1.17.0">1.17.0</a> <small>manifest 0.0.0</small></td>',
	);
	expect(page).toContain('<td><a href="https://www.npmjs.com/package/feed/v/0.0.3">0.0.3</a></td>');
	expect(page).toContain(
		'<td><a href="https://github.com/kjanat/actionlint/releases/tag/v1.17.0">1.17.0</a></td>',
	);
	expect(page).toContain('<td>unreleased</td>');
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

test('the activity tab renders a table with linked runs, repositories and targets', async () => {
	const { discover } = await import('#automation/managers');
	const snapshot = {
		repository: { id: 21, name: 'example/audited', defaultBranch: 'main' },
		sha: 'e'.repeat(40),
		files: {},
	};
	const repository = {
		...snapshot.repository,
		sha: snapshot.sha,
		inventory: discover(snapshot),
		diagnostics: [],
		presetShas: {},
		updatedAt: 0,
	};
	const activity = [
		{
			id: 'a',
			actor: 'run:77',
			action: 'token.issued',
			target: 'example/audited contents:write',
			createdAt: Date.UTC(2026, 10, 2, 14, 30, 5),
		},
		{ id: 'b', actor: 'subject-hash', action: 'repository.onboard', target: '21', createdAt: 0 },
		{
			id: 'c',
			actor: 'run:78',
			action: 'release.prepared',
			target: 'https://github.com/example/audited/pull/3',
			createdAt: 0,
		},
		{ id: 'd', actor: 'subject-hash', action: 'credential.replace', target: '<alias>', createdAt: 0 },
	];
	const page = await renderDashboard([repository], [], new Map(), 1, activity).text();
	expect(page).not.toContain('<pre id="activity-list">');
	expect(page).toContain('<tbody id="activity-list">');
	expect(page).toContain('<time datetime="2026-11-02T14:30:05.000Z">2026-11-02 14:30:05 UTC</time>');
	expect(page).toContain('<a href="https://github.com/example/audited/actions/runs/77">Workflow run 77</a>');
	expect(page).toContain(
		'<a href="https://github.com/example/audited">example/audited</a> <span class="muted">contents:write</span>',
	);
	expect(page).toContain('<td>Administrator</td>\n\t\t\t<td><a href="https://github.com/example/audited">');
	expect(page).toContain('<a href="https://github.com/example/audited/actions/runs/78">Workflow run 78</a>');
	expect(page).toContain(
		'<a href="https://github.com/example/audited/pull/3">https://github.com/example/audited/pull/3</a>',
	);
	expect(page).toContain('<td>&lt;alias&gt;</td>');
});

test('activity rows fall back to plain text for unknown repositories and show an empty state', async () => {
	const { renderActivityRows } = await import('../src/ui/templates/activity.ts');
	expect(renderActivityRows([], [])).toBe('<tr><td colspan="4">No activity yet.</td></tr>');
	const rows = renderActivityRows([
		{ id: 'a', actor: 'run:5', action: 'release.prepared', target: 'not a repository', createdAt: 0 },
		{ id: 'b', actor: 'subject-hash', action: 'repository.onboard', target: '404', createdAt: 0 },
	], []);
	expect(rows).toContain('<td>Workflow run 5</td>');
	expect(rows).toContain('<td>404</td>');
});

test('the first key enrollment asks only for a key name and later enrollments require a key touch', async () => {
	const first = await renderDashboard([], []).text();
	expect(first).toContain('<form id="enroll" data-first="true">');
	expect(first).not.toContain('bootstrap');
	const later = await renderDashboard([], [], new Map(), 1).text();
	expect(later).toContain('<form id="enroll">');
	expect(later).toContain('Enrolling another key requires a touch of an enrolled key.');
});
