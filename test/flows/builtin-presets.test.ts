import { expect, test } from 'bun:test';
import { Effect, Result } from 'effect';
import { withoutDefaults } from '@/domain/configuration/minimal.ts';
import { resolveConfiguration } from '@/domain/configuration/presets.ts';
import { parsePresetReference } from '@/domain/preset.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';

const unreachable = (reference: string) => Effect.fail(precondition(`Loaded ${reference} from GitHub`));

test('a built-in preset resolves inside Beepboop and records a content SHA', async () => {
	const resolved = await Effect.runPromise(resolveConfiguration({
		extends: ['beepboop:npm', 'beepboop:rust-workspace'],
		streams: { main: { packages: ['pkg:npm/widget'] } },
	}, unreachable));
	expect(resolved.configuration.managers).toEqual(['cargo', 'github-release', 'workflow']);
	expect(resolved.configuration.streams.main?.channels).toEqual({ stable: 'latest', prerelease: 'next' });
	expect(Object.keys(resolved.presetShas)).toEqual(['beepboop:npm', 'beepboop:rust-workspace']);
	for (const sha of Object.values(resolved.presetShas)) expect(sha).toMatch(/^[0-9a-f]{40}$/);
});

test('a written configuration leaves out the values beepboop:default carries unless the file states them', () => {
	const written = (extended: string[]) => ({
		extends: extended,
		streams: {
			main: {
				versionScope: 'one-for-stream',
				prepare: { version: 'manual', strategy: 'workflow' },
				concurrency: 'queue',
				channels: { stable: 'latest', prerelease: 'beta' },
				startFrom: [],
				packages: ['pkg:npm/widget'],
			},
			cli: { versionScope: 'one-for-stream' },
		},
	});
	expect(withoutDefaults(written(['beepboop:default']), { streams: { main: { concurrency: 'queue' } } })).toEqual({
		extends: ['beepboop:default'],
		streams: {
			main: {
				prepare: { strategy: 'workflow' },
				concurrency: 'queue',
				channels: { prerelease: 'beta' },
				startFrom: [],
				packages: ['pkg:npm/widget'],
			},
			cli: { versionScope: 'one-for-stream' },
		},
	});
	expect(withoutDefaults(written(['beepboop:default']), { streams: { main: { versioning: 'workspace' } } }))
		.toMatchObject({ streams: { main: { versionScope: 'one-for-stream' } } });
	const overridden = written(['beepboop:default', 'github>octo/presets:release']);
	expect(withoutDefaults(overridden, {})).toEqual(overridden);
	const plain = written([]);
	expect(withoutDefaults(plain, {})).toEqual(plain);
});

test('a preset reference names a GitHub preset or a built-in preset', async () => {
	expect(parsePresetReference('beepboop:default')).toEqual({ kind: 'builtin', preset: 'default' });
	expect(parsePresetReference('github>octo/presets:release#v1')).toEqual({
		kind: 'github',
		repository: 'octo/presets',
		preset: 'release',
		ref: 'v1',
	});
	expect(parsePresetReference('beepboop:nightly')).toBeUndefined();
	const unknown = await Effect.runPromise(
		Effect.result(resolveConfiguration({ extends: ['beepboop:nightly'] }, unreachable)),
	);
	expect(Result.isFailure(unknown) && unknown.failure.message).toBe('Invalid preset reference');
});
