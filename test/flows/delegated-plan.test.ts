import { expect, test } from 'bun:test';
import { widgetConfiguration } from '@root/test/support/repositories.ts';
import { Effect } from 'effect';
import { discover } from '@/automation/managers';
import type { Snapshot } from '@/automation/types';
import { configurationSchema } from '@/domain/configuration';
import { decodeSync } from '@/schema';
import { delegatedPlan } from '@/server/handlers/releases';

const files: Record<string, string> = {
	'Cargo.toml': '[workspace]\nmembers = ["a", "b"]\n[workspace.package]\nversion = "1.2.0"\n',
	'a/Cargo.toml': '[package]\nname = "a"\nversion.workspace = true\n',
	'b/Cargo.toml': '[package]\nname = "b"\nversion.workspace = true\n',
};
const snapshot: Snapshot = {
	repository: { id: 1, name: 'octo/crates', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files,
	paths: Object.keys(files),
};

function delegatedStream() {
	const raw = JSON.parse(widgetConfiguration());
	raw.streams.main.packages = ['pkg:cargo/a'];
	raw.streams.main.prepare = { strategy: 'workflow', workflow: { file: 'prepare.yml' } };
	const stream = decodeSync(configurationSchema, raw).streams.main;
	if (!stream) throw new Error('Expected the main stream');
	return stream;
}

test('a carried version that managed editing cannot plan still dispatches its preparation workflow', async () => {
	const plan = await Effect.runPromise(
		delegatedPlan(snapshot, discover(snapshot, ['cargo']), delegatedStream(), '1.2.0', ['pkg:cargo/a']),
	);
	expect([plan.version, plan.sourceSha, plan.edits, plan.requiresPreparation]).toEqual([
		'1.2.0',
		snapshot.sha,
		[],
		true,
	]);
});
