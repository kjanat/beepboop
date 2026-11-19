import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestBody } from '@root/actions/runtime/protocol.ts';
import { materialize } from '@root/test/support/actions.ts';
import { Result } from 'effect';
import { array, record } from '@/kernel/schema/result.ts';

test('distribution protocol preserves binary build artifacts without UTF-8 conversion', () => {
	const checkout = materialize({ '.gitignore': 'dist/\n', 'action.yml': 'name: Fixture\n' });
	try {
		mkdirSync(join(checkout.dir, 'dist'));
		const bytes = Buffer.from([0, 0xff, 0xfe, 0x80, 0xc0, 0x61]);
		writeFileSync(join(checkout.dir, 'dist/runtime tool.wasm'), bytes);
		chmodSync(join(checkout.dir, 'dist/runtime tool.wasm'), 0o755);
		const body = Result.getOrThrow(requestBody('refs-plan', {
			EXECUTION_ID: 'fixture',
			GITHUB_WORKSPACE: checkout.dir,
			DISTRIBUTION_PATHS: '["dist/runtime tool.wasm"]',
		}, 0));
		const entries = Result.getOrThrow(array(Result.getOrThrow(record(body)).files));
		const file = Result.getOrThrow(record(entries[0]));
		expect(file.encoding).toBe('base64');
		expect(file.after).toBe(bytes.toString('base64'));
		expect(file.path).toBe('dist/runtime tool.wasm');
		expect(file.mode).toBe('100755');
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
	}
});

test('distribution protocol rejects symlinks and protected or traversing paths', () => {
	const checkout = materialize({ 'asset': 'payload' });
	try {
		symlinkSync('asset', join(checkout.dir, 'link'));
		symlinkSync('.', join(checkout.dir, 'directory-link'));
		for (const path of [
			'link',
			'directory-link/asset',
			'.',
			'../asset',
			'.git/config',
			'.github/workflows/release.yml',
			'/asset',
			'a\\b',
		]) {
			expect(Result.isFailure(requestBody('refs-plan', {
				EXECUTION_ID: 'fixture',
				GITHUB_WORKSPACE: checkout.dir,
				DISTRIBUTION_PATHS: JSON.stringify([path]),
			}, 0))).toBe(true);
		}
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
	}
});
