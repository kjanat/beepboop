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
				publish: true,
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
			managers: ['npm'],
			diagnostics: [],
		},
	};
	await db.prepare('INSERT OR REPLACE INTO repositories VALUES(?,?,?,?)').bind(
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
