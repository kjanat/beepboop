import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestBody } from '@root/actions/runtime/protocol.ts';
import { materialize } from '@root/test/support/actions.ts';
import { Result } from 'effect';
import { array, record } from '@/model';

test('distribution protocol preserves binary build artifacts without UTF-8 conversion', () => {
	const checkout = materialize({ '.gitignore': 'dist/\n', 'action.yml': 'name: Fixture\n' });
	try {
		mkdirSync(join(checkout.dir, 'dist'));
		const bytes = Buffer.from([0, 0xff, 0xfe, 0x80, 0xc0, 0x61]);
		writeFileSync(join(checkout.dir, 'dist/runtime.wasm'), bytes);
		const body = Result.getOrThrow(requestBody('refs-plan', {
			EXECUTION_ID: 'fixture',
			GITHUB_WORKSPACE: checkout.dir,
			DISTRIBUTION_PATHS: '["dist/runtime.wasm"]',
		}, 0));
		const entries = Result.getOrThrow(array(Result.getOrThrow(record(body)).files));
		const file = Result.getOrThrow(record(entries[0]));
		expect(file.encoding).toBe('base64');
		expect(file.after).toBe(bytes.toString('base64'));
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
	}
});
