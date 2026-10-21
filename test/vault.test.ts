import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import sodium from 'libsodium-wrappers';
import { seal } from 'tweetnacl-sealedbox-js';
import { base64, type WorkflowIdentity } from '#automation/auth';
import { Store } from '#automation/store';
import { parseGrant, Vault } from '#automation/vault';

function database(): { store: Store; sqlite: Database } {
	const sqlite = new Database(':memory:');
	sqlite.exec(readFileSync(new URL('../migrations/0001_automation.sql', import.meta.url), 'utf8'));
	const prepare = (sql: string, args: unknown[] = []): unknown => ({
		bind: (...values: unknown[]) => prepare(sql, values),
		first: async () => sqlite.query(sql).get(...(args as never[])),
		all: async () => ({ results: sqlite.query(sql).all(...(args as never[])), success: true }),
		run: async () => ({
			success: true,
			meta: { changes: sqlite.query(sql).run(...(args as never[])).changes },
		}),
	});
	const db = {
		prepare,
		batch: async (statements: { run: () => Promise<unknown> }[]) => {
			sqlite.exec('BEGIN');
			try {
				const results = [];
				for (const s of statements) results.push(await s.run());
				sqlite.exec('COMMIT');
				return results;
			} catch (e) {
				sqlite.exec('ROLLBACK');
				throw e;
			}
		},
	} as unknown as D1Database;
	return { store: new Store(db), sqlite };
}
const identity: WorkflowIdentity = {
	repositoryId: 91,
	repository: 'example/seventh',
	ownerId: 1,
	runId: 7,
	attempt: 1,
	sha: 'a'.repeat(40),
	workflowSha: 'b'.repeat(40),
	workflowRef: 'example/seventh/.github/workflows/release.yml@refs/tags/v1.0.0',
	ref: 'refs/tags/v1.0.0',
	environment: 'npm',
	event: 'push',
};
describe('credential encryption and grants', () => {
	test('ciphertext is identity-bound and rotation retains one active version', async () => {
		const { store, sqlite } = database();
		const vault = new Vault(
			store,
			{ v1: base64(crypto.getRandomValues(new Uint8Array(32))) },
			'v1',
		);
		expect(await vault.replace('registry', 'fixture-value-1', 'admin')).toBe(1);
		expect(await vault.replace('registry', 'fixture-value-2', 'admin')).toBe(2);
		expect(await vault.reveal('registry', 'admin')).toEqual({
			value: 'fixture-value-2',
			version: 2,
		});
		expect(sqlite.query('SELECT count(*) AS n FROM credentials WHERE active=1').get()).toEqual({
			n: 1,
		});
		expect(JSON.stringify(sqlite.query('SELECT * FROM credentials').all())).not.toContain(
			'fixture-value',
		);
		expect(JSON.stringify(sqlite.query('SELECT * FROM audit').all())).not.toContain(
			'fixture-value',
		);
		sqlite.exec("UPDATE credentials SET alias='substituted' WHERE alias='registry'");
		await expect(vault.reveal('substituted', 'admin')).rejects.toThrow();
		sqlite.close();
	});
	test('rejects wrong repository, environment, ref and operation', async () => {
		const { store, sqlite } = database();
		const vault = new Vault(
			store,
			{ v1: base64(crypto.getRandomValues(new Uint8Array(32))) },
			'v1',
		);
		await vault.replace('registry', 'fixture-value', 'admin');
		await vault.grant(
			parseGrant({
				id: 'publish',
				alias: 'registry',
				repositoryId: 91,
				repository: 'example/seventh',
				operation: 'publish',
				workflow: 'release.yml',
				ref: 'refs/tags/v*',
				environment: 'npm',
				delivery: 'runtime',
			}),
			'admin',
		);
		expect(await vault.runtime('registry', 'publish', identity)).toBe('fixture-value');
		for (
			const altered of [
				{ ...identity, repositoryId: 92 },
				{ ...identity, environment: undefined },
				{ ...identity, ref: 'refs/heads/main' },
				{ ...identity, workflowRef: 'example/seventh/.github/workflows/evil.yml@refs/tags/v1.0.0' },
			]
		) {
			await expect(vault.runtime('registry', 'publish', altered)).rejects.toThrow('denied');
		}
		await expect(vault.runtime('registry', 'prepare', identity)).rejects.toThrow('denied');
		await vault.revoke('publish', 'admin');
		await expect(vault.runtime('registry', 'publish', identity)).rejects.toThrow('denied');
		sqlite.close();
	});
	test('GitHub secret encryption is interoperable with libsodium', async () => {
		await sodium.ready;
		const keys = sodium.crypto_box_keypair();
		const encrypted = seal(new TextEncoder().encode('fixture-value'), keys.publicKey);
		expect(
			new TextDecoder().decode(
				sodium.crypto_box_seal_open(encrypted, keys.publicKey, keys.privateKey),
			),
		).toBe('fixture-value');
	});
});
