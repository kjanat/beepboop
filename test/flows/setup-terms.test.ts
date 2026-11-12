import { expect, test } from 'bun:test';
import { Effect, Result, Schema, Struct } from 'effect';
import { parseRepositoryConfiguration, resolveConfiguration } from '@/automation/configuration';
import { legacyConfiguration, readableConfiguration } from '@/automation/configuration-names';
import {
	existingTriggersQuestion,
	existingTriggersSentences,
	mustPublishSentence,
	publishWhenQuestion,
	publishWhenSentences,
	startFromEffect,
	startFromQuestion,
	startFromSentences,
	versionLandsQuestion,
	versionLandsSentences,
	versionPrMergeQuestion,
	versionPrMergeSentences,
	versionScopeQuestion,
	versionScopeSentences,
} from '@/contract/setup-terms';
import { configurationSchema } from '@/domain/configuration';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';

const root = new URL('../../src/', import.meta.url);

async function sources(): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	for (const path of new Bun.Glob('**/*.{ts,astro}').scanSync(root.pathname)) {
		if (path === 'contract/setup-terms.ts') continue;
		found.set(path, await Bun.file(new URL(path, root)).text());
	}
	return found;
}

const sentences = [
	...Object.values(publishWhenSentences),
	...Object.values(versionLandsSentences),
	...Object.values(startFromSentences),
	...Object.values(versionScopeSentences),
	...Object.values(existingTriggersSentences),
	...Object.values(versionPrMergeSentences),
	mustPublishSentence,
	startFromEffect,
	publishWhenQuestion,
	versionLandsQuestion,
	startFromQuestion,
	versionScopeQuestion,
	existingTriggersQuestion,
	versionPrMergeQuestion,
];
const earlierWording = [
	'After you approve it in Beepboop',
	'When its version PR merges',
	'approves the whole release',
	'A start approves',
	'Waiting for your approval',
	'One version for the stream',
	'Independent package versions',
	'Version each package separately',
	'Give the selected packages the same version',
	'Keep the current triggers',
	'Keep current triggers',
	'Existing triggers stay',
	'Beepboop only (replace',
	'Who starts this workflow',
	'when a version raised without a start',
	'how a version bump reaches',
	'continues the release without another approval',
];

test('each setup term sentence is written once, in src/contract/setup-terms.ts', async () => {
	const found = await sources();
	const repeats = [...found].flatMap(([path, text]) =>
		[...sentences, ...earlierWording].filter(sentence => text.includes(sentence)).map(sentence =>
			`${path}: ${sentence}`
		)
	);
	expect(repeats).toEqual([]);
});

const legacy = {
	streams: {
		main: {
			versioning: 'independent',
			packages: ['npm:widget'],
			required: ['npm:widget'],
			start: [{ via: 'cli' }],
			prepare: { bump: 'commit', versionPrMerge: 'squash' },
			promote: { approval: 'merge', workflow: { file: 'release.yml', setup: { triggers: 'dispatchOnly' } } },
		},
	},
};
const current = {
	streams: {
		main: {
			versionScope: 'per-package',
			packages: ['npm:widget'],
			mustPublish: ['npm:widget'],
			startFrom: [{ via: 'cli' }],
			prepare: { versionLands: 'via-direct-commit', versionPrMerge: 'squash' },
			promote: {
				publishWhen: 'version-pr-merged',
				workflow: { file: 'release.yml', setup: { existingTriggers: 'replace-with-dispatch' } },
			},
		},
	},
};

test('the earlier setting names read the same as the current ones, and setup writes only the current names', () => {
	const parsed = (value: unknown) => Result.getOrThrow(parseRepositoryConfiguration(value));
	expect(parsed(current)).toEqual(parsed(legacy));
	expect(decodeSync(configurationSchema, current)).toEqual(decodeSync(configurationSchema, legacy));
	expect(decodeSync(configurationSchema, current)).toEqual(parsed(current));
	expect(readableConfiguration(legacy)).toEqual(current);
	expect(readableConfiguration(current)).toEqual(current);
	expect(legacyConfiguration(current)).toEqual(legacy);
	const both = { streams: { main: { ...current.streams.main, versioning: 'workspace' } } };
	expect(parsed(both).streams.main?.versioning).toBe('independent');
	expect(readableConfiguration(both)).toEqual(current);
	expect(parsed(current).streams.main?.prepare.versionPrMerge).toBe('squash');
	const unknown = { streams: { main: { ...current.streams.main, prepare: { versionPrMerge: 'fast' } } } };
	expect(Result.isFailure(parseRepositoryConfiguration(unknown))).toBe(true);
	expect(safeDecode(configurationSchema, unknown).success).toBe(false);
});

test('a repository setting overrides a preset whichever names each of them uses', async () => {
	const preset = {
		streams: { main: { versionScope: 'one-for-stream', promote: { publishWhen: 'version-pr-merged' } } },
	};
	const repository = {
		extends: ['github>octo/presets:release'],
		streams: { main: { versioning: 'independent', promote: { approval: 'push' } } },
	};
	const resolved = await Effect.runPromise(
		resolveConfiguration(repository, () => Effect.succeed({ value: preset, sha: 'a'.repeat(40) })),
	);
	expect([resolved.configuration.streams.main?.versioning, resolved.configuration.streams.main?.promote.approval])
		.toEqual(['independent', 'push']);
	expect(resolved.drift).toEqual([]);
});
