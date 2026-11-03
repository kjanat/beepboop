import { fixture } from '@root/test/runtime/fixtures';

export async function seedBrowser(db: D1Database): Promise<void> {
	const repository = {
		id: 91,
		name: 'example/seventh',
		defaultBranch: 'main',
		sha: 'a'.repeat(40),
		configuration: {
			...fixture.configuration,
			winget: { config: 'distribution/winget.json', tagPrefix: 'v', automatic: false },
			streams: {
				main: {
					...fixture.configuration.streams.main,
					credentials: ['npm-token'],
					workflows: { publish: { file: 'release.yml', ref: 'refs/heads/main' } },
				},
			},
		},
		presetShas: {},
		diagnostics: [],
		updatedAt: Date.now(),
		inventory: {
			packages: [{
				name: 'example-cli',
				manager: 'npm',
				version: '1.2.3',
				published: '1.2.2',
				manifest: 'package.json',
				versionSource: 'package.json',
				publication: { kind: 'registry' },
				dependencies: [],
			}],
			workflows: [{
				name: 'Release',
				file: 'release.yml',
				events: ['workflow_dispatch'],
				dispatchInputs: ['beepboop_execution_id'],
				jobs: [],
				localActions: [],
				publication: true,
			}],
			publicationOrder: ['npm:example-cli'],
			managers: ['npm'],
			diagnostics: [],
		},
	};
	await db.prepare('INSERT OR REPLACE INTO repositories(id,name,document,updated_at) VALUES(?,?,?,?)').bind(
		91,
		repository.name,
		JSON.stringify(repository),
		Date.now(),
	).run();
	await db.prepare('INSERT OR REPLACE INTO credentials VALUES(?,?,?,?,?,1,?)').bind(
		'npm-token',
		1,
		'fixture',
		'fixture',
		'fixture',
		Date.now(),
	).run();
	await db.prepare('INSERT OR REPLACE INTO authenticators VALUES(?,?,?)').bind(
		'fixture-key',
		'user:fixture',
		JSON.stringify({ id: 'fixture-key', label: 'Fixture key', publicKey: 'fixture', counter: 0 }),
	).run();
}

export async function seedOnboarding(db: D1Database): Promise<void> {
	const { discover } = await import('@/automation/managers');
	const snapshot = {
		repository: { id: 92, name: 'example/private-app', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: {
			'package.json': '{"name":"private-app","private":true}',
			'.github/workflows/deploy.yml':
				'name: Deploy\non: workflow_dispatch\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run deploy\n',
		},
	};
	const repository = {
		...snapshot.repository,
		sha: snapshot.sha,
		inventory: discover(snapshot),
		diagnostics: ['Onboarding configuration is not merged'],
		presetShas: {},
		updatedAt: Date.now(),
	};
	await db.prepare('INSERT OR REPLACE INTO repositories(id,name,document,updated_at) VALUES(?,?,?,?)').bind(
		92,
		repository.name,
		JSON.stringify(repository),
		repository.updatedAt,
	).run();
	await db.prepare('INSERT OR REPLACE INTO onboarding VALUES(?,?)').bind(
		92,
		JSON.stringify({ url: 'https://github.com/example/private-app/pull/10' }),
	).run();
}
