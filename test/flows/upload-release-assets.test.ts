import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Schedule } from 'effect';
import { uploadReleaseAssets } from '@/actions/upload-release-assets.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { TransientBackoff } from '@/kernel/http/retry.ts';

const content = Buffer.from([0, 255, 13, 32]);
const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
const releasePath = '/repos/test/demo/releases/4';
const uploadEndpoint = `https://uploads.github.com${releasePath}/assets`;
const file = 'output.tgz';
const remote = { id: 17, name: file, label: null, state: 'uploaded', size: content.length, digest };
const draft = { id: 4, draft: true, tag_name: 'v1', upload_url: `${uploadEndpoint}{?name,label}` };
let workspace: string;

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), 'beepboop-upload-test-'));
	writeFileSync(join(workspace, file), content);
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

function run(transport: Fetcher, extra: Record<string, string> = {}) {
	return Effect.runPromise(
		uploadReleaseAssets({
			GITHUB_WORKSPACE: workspace,
			GITHUB_REPOSITORY: 'test/demo',
			RELEASE_ID: '4',
			DRAFT_ID: '4',
			DRAFT_TAG: 'v1',
			GH_TOKEN: 'repo-token',
			ASSETS: file,
			...extra,
		}, transport).pipe(Effect.provideService(TransientBackoff, () => Schedule.forever)),
	);
}

test('uploads exact bytes with an optional filename and display label to the draft by ID', async () => {
	const name = 'download.tgz';
	const label = 'Installer (arm64 & amd64)';
	writeFileSync(join(workspace, 'assets.csv'), `asset,sha256,displayname,name\n${file},${digest},${label},${name}\n`);
	const requests: string[] = [];
	await run(async (input, init) => {
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		requests.push(`${init?.method} ${url.pathname}`);
		expect(headers.get('authorization')).toBe('Bearer repo-token');
		if (url.pathname === releasePath) return Response.json(draft);
		if (init?.method === 'GET') return Response.json([]);
		expect(url.origin).toBe('https://uploads.github.com');
		expect(url.searchParams.get('name')).toBe(name);
		expect(url.searchParams.get('label')).toBe(label);
		expect(headers.get('content-length')).toBe(String(content.length));
		expect(await new Response(init?.body).bytes()).toEqual(new Uint8Array(content));
		return Response.json({ ...remote, name, label }, { status: 201 });
	}, { MANIFEST_FILE: 'assets.csv', ASSETS: '', MANIFEST_FORMAT: 'csv' });
	expect(requests).toEqual([`GET ${releasePath}`, `GET ${releasePath}/assets`, `POST ${releasePath}/assets`]);
});

test('validates every SHA-256 and workspace path before calling GitHub', async () => {
	writeFileSync(join(workspace, 'bad'), content);
	symlinkSync(tmpdir(), join(workspace, 'outside'));
	let calls = 0;
	const transport = async () => {
		calls++;
		return Response.json(null);
	};
	await expect(run(transport, {
		ASSETS: JSON.stringify([{ asset: file }, { asset: 'bad', sha256: '0'.repeat(64) }]),
		MANIFEST_FORMAT: 'json',
	})).rejects.toThrow('SHA-256 mismatch');
	await expect(run(transport, { ASSETS: 'outside' })).rejects.toThrow('inside the workspace');
	expect(calls).toBe(0);
});

test('rejects a published release and an unexpected credential destination before upload', async () => {
	for (const release of [
		{ ...draft, draft: false },
		{ ...draft, tag_name: 'wrong' },
		{ ...draft, upload_url: 'https://example.org/upload' },
	]) {
		let calls = 0;
		await expect(run(async () => {
			calls++;
			return Response.json(release);
		})).rejects.toThrow();
		expect(calls).toBe(1);
	}
});

test('rechecks the draft after a lost upload response and reuses a matching remote digest', async () => {
	let published = false;
	let posts = 0;
	let releases = 0;
	await run(async (input, init) => {
		if (String(input).endsWith(releasePath)) {
			releases++;
			return Response.json(draft);
		}
		if (init?.method === 'GET') return Response.json(published ? [remote] : []);
		posts++;
		published = true;
		throw new Error('connection closed after upload');
	});
	expect(posts).toBe(1);
	expect(releases).toBe(2);
});

test('finds a later-page upload and updates only its display label', async () => {
	const requests: string[] = [];
	await run(async (input, init) => {
		const url = new URL(String(input));
		requests.push(`${init?.method} ${url.pathname}${url.search}`);
		if (url.pathname === releasePath) return Response.json(draft);
		if (url.searchParams.get('page') === '1') {
			return Response.json(Array.from({ length: 100 }, (_, id) => ({ ...remote, id, name: `other-${id}` })));
		}
		if (url.searchParams.get('page') === '2') return Response.json([remote]);
		expect(JSON.parse(String(init?.body))).toEqual({ label: 'Wasm' });
		return Response.json({ ...remote, label: 'Wasm' });
	}, { ASSETS: JSON.stringify([{ asset: file, displayname: 'Wasm' }]), MANIFEST_FORMAT: 'json' });
	expect(requests.at(-1)).toBe('PATCH /repos/test/demo/releases/assets/17');
	expect(requests.length).toBe(4);
});

test('a remote digest conflict prevents all uploads in the batch', async () => {
	writeFileSync(join(workspace, 'one'), content);
	const methods: string[] = [];
	await expect(run(async (input, init) => {
		methods.push(String(init?.method));
		return Response.json(String(input).endsWith(releasePath) ? draft : [{ ...remote, digest: 'sha256:wrong' }]);
	}, { ASSETS: `one\n${file}` })).rejects.toThrow('asset ID 17');
	expect(methods).toEqual(['GET', 'GET']);
});

const starter = { ...remote, state: 'starter', size: 0, digest: null };

test('rerun waits for a pre-existing starter and reuses it once uploaded', async () => {
	let lists = 0;
	await run(async (input, init) => {
		expect(init?.method).toBe('GET');
		if (String(input).endsWith(releasePath)) return Response.json(draft);
		lists++;
		return Response.json(lists === 1 ? [starter] : [remote]);
	});
	expect(lists).toBe(2);
});

test('rerun polls a persistent foreign starter with bounded reads and reports its ID', async () => {
	const methods: string[] = [];
	await expect(run(async (input, init) => {
		methods.push(String(init?.method));
		return Response.json(String(input).endsWith(releasePath) ? draft : [starter]);
	})).rejects.toThrow('incomplete (asset ID 17)');
	expect(methods).toEqual(Array(6).fill('GET'));
});

test('refuses an ID from a different execution before contacting GitHub', async () => {
	let calls = 0;
	await expect(run(async () => {
		calls++;
		return Response.json(null);
	}, { DRAFT_ID: '999' })).rejects.toThrow('execution draft ID');
	expect(calls).toBe(0);
});

test('recovers the empty starter left by its own failed 502 upload', async () => {
	let posts = 0;
	let deletes = 0;
	await run(async (input, init) => {
		if (String(input).endsWith(releasePath)) return Response.json(draft);
		if (init?.method === 'GET') {
			if (String(input).endsWith('/releases/assets/17')) return Response.json(starter);
			return Response.json(posts ? [starter] : []);
		}
		if (init?.method === 'DELETE') {
			expect(String(input)).toEndWith('/releases/assets/17');
			deletes++;
			return new Response(null, { status: 204 });
		}
		posts++;
		return posts === 1 ? new Response(null, { status: 502 }) : Response.json(remote, { status: 201 });
	});
	expect(posts).toBe(2);
	expect(deletes).toBe(1);
});

test('a starter completed between listing and cleanup survives recovery after a 502', async () => {
	let lists = 0;
	let posts = 0;
	let rechecks = 0;
	await run(async (input, init) => {
		if (init?.method === 'POST') {
			posts++;
			return new Response(null, { status: 502 });
		}
		expect(init?.method).toBe('GET');
		if (String(input).endsWith(releasePath)) return Response.json(draft);
		if (String(input).endsWith('/releases/assets/17')) {
			rechecks++;
			return Response.json(remote);
		}
		lists++;
		return Response.json(lists === 1 ? [] : [lists === 2 ? starter : remote]);
	});
	expect({ lists, posts, rechecks }).toEqual({ lists: 3, posts: 1, rechecks: 1 });
});
