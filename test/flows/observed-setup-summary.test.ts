import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { discover } from '@/automation/managers';
import { previewSetup, setupBody } from '@/automation/setup';
import { streamSummary } from '@/automation/setup-summary';
import type { Snapshot } from '@/automation/types';

test('observed release publishing is described without inventing tag triggers or version PRs', async () => {
	const files = {
		'package.json': JSON.stringify({ name: 'example', version: '1.0.0', private: false }),
		'.github/workflows/publish.yml':
			'on: { release: { types: [published] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n',
	};
	const snapshot: Snapshot = {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: Object.keys(files),
	};
	const plan = await Effect.runPromise(previewSetup(
		snapshot,
		discover(snapshot),
		{
			streams: [{
				name: 'main',
				packages: ['pkg:npm/example'],
				required: ['pkg:npm/example'],
				versioning: 'workspace',
				observe: [{ name: 'publish', file: 'publish.yml', ref: 'refs/tags/*', publications: ['pkg:npm/example'] }],
			}],
		},
		{ head: null },
	));
	const stream = plan.choices.streams[0];
	if (!stream) throw new Error('Missing release group');
	const summary = streamSummary(stream, plan).join('\n');
	expect(summary).toContain('publishes example to npm');
	expect(summary).not.toContain('Tags matching');
	expect(summary).not.toContain('opens the version PR');
	const body = setupBody(plan, { branch: 'automation/onboarding', defaultBranch: 'main' });
	expect(body).toContain('observes the existing publishing workflows');
	expect(body).toContain('Publication: observes `publish.yml`');
	expect(body).not.toContain('has no publishing workflow');
});
