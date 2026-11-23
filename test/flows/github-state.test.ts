import { expect, test } from 'bun:test';
import {
	publishedAfterFailure,
	rechecked,
	recheckedPublication,
	recoverable,
	runFailedNote,
	settleRun,
} from '@/automation/execution';
import { githubFailureReason } from '@/automation/run-labels';
import type { Execution } from '@/automation/types';
import type { RunJob } from '@/github/run-state.ts';
import { classifyJob, classifyRun } from '@/github/run-state.ts';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { runStateLabel } from '@/server/releases';

function execution(): Execution {
	return decodeExecutionV1({
		id: 'run',
		repositoryId: 1,
		repository: 'octo/widget',
		stream: 'main',
		version: '1.0.0',
		configurationSha: 'configuration',
		sourceSha: 'source',
		eventId: 'manual-run',
		configuration: {
			extends: [],
			managers: ['npm'],
			subscriptions: [],
			streams: {
				main: {
					required: ['pkg:npm/widget'],
					versioning: 'workspace',
					concurrency: 'queue',
					prepare: { version: 'manual' },
					promote: { approval: 'required' },
					workflows: {},
					credentials: [],
					channels: { stable: 'latest', prerelease: 'next' },
				},
			},
		},
		operation: 'promote',
		presetShas: {},
		dependencies: [],
		attempts: 1,
		runId: 10,
		runAttempt: 1,
		workflow: { file: 'publish.yml', ref: 'main', inputs: {}, publications: ['pkg:npm/widget'] },
		publications: [],
		artifacts: [],
		createdAt: 1,
		updatedAt: 1,
		state: 'running',
	});
}
function job(conclusion: string | null, fields: Partial<RunJob> = {}): RunJob {
	return { name: 'Publish', status: 'completed', conclusion, ...fields };
}
const failed = { status: 'completed', conclusion: 'failure' };
const succeeded = { status: 'completed', conclusion: 'success' };
const published = {
	id: 'pkg:npm/widget',
	manager: 'npm' as const,
	name: 'widget',
	version: '1.0.0',
	required: true,
	outcome: 'succeeded' as const,
};

for (const status of ['queued', 'requested', 'pending', 'waiting']) {
	test(`${status} jobs and runs wait without appearing to execute`, () => {
		expect(classifyJob(job(null, { status })).kind).toBe('waiting');
		const result = classifyRun({ status, conclusion: null });
		expect([result.observation.kind, result.observation.completed, result.retry]).toEqual([
			'waiting',
			false,
			undefined,
		]);
		const waiting = settleRun(execution(), result);
		expect(waiting.state).toBe('running');
		expect(runStateLabel(waiting)).toBe(`waiting on GitHub (${status})`);
	});
}

test('only an in-progress status with no conclusion reports running', () => {
	expect(classifyJob(job(null, { status: 'in_progress' })).kind).toBe('running');
	expect(classifyRun({ status: 'in_progress', conclusion: null }).observation.kind).toBe('running');
	expect(classifyRun({ status: 'in_progress', conclusion: 'success' }).observation.kind).toBe('unknown');
	expect(classifyRun({ status: 'waiting', conclusion: 'action_required' }).observation.kind).toBe('unknown');
});

for (
	const [conclusion, kind] of [
		['success', 'succeeded'],
		['failure', 'failed'],
		['cancelled', 'cancelled'],
		['skipped', 'skipped'],
		['neutral', 'neutral'],
		['timed_out', 'timed-out'],
		['action_required', 'action-required'],
		['startup_failure', 'startup-failure'],
		['stale', 'stale'],
	] as const
) {
	test(`preserves GitHub's ${conclusion} conclusion in jobs, runs and persisted execution`, () => {
		const result = classifyRun({ status: 'completed', conclusion });
		expect(classifyJob(job(conclusion ?? null)).kind).toBe(kind);
		expect(result.observation).toEqual({ kind, status: 'completed', conclusion, completed: true });
		const settled = settleRun(execution(), result);
		const restored = decodeExecutionV1(JSON.parse(JSON.stringify(settled)));
		expect(restored.github).toEqual(result.observation);
		expect(result.retry).toBeUndefined();
	});
}

test('unknown completed conclusions are retained and stay uncertain without retrying', () => {
	for (const conclusion of [null, 'future_conclusion']) {
		const result = classifyRun({ status: 'completed', conclusion }, [job('failure')]);
		const settled = settleRun(execution(), result);
		expect([result.observation.kind, result.retry, settled.state]).toEqual(['unknown', undefined, 'uncertain']);
		expect(decodeExecutionV1(JSON.parse(JSON.stringify(settled))).github?.conclusion).toBe(conclusion);
	}
	for (const status of ['future_status', null, 1]) {
		const result = classifyRun({ status, conclusion: null });
		expect([result.observation.kind, result.retry]).toEqual(['unknown', undefined]);
	}
});

test('an unassigned-runner retry needs explicit empty steps and absent runner evidence for every unsuccessful job', () => {
	for (const runner_id of [0, null]) {
		const stranded = job('cancelled', { runner_id, steps: [] });
		const result = classifyRun(failed, [job('success'), stranded, job('skipped')]);
		expect([result.observation.kind, result.retry]).toEqual(['runner-unassigned', 'runner-unassigned']);
	}
	for (const fields of [
		{},
		{ runner_id: 0 },
		{ steps: [] },
		{ runner_id: null, steps: null },
		{ runner_id: 5, steps: [] },
		{ runner_id: 0, steps: [{}] },
	]) {
		const incomplete = job('cancelled', fields);
		const result = classifyRun(failed, [incomplete]);
		expect(classifyJob(incomplete).runner).not.toBe('unassigned');
		expect([result.observation.kind, result.retry]).toEqual(['failed', undefined]);
	}
	expect(classifyRun(failed, []).retry).toBeUndefined();
});

test('a mixed runner failure or unknown outcome prevents the stranded-runner shortcut', () => {
	const stranded = job('cancelled', { runner_id: 0, steps: [] });
	for (const other of [
		job('failure', { name: 'Test', runner_id: 4, steps: [{}] }),
		job('future_conclusion', { name: 'Test', runner_id: 0, steps: [] }),
		job(null, { name: 'Test', status: 'queued', runner_id: 0, steps: [] }),
	]) expect(classifyRun(failed, [stranded, other]).retry).toBeUndefined();
});

test('a single ordinary failing job requires ledger evidence while mixed or cancelled failures cannot retry', () => {
	for (const conclusion of ['failure', 'timed_out']) {
		const result = classifyRun({ status: 'completed', conclusion }, [job('success'), job('failure')]);
		expect(result.retry).toBe('ledger-required');
	}
	for (const other of ['cancelled', 'action_required', 'startup_failure', 'stale', 'neutral', 'future_conclusion']) {
		expect(classifyRun(failed, [job('failure'), job(other, { name: 'Test' })]).retry).toBeUndefined();
	}
	for (const conclusion of ['cancelled', 'action_required', 'startup_failure', 'stale', 'neutral']) {
		expect(classifyRun({ status: 'completed', conclusion }, [job('failure')]).retry).toBeUndefined();
	}
});

test('cancellation remains distinct from skipping without guessing who cancelled it', () => {
	const result = classifyRun({ status: 'completed', conclusion: 'cancelled' }, [job('cancelled')]);
	expect(result.jobs[0]?.kind).toBe('cancelled');
	expect(classifyJob(job('skipped')).kind).toBe('skipped');
	expect(githubFailureReason(result)).toBe('GitHub workflow cancelled: Publish (cancelled)');
	expect(githubFailureReason(result)).not.toContain('user');
});

test('a cancelled run settles as cancelled unless a required publication failed', () => {
	const cancelled = classifyRun({ status: 'completed', conclusion: 'cancelled' }, [job('cancelled')]);
	const unreported = settleRun(execution(), cancelled);
	expect([unreported.state, unreported.reason]).toEqual([
		'cancelled',
		'GitHub workflow cancelled: Publish (cancelled)',
	]);
	const reported = settleRun({ ...execution(), publications: [{ ...published, outcome: 'cancelled' }] }, cancelled);
	expect(reported.state).toBe('cancelled');
	expect(decodeExecutionV1(JSON.parse(JSON.stringify(reported))).state).toBe('cancelled');
	const broken = settleRun({ ...execution(), publications: [{ ...published, outcome: 'failed' }] }, cancelled);
	expect(broken.state).toBe('failed');
	const pending = settleRun({ ...execution(), publications: [{ ...published, outcome: 'pending' }] }, cancelled);
	expect(pending.state).toBe('cancelled');
	expect(publishedAfterFailure({ ...pending, publications: [published] })?.state).toBe('succeeded');
	expect(publishedAfterFailure(pending)).toBeUndefined();
});

test('a registry recheck keeps a cancelled publication unless the registry gives a definite answer', () => {
	const cancelled = { ...published, outcome: 'cancelled' as const };
	for (const outcome of ['pending', 'uncertain'] as const) {
		expect(recheckedPublication(cancelled, { ...published, outcome })).toBe(cancelled);
	}
	for (const outcome of ['succeeded', 'failed'] as const) {
		expect(recheckedPublication(cancelled, { ...published, outcome }).outcome).toBe(outcome);
	}
	const pending = { ...published, outcome: 'pending' as const };
	expect(recheckedPublication(pending, { ...published, outcome: 'uncertain' }).outcome).toBe('uncertain');
	const source = { ...execution(), state: 'cancelled' as const };
	expect(rechecked({ ...source, publications: [{ ...published, outcome: 'failed' }] }).state).toBe('failed');
	expect(rechecked({ ...source, publications: [published] }).state).toBe('succeeded');
	const waiting = { ...source, publications: [cancelled] };
	expect(rechecked(waiting)).toBe(waiting);
	const stopped = { ...source, cancelledBy: '42', publications: [{ ...published, outcome: 'failed' as const }] };
	expect(rechecked(stopped)).toBe(stopped);
});

test('only failed runs and GitHub cancellations recover; an operator cancellation stays stopped', () => {
	const cancelled = { ...execution(), state: 'cancelled' as const, publications: [published] };
	expect(recoverable({ ...execution(), state: 'failed' })).toBe(true);
	expect(recoverable(cancelled)).toBe(true);
	expect(publishedAfterFailure(cancelled)?.state).toBe('succeeded');
	const stopped = { ...cancelled, cancelledBy: '42', reason: 'Cancelled by 42' };
	expect(recoverable(stopped)).toBe(false);
	expect(publishedAfterFailure(stopped)).toBeUndefined();
	expect(recoverable({ ...execution(), state: 'succeeded' })).toBe(false);
});

test('a stored operator cancellation decodes with the actor who cancelled it', () => {
	const legacy = { ...execution(), state: 'cancelled', reason: 'Cancelled by 42' };
	expect(decodeExecutionV1(JSON.parse(JSON.stringify(legacy))).cancelledBy).toBe('42');
	const github = { ...legacy, reason: 'GitHub workflow cancelled: Publish (cancelled)' };
	expect(decodeExecutionV1(JSON.parse(JSON.stringify(github))).cancelledBy).toBeUndefined();
	const recorded = { ...legacy, cancelledBy: '7' };
	expect(decodeExecutionV1(JSON.parse(JSON.stringify(recorded))).cancelledBy).toBe('7');
});

test('a cancelled required publication cancels a successful run', () => {
	const settled = settleRun(
		{ ...execution(), publications: [{ ...published, outcome: 'cancelled' }] },
		classifyRun(succeeded),
	);
	expect(settled.state).toBe('cancelled');
});

test('action-required and startup failures do not invent an approval mechanism or workflow syntax error', () => {
	const needsAction = settleRun(execution(), classifyRun({ status: 'completed', conclusion: 'action_required' }));
	expect([needsAction.state, needsAction.reason]).toEqual([
		'blocked',
		'GitHub requires action; check the workflow run',
	]);
	const startup = settleRun(execution(), classifyRun({ status: 'completed', conclusion: 'startup_failure' }));
	expect([startup.state, startup.reason]).toEqual(['failed', 'GitHub could not start the workflow']);
});

test('required publication receipts remain successful despite later adverse workflow conclusions', () => {
	for (
		const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'future_conclusion']
	) {
		const source = { ...execution(), publications: [published] };
		const settled = settleRun(source, classifyRun({ status: 'completed', conclusion }));
		expect(settled.state).toBe('succeeded');
		expect(settled.github?.conclusion).toBe(conclusion);
		expect(settled.publications).toEqual([published]);
		expect(settled.reason).toContain('after every required publication succeeded.');
		if (conclusion === 'failure') expect(settled.reason).toBe(runFailedNote);
	}
});

test('resuming or succeeding clears the prior GitHub waiting and action-required explanation', () => {
	for (const initial of [
		{ status: 'waiting', conclusion: null },
		{ status: 'completed', conclusion: 'action_required' },
	]) {
		const source = settleRun(execution(), classifyRun(initial));
		expect(source.reason).toBeDefined();
		const resumed = settleRun(source, classifyRun({ status: 'in_progress', conclusion: null }));
		expect([resumed.state, resumed.reason]).toEqual(['running', undefined]);
		const complete = settleRun({ ...source, publications: [published] }, classifyRun(succeeded));
		expect([complete.state, complete.reason, complete.github?.kind]).toEqual(['succeeded', undefined, 'succeeded']);
	}
});

test('persisting an action-required run with pending publications preserves its blocked lifecycle', () => {
	const source = { ...execution(), publications: [{ ...published, outcome: 'pending' as const }] };
	const settled = settleRun(source, classifyRun({ status: 'completed', conclusion: 'action_required' }));
	expect(settled.state).toBe('blocked');
	const restored = decodeExecutionV1(JSON.parse(JSON.stringify(settled)));
	expect([restored.state, restored.github]).toEqual(['blocked', settled.github]);
});

test('a successful GitHub run does not hide a blocked or failed publication lifecycle', () => {
	const blocked = settleRun(execution(), classifyRun(succeeded));
	expect([blocked.state, runStateLabel(blocked)]).toEqual(['blocked', 'blocked']);
	const source = { ...execution(), publications: [{ ...published, outcome: 'failed' as const }] };
	const broken = settleRun(source, classifyRun(succeeded));
	expect([broken.state, runStateLabel(broken)]).toEqual(['failed', 'failed']);
});
