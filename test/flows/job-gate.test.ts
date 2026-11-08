import { expect, test } from 'bun:test';
import { gateJobs, gateState, type RunJob, workflowJobs } from '@/automation/job-gate';

const workflow = `on:
  push:
    tags: ['tool-v*']
jobs:
  plan:
    name: Validate version
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  check:
    name: Tests
    needs: plan
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  build:
    name: \${{ matrix.target }}
    needs: plan
    strategy:
      matrix:
        target: [x86_64-unknown-linux-gnu, aarch64-apple-darwin]
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  registry-payload:
    needs: plan
    if: needs.plan.outputs.registry_only == 'true'
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  assemble:
    name: Verify payload
    needs: [plan, check, build]
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  publish:
    name: Publish GitHub release
    needs: [plan, assemble]
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  npm:
    needs: [publish, registry-payload]
    if: \${{ !cancelled() && (needs.publish.result == 'success' || needs.registry-payload.result == 'success') }}
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
  container:
    needs: [assemble, registry-payload]
    if: \${{ !cancelled() && needs.assemble.result == 'success' }}
    strategy:
      matrix:
        platform: [amd64, arm64]
    runs-on: ubuntu-latest
    steps: [{ run: 'true' }]
`;

function jobs() {
	const parsed = workflowJobs(workflow);
	if (!parsed) throw new Error('The workflow did not parse');
	return parsed;
}
function job(name: string, conclusion: string | null): RunJob {
	return { name, status: conclusion === null ? 'in_progress' : 'completed', conclusion };
}
const built = [
	job('Validate version', 'success'),
	job('Tests', 'success'),
	job('x86_64-unknown-linux-gnu', 'success'),
	job('aarch64-apple-darwin', 'success'),
	job('registry-payload', 'skipped'),
];

test('the gate holds every job that the first publishing jobs wait for', () => {
	expect(gateJobs(jobs(), ['publish', 'npm'])).toEqual(['plan', 'check', 'build', 'assemble']);
	expect(gateJobs(jobs(), ['publish', 'npm', 'container'])).toEqual([
		'plan',
		'check',
		'build',
		'registry-payload',
		'assemble',
	]);
	expect(gateJobs(jobs(), ['plan'])).toEqual([]);
});

test('a matrix job with a dynamic name passes through the job that needs it', () => {
	const keys = gateJobs(jobs(), ['publish', 'container']);
	expect(gateState(jobs(), keys, built)).toBe('waiting');
	expect(gateState(jobs(), keys, [...built, job('Verify payload', null)])).toBe('waiting');
	expect(gateState(jobs(), keys, [...built, job('Verify payload', 'success'), job('npm', null)])).toBe('ready');
});

test('a failed build blocks the gate', () => {
	const keys = gateJobs(jobs(), ['publish']);
	const failed = built.map(entry => entry.name === 'aarch64-apple-darwin' ? job(entry.name, 'failure') : entry);
	expect(gateState(jobs(), keys, failed)).toBe('waiting');
	expect(gateState(jobs(), keys, [...failed, job('Verify payload', 'skipped')])).toBe('blocked');
	expect(gateState(jobs(), keys, [...built.slice(0, 1), job('Tests', 'failure')])).toBe('blocked');
});

test('a job skipped by its own condition passes once its needs pass', () => {
	expect(gateState(jobs(), ['registry-payload'], [job('Validate version', null), job('registry-payload', 'skipped')]))
		.toBe('waiting');
	expect(gateState(jobs(), ['registry-payload'], built)).toBe('ready');
	expect(
		gateState(jobs(), ['registry-payload'], [job('Validate version', 'failure'), job('registry-payload', 'skipped')]),
	).toBe('blocked');
});

test('matrix jobs with a static name match every variant', () => {
	expect(gateState(jobs(), ['container'], [job('container (amd64)', 'success'), job('container (arm64)', null)])).toBe(
		'waiting',
	);
	expect(gateState(jobs(), ['container'], [job('container (amd64)', 'success'), job('container (arm64)', 'success')]))
		.toBe('ready');
});
