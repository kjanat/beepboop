import { expect, test } from 'bun:test';
import { buildState, packageTagState, stateOf } from '@/cli/render/states';
import type { BinaryProgress } from '@/contract/views';

const leg: BinaryProgress['legs'][number] = { build: 'cli', target: 'linux-x64', job: 'build', state: 'running' };

test('a cancelled build fails while a cancelled run or publication is skipped', () => {
	expect(stateOf('execution', 'cancelled')).toBe('skipped');
	expect(stateOf('publication', 'cancelled')).toBe('skipped');
	expect(buildState({ ...leg, kind: 'cancelled' })).toBe('failed');
});

test('an unknown build waits until GitHub completes it', () => {
	expect(buildState({ ...leg, kind: 'unknown', status: 'in_progress' })).toBe('waiting');
	expect(buildState({ ...leg, kind: 'unknown', status: 'completed' })).toBe('failed');
	expect(buildState({ ...leg, kind: 'neutral' })).toBe('skipped');
});

test('a build without a GitHub job kind takes its state from the leg', () => {
	expect(buildState(leg)).toBe('waiting');
	expect(buildState({ ...leg, state: 'succeeded' })).toBe('published');
	expect(buildState({ ...leg, state: 'failed' })).toBe('failed');
	expect(buildState({ ...leg, state: 'skipped' })).toBe('skipped');
});

test('unlisted outcomes fall back per subject', () => {
	expect(stateOf('execution', 'awaiting-approval')).toBe('waiting');
	expect(stateOf('execution', 'constructor')).toBe('waiting');
	expect(stateOf('inventory', undefined)).toBe('skipped');
	expect(stateOf('inventory', 'missing')).toBe('waiting');
	expect(packageTagState('conflict')).toBe('failed');
});
