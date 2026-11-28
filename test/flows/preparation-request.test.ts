import { expect, test } from 'bun:test';
import type { Snapshot } from '@/domain/inventory.ts';
import { decodeExecutionV1 } from '@/release/adapters/codecs/execution-v1.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import type { Preparation } from '@/release/domain/preparation-request.ts';
import { preparationRequest } from '@/release/domain/preparation-request.ts';

const edits = [{ path: 'package.json', before: '{"version":"1.0.0"}', after: '{"version":"1.1.0"}' }];
const draft = { branch: 'release/main/p', title: 'chore(release): prepare 1.1.0', body: 'Body', edits };
const snapshot: Snapshot = {
	repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
	sha: 's'.repeat(40),
	files: {},
	paths: [],
};

function execution(bump: 'commit' | 'pr', fields: Partial<Execution> = {}): Execution {
	return {
		...decodeExecutionV1({
			id: 'p',
			repositoryId: 1,
			repository: 'octo/widget',
			stream: 'main',
			version: '1.1.0',
			configurationSha: 'configuration',
			sourceSha: 's'.repeat(40),
			eventId: 'manual-p',
			configuration: {
				extends: [],
				managers: ['npm'],
				subscriptions: [],
				streams: {
					main: {
						required: [],
						versioning: 'workspace',
						concurrency: 'queue',
						prepare: { version: 'manual', bump },
						release: { approval: 'required' },
						workflows: {},
						credentials: [],
						channels: { stable: 'latest', prerelease: 'next' },
					},
				},
			},
			publications: [],
			operation: 'prepare',
			presetShas: {},
			dependencies: [],
			attempts: 0,
			artifacts: [],
			createdAt: 1,
			updatedAt: 1,
			state: 'running',
		}),
		...fields,
	};
}

test('a stream that bumps by commit commits the version from the recorded commit or a new one', () => {
	const committing = execution('commit');
	const fresh: Preparation = { edits };
	expect(preparationRequest(committing, fresh, snapshot, draft)).toEqual({
		_tag: 'CommitVersion',
		execution: committing,
		preparation: fresh,
		snapshot,
		message: 'chore(release): 1.1.0',
		edits,
		head: undefined,
	});
	const recorded: Preparation = { edits, head: 'h'.repeat(40) };
	expect(preparationRequest(committing, recorded, snapshot, draft)).toMatchObject({
		_tag: 'CommitVersion',
		head: 'h'.repeat(40),
	});
});

test('a version PR resumes from its recorded commit and otherwise opens, co-authored when someone started it', () => {
	const recorded: Preparation = { edits, head: 'h'.repeat(40) };
	const reviewed = execution('pr');
	expect(preparationRequest(reviewed, recorded, snapshot, draft)).toEqual({
		_tag: 'ResumePullRequest',
		execution: reviewed,
		preparation: recorded,
		snapshot,
		branch: draft.branch,
		title: draft.title,
		body: draft.body,
		head: 'h'.repeat(40),
	});
	const fresh: Preparation = { edits };
	expect(preparationRequest(reviewed, fresh, snapshot, draft)).toEqual({
		_tag: 'OpenPullRequest',
		execution: reviewed,
		preparation: fresh,
		snapshot,
		branch: draft.branch,
		title: draft.title,
		body: draft.body,
		edits,
		coAuthored: false,
	});
	const started = execution('pr', { initiatedBy: 'kjanat' });
	expect(preparationRequest(started, fresh, snapshot, draft)).toMatchObject({
		_tag: 'OpenPullRequest',
		coAuthored: true,
	});
});
