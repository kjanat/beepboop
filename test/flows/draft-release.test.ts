import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../packages/actions/actions/draft-release/draft.sh', import.meta.url));
const draft = {
	id: 42,
	draft: true,
	tag_name: 'v1.2.3',
	upload_url: 'https://uploads.github.com/repos/test/demo/releases/42/assets{?name,label}',
};
let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'beepboop-draft-release-'));
	writeFileSync(join(directory, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$@" >> requests\ncat release.json\n', {
		mode: 0o700,
	});
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function getDraft(release = draft, id = '42') {
	writeFileSync(join(directory, 'release.json'), JSON.stringify(release));
	return Bun.spawnSync(['bash', script], {
		cwd: directory,
		env: {
			PATH: `${directory}:${process.env.PATH}`,
			GITHUB_REPOSITORY: 'test/demo',
			GITHUB_OUTPUT: join(directory, 'output'),
			DRAFT_ID: id,
			DRAFT_TAG: 'v1.2.3',
		},
	});
}

test('repeated lookups return the same recorded ID and upload URL using only GET by ID', () => {
	for (let i = 0; i < 2; i++) {
		expect(getDraft().exitCode).toBe(0);
	}
	const request = 'api\n--hostname\ngithub.com\nrepos/test/demo/releases/42\n';
	expect(readFileSync(join(directory, 'requests'), 'utf8')).toBe(request.repeat(2));
	expect(readFileSync(join(directory, 'output'), 'utf8')).toBe(
		`release-id=42\nupload-url=${draft.upload_url}\n`.repeat(2),
	);
});

test('a missing draft fails before contacting GitHub', () => {
	expect(getDraft(draft, '').exitCode).toBe(1);
	expect(existsSync(join(directory, 'requests'))).toBe(false);
});

test.each([
	{ ...draft, id: 43 },
	{ ...draft, draft: false },
	{ ...draft, tag_name: 'v2' },
	{ ...draft, upload_url: '' },
	{ ...draft, upload_url: 'https://uploads.github.com/\nother-output=bad' },
])('an invalid release response produces no outputs', release => {
	expect(getDraft(release).exitCode).not.toBe(0);
	expect(existsSync(join(directory, 'output'))).toBe(false);
});
