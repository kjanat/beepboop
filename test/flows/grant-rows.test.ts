import { expect, test } from 'bun:test';
import { TestD1 } from '@root/test/support/d1.ts';
import { Cause, Effect, Exit } from 'effect';
import { GrantStore } from '@/credentials/adapters/d1/grants.ts';
import type { Grant } from '@/credentials/grant.ts';
import { grantRow, parseGrant, requestGrant } from '@/credentials/grant.ts';
import { DomainError } from '@/kernel/errors/domain-error.ts';
import { credentialAliasPattern } from '@/kernel/schema/ids.ts';

const fields = {
	id: 'grant-1',
	alias: 'npm-token',
	repositoryId: 42,
	repository: 'octo/widget',
	operation: 'promote',
	workflow: 'release.yml',
	ref: 'refs/heads/main',
};

const rows = {
	Runtime: { ...fields, delivery: 'runtime' },
	'Runtime with environment': { ...fields, delivery: 'runtime', environment: 'release' },
	RepositorySecret: { ...fields, delivery: 'repository', secretName: 'NPM_TOKEN' },
	'RepositorySecret with environment': {
		...fields,
		delivery: 'repository',
		environment: 'release',
		secretName: 'NPM_TOKEN',
	},
	EnvironmentSecret: { ...fields, delivery: 'environment', environment: 'release', secretName: 'NPM_TOKEN' },
};

function failure(exit: Exit.Exit<unknown, DomainError>): DomainError {
	if (Exit.isSuccess(exit)) throw new Error('Expected the row to fail decoding');
	const error = Cause.squash(exit.cause);
	if (!(error instanceof DomainError)) throw new Error('Expected a DomainError');
	return error;
}

const shapes: [string, Grant['_tag'], Record<string, unknown>][] = [
	['Runtime', 'Runtime', rows.Runtime],
	['Runtime with environment', 'Runtime', rows['Runtime with environment']],
	['RepositorySecret', 'RepositorySecret', rows.RepositorySecret],
	['RepositorySecret with environment', 'RepositorySecret', rows['RepositorySecret with environment']],
	['EnvironmentSecret', 'EnvironmentSecret', rows.EnvironmentSecret],
];

for (const [name, tag, row] of shapes) {
	test(`a ${name} row decodes and encodes to the same JSON`, async () => {
		const grant = await Effect.runPromise(parseGrant(JSON.parse(JSON.stringify(row))));
		expect(grant._tag).toBe(tag);
		expect(JSON.stringify(grantRow(grant))).toBe(JSON.stringify(row));
	});
}

test('the grant store reads every row shape and writes the same documents back', async () => {
	const db = new TestD1();
	for (const [index, [, , row]] of shapes.entries()) {
		db.sqlite.run('INSERT INTO grants(id,alias,repository_id,document) VALUES(?,?,?,?)', [
			`grant-${index}`,
			'npm-token',
			42,
			JSON.stringify({ ...row, id: `grant-${index}` }),
		]);
	}
	const stored = () => db.sqlite.query('SELECT id,alias,repository_id,document FROM grants ORDER BY id').all();
	const before = stored();
	const store = new GrantStore(db);
	const grants = await Effect.runPromise(store.list({ alias: 'npm-token', repositoryId: 42 }));
	expect(grants.map(grant => grant._tag)).toEqual(shapes.map(([, tag]) => tag));
	await Effect.runPromise(Effect.forEach(grants, grant => store.put(grant)));
	expect(stored()).toEqual(before);
});

test('an encoded grant lists its keys in the stored order whatever order the request used', async () => {
	const grant = await Effect.runPromise(requestGrant({
		secretName: 'NPM_TOKEN',
		environment: 'release',
		delivery: 'environment',
		ref: 'refs/heads/main',
		workflow: 'release.yml',
		operation: 'promote',
		repository: 'octo/widget',
		repositoryId: 42,
		alias: 'npm-token',
		id: 'grant-1',
	}));
	expect(Object.keys(grantRow(grant))).toEqual([
		'id',
		'alias',
		'repositoryId',
		'repository',
		'operation',
		'workflow',
		'ref',
		'delivery',
		'environment',
		'secretName',
	]);
});

test('a grant row drops keys outside its delivery', async () => {
	const retired = await Effect.runPromise(parseGrant({ ...rows.Runtime, retired: true }));
	expect(JSON.stringify(grantRow(retired))).toBe(JSON.stringify(rows.Runtime));
	const named = await Effect.runPromise(parseGrant({ ...rows.Runtime, secretName: 'NPM_TOKEN' }));
	expect(JSON.stringify(grantRow(named))).toBe(JSON.stringify(rows.Runtime));
});

const union =
	'Expected { "delivery": "runtime", ... } | { "delivery": "repository", ... } | { "delivery": "environment", ... }';
const malformed: [string, unknown, string, { path: string[]; message: string }][] = [
	['a string', 'grant', union, { path: [], message: union }],
	['null', null, union, { path: [], message: union }],
	['an array', [], union, { path: [], message: union }],
	['a row without delivery', fields, union, { path: [], message: union }],
	['an unknown delivery', { ...fields, delivery: 'carrier-pigeon' }, union, { path: [], message: union }],
	[
		'an empty id',
		{ ...rows.Runtime, id: '' },
		'Expected a value with a length of at least 1\n  at ["id"]',
		{ path: ['id'], message: 'Expected a valid value' },
	],
	[
		'a missing id',
		Object.fromEntries(Object.entries(rows.Runtime).filter(([key]) => key !== 'id')),
		'Missing key\n  at ["id"]',
		{ path: ['id'], message: 'Missing key' },
	],
	[
		'an alias with spaces',
		{ ...rows.Runtime, alias: 'npm token' },
		`Expected a string matching the RegExp ${credentialAliasPattern.source}\n  at ["alias"]`,
		{ path: ['alias'], message: 'Expected a valid value' },
	],
	[
		'a zero repository id',
		{ ...rows.Runtime, repositoryId: 0 },
		'Expected a value greater than 0\n  at ["repositoryId"]',
		{ path: ['repositoryId'], message: 'Expected a valid value' },
	],
	[
		'a fractional repository id',
		{ ...rows.Runtime, repositoryId: 4.2 },
		'Expected an integer\n  at ["repositoryId"]',
		{ path: ['repositoryId'], message: 'Expected a valid value' },
	],
	[
		'a string repository id',
		{ ...rows.Runtime, repositoryId: '42' },
		'Expected number\n  at ["repositoryId"]',
		{ path: ['repositoryId'], message: 'Expected number' },
	],
	[
		'a repository without owner',
		{ ...rows.Runtime, repository: 'widget' },
		'Expected a string matching the RegExp ^[\\w.-]+\\/[\\w.-]+$\n  at ["repository"]',
		{ path: ['repository'], message: 'Expected a valid value' },
	],
	[
		'an empty operation',
		{ ...rows.Runtime, operation: '' },
		'Expected a value with a length of at least 1\n  at ["operation"]',
		{ path: ['operation'], message: 'Expected a valid value' },
	],
	[
		'a workflow outside YAML',
		{ ...rows.Runtime, workflow: 'release.txt' },
		'Expected a string matching the RegExp ^[\\w-][\\w.-]*\\.ya?ml$\n  at ["workflow"]',
		{ path: ['workflow'], message: 'Expected a valid value' },
	],
	[
		'a bare ref',
		{ ...rows.Runtime, ref: 'main' },
		'Expected a string starting with "refs/"\n  at ["ref"]',
		{ path: ['ref'], message: 'Expected a valid value' },
	],
	[
		'a runtime row with an empty environment',
		{ ...rows.Runtime, environment: '' },
		'Expected a value with a length of at least 1\n  at ["environment"]',
		{ path: ['environment'], message: 'Expected a valid value' },
	],
	[
		'a runtime row with an empty secret name',
		{ ...rows.Runtime, secretName: '' },
		'Expected a value with a length of at least 1\n  at ["secretName"]',
		{ path: ['secretName'], message: 'Expected a valid value' },
	],
	[
		'a repository row without a secret name',
		{ ...fields, delivery: 'repository' },
		'Secret name required\n  at ["secretName"]',
		{ path: ['secretName'], message: 'Secret name required' },
	],
	[
		'a repository row with an empty environment',
		{ ...rows.RepositorySecret, environment: '' },
		'Expected a value with a length of at least 1\n  at ["environment"]',
		{ path: ['environment'], message: 'Expected a valid value' },
	],
	[
		'an environment row without an environment',
		{ ...fields, delivery: 'environment', secretName: 'NPM_TOKEN' },
		'Missing key\n  at ["environment"]',
		{ path: ['environment'], message: 'Missing key' },
	],
	[
		'an environment row with an empty environment',
		{ ...rows.EnvironmentSecret, environment: '' },
		'Environment required\n  at ["environment"]',
		{ path: ['environment'], message: 'Expected a valid value' },
	],
	[
		'an environment row without a secret name',
		{ ...fields, delivery: 'environment', environment: 'release' },
		'Secret name required\n  at ["secretName"]',
		{ path: ['secretName'], message: 'Secret name required' },
	],
];

test('malformed grant rows fail to decode with the stored-row and request errors', async () => {
	for (const [name, row, detail, issue] of malformed) {
		const stored = failure(await Effect.runPromiseExit(parseGrant(row)));
		expect([name, stored.problem.code, stored.detail]).toEqual([name, 'internal', detail]);
		const requested = failure(await Effect.runPromiseExit(requestGrant(row)));
		expect([name, requested.problem, requested.message]).toEqual([
			name,
			{ code: 'invalid', issues: [issue] },
			issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
		]);
	}
});
