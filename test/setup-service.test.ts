import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';

function required<T>(value: T | null | undefined): T {
	assert(value !== undefined && value !== null);
	return value;
}

import { credentialHash } from '@/automation/cli-auth';
import { type AutomationBindings, AutomationService } from '@/automation/service';
import type { SetupPlan } from '@/automation/setup-types';
import type { Snapshot } from '@/automation/types';

async function fixture() {
	const db = new Database(':memory:');
	db.exec(
		'CREATE TABLE sessions(id TEXT PRIMARY KEY, document TEXT, expires_at INTEGER); CREATE TABLE onboarding(repository_id INTEGER PRIMARY KEY, document TEXT);',
	);
	const token = `cli_${'c'.repeat(64)}`;
	db.query('INSERT INTO sessions VALUES(?,?,?)').run(
		`cli:${await credentialHash(token)}`,
		JSON.stringify({ kind: 'cli', subject: 'admin' }),
		Date.now() + 60000,
	);
	let writes = 0;
	const DB = {
		prepare(sql: string) {
			return {
				bind(...args: (string | number)[]) {
					return {
						async first() {
							return db.query(sql).get(...args);
						},
						async run() {
							writes++;
							return db.query(sql).run(...args);
						},
					};
				},
			};
		},
	} as unknown as D1Database;
	const service = new AutomationService(
		{
			DB,
			OWNER_ID: '1',
			ADMIN_SUBJECT: 'admin',
			APPLICATION_ORIGIN: 'https://setup.test',
			OPENAUTH_ISSUER: 'https://issuer.test',
			OPENAUTH_CLIENT_ID: 'fixture',
		} as AutomationBindings,
	);
	let snapshot: Snapshot = {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: { 'package.json': '{"name":"tool","version":"1.0.0"}' },
	};
	let head: string | null = null, mutations = 0;
	service.gateway.identify = async () => 1;
	service.gateway.snapshot = async () => structuredClone(snapshot);
	service.gateway.setupHead = async () => head;
	service.gateway.canEditWorkflows = async () => true;
	service.gateway.pullRequest = async (_snapshot, _branch, _title, _body, edits, expected) => {
		expect(expected).toBe(head ?? undefined);
		expect(edits.length).toBe(3);
		mutations++;
		head = 'd'.repeat(40);
		return { url: 'https://github.com/example/tool/pull/1', head };
	};
	service.gateway.refreshPullRequest = async () => {
		mutations++;
		return { url: 'https://github.com/example/tool/pull/1', head: required(head) };
	};
	service.store.audit = async () => {};
	const choices = {
		actionsRevision: 'b'.repeat(40),
		streams: [{
			name: 'tool',
			packages: ['pkg:npm/tool'],
			required: ['pkg:npm/tool'],
			versioning: 'workspace',
			prepare: {
				file: 'prepare.yml',
				commands: 'bun install\nbun test',
				triggers: 'dispatchOnly',
				publicationSteps: {},
			},
			promote: { file: 'publish.yml', commands: 'npm publish', triggers: 'dispatchOnly', publicationSteps: {} },
		}],
	};
	const request = (operation: string, body: unknown, authenticated = true) =>
		service.fetch(
			new Request(`https://setup.test/api/repositories/setup/${operation}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify(body),
			}),
		);
	const preview = async () =>
		(await request('preview', { repository: 'example/tool', choices })).json() as Promise<SetupPlan>;
	const apply = (plan: SetupPlan) =>
		request('apply', {
			repository: plan.repository,
			choices: plan.choices,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
			planId: plan.planId,
		});
	return {
		db,
		request,
		preview,
		apply,
		choices,
		writes: () => writes,
		mutations: () => mutations,
		advance() {
			snapshot = { ...snapshot, sha: 'e'.repeat(40) };
		},
		editBranch() {
			head = 'f'.repeat(40);
		},
	};
}
test('authenticated preview is read-only and apply requires exactly the reviewed plan', async () => {
	const context = await fixture();
	try {
		expect((await context.request('preview', {}, false)).status).toBe(401);
		const plan = await context.preview();
		expect(plan.blockers).toEqual([]);
		expect(context.writes()).toBe(0);
		expect(context.mutations()).toBe(0);
		const tampered = structuredClone(plan);
		required(required(tampered.choices.streams[0]).prepare).commands = 'echo altered';
		await expect(context.apply(tampered)).rejects.toThrow('preview again');
		expect(context.mutations()).toBe(0);
		const response = await context.apply(plan);
		expect((await response.json() as { url: string }).url).toEndWith('/pull/1');
		expect(context.writes()).toBe(1);
		expect(context.mutations()).toBe(1);
		await expect(context.apply(plan)).rejects.toThrow('preview again');
		expect(context.mutations()).toBe(1);
	} finally {
		context.db.close();
	}
});
test('new source commits and intervening human branch edits invalidate setup', async () => {
	const context = await fixture();
	try {
		const plan = await context.preview();
		context.advance();
		await expect(context.apply(plan)).rejects.toThrow('preview again');
		const latest = await context.preview();
		context.editBranch();
		await expect(context.apply(latest)).rejects.toThrow('preview again');
		const conflict = await context.preview();
		await expect(context.apply(conflict)).rejects.toThrow('human edits');
		expect(context.mutations()).toBe(0);
	} finally {
		context.db.close();
	}
});
