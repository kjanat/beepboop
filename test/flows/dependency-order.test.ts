import { expect, test } from 'bun:test';
import { jsonFile, publishWorkflow } from '@root/test/support/repositories.ts';
import { Effect, Schema, Struct } from 'effect';
import { discover } from '@/automation/managers';
import { publicationOrder } from '@/automation/managers/order';
import { planReleaseSet } from '@/automation/planning';
import { compileReleaseSet } from '@/automation/release-set';
import type { Execution, Package, Snapshot } from '@/automation/types';
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

function npm(
	name: string,
	dependencies: string[],
	publication: Package['publication'] = { kind: 'registry' },
): Package {
	return {
		manager: 'npm',
		name,
		version: '1.0.0',
		manifest: `${name}/package.json`,
		versionSource: `${name}/package.json`,
		publication,
		dependencies,
	};
}

function snapshot(version: string): Snapshot {
	const files = {
		'package.json': jsonFile({ name: 'widget', version }),
		'.github/workflows/publish.yml': publishWorkflow,
	};
	return {
		repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
		sha: version === '1.0.0' ? 'a'.repeat(40) : 'b'.repeat(40),
		files,
		paths: Object.keys(files),
	};
}

const group = { id: 'widget', packages: ['pkg:npm/widget'], version: '1.1.0' };

function plan(operations: unknown[]) {
	const source = snapshot('1.0.0');
	return planReleaseSet(source, discover(source, ['npm', 'workflow']), { groups: [group], operations });
}

function refusal<A, E extends Error>(effect: Effect.Effect<A, E>): Promise<string> {
	return Effect.runPromise(Effect.flip(effect)).then(error => error.message);
}

test('publication order puts dependencies first, skips unpublishable packages and names a cycle', () => {
	expect(publicationOrder([
		npm('app', ['lib', 'outside']),
		npm('lib', ['internal']),
		npm('internal', [], { kind: 'excluded', reason: 'private' }),
	])).toEqual({ kind: 'ordered', order: ['pkg:npm/lib', 'pkg:npm/app'] });
	expect(publicationOrder([npm('a', ['b']), npm('b', ['a'])])).toEqual({
		kind: 'cycle',
		message: 'Publication dependency cycle at pkg:npm/a',
	});
});

test('a release set plan orders operations by needs and inputs and refuses broken graphs', async () => {
	const planned = await Effect.runPromise(plan([
		{ id: 'publish', group: 'widget', inputs: [{ operation: 'build', output: 'bin' }] },
		{ id: 'build', group: 'widget', outputs: [{ id: 'bin', kind: 'binary' }] },
	]));
	expect(planned.operations.map(operation => [operation.id, operation.needs])).toEqual([
		['build', []],
		['publish', ['build']],
	]);
	expect(planned.publicationOrder).toEqual(['pkg:npm/widget']);

	expect(
		await refusal(plan([
			{ id: 'a', group: 'widget', needs: ['b'] },
			{ id: 'b', group: 'widget', needs: ['a'] },
		])),
	).toBe('Operation dependency cycle: a');
	expect(await refusal(plan([{ id: 'a', group: 'widget', needs: ['missing'] }]))).toBe(
		'Unknown operation dependency: missing',
	);
	expect(
		await refusal(plan([
			{ id: 'a', group: 'widget', inputs: [{ operation: 'b', output: 'bin' }] },
			{ id: 'b', group: 'widget' },
		])),
	).toBe('Unknown output: b/bin');
});

async function compile(buildNeeds: string[]): Promise<Effect.Effect<Execution[], Error>> {
	const configuration = decodeSync(configurationSchema, {
		managers: ['npm', 'workflow'],
		streams: {
			main: {
				versioning: 'independent',
				packages: ['pkg:npm/widget'],
				required: ['pkg:npm/widget'],
				workflows: {
					build: { file: 'publish.yml', needs: buildNeeds },
					publish: { file: 'publish.yml' },
				},
			},
		},
	});
	const prepared = await Effect.runPromise(plan([
		{ id: 'build', group: 'widget', outputs: [{ id: 'bin', kind: 'binary' }] },
		{ id: 'publish', group: 'widget', inputs: [{ operation: 'build', output: 'bin' }] },
	]));
	const preparation: Execution = {
		id: 'preparation',
		repositoryId: 1,
		repository: 'octo/widget',
		stream: 'main',
		operation: 'prepare',
		eventId: 'release-set',
		configuration,
		configurationSha: 'c'.repeat(40),
		presetShas: {},
		sourceSha: prepared.sourceSha,
		state: 'succeeded',
		dependencies: [],
		attempts: 0,
		publications: [],
		artifacts: [],
		createdAt: 0,
		updatedAt: 0,
		managed: {
			kind: 'prepare',
			plan: prepared,
			branch: 'beepboop/release',
			title: 'Release',
			body: '',
			result: { url: 'https://github.com/octo/widget/pull/1', head: 'b'.repeat(40) },
		},
	};
	return compileReleaseSet(preparation, snapshot('1.1.0'));
}

test('a compiled release set keeps producer order and refuses a cycle across plan and configuration', async () => {
	const operations = await Effect.runPromise(await compile([]));
	expect(operations.map(operation => [operation.operation, operation.workflow?.needs])).toEqual([
		['build', []],
		['publish', ['build']],
	]);
	expect(operations[1]?.dependencies).toEqual(operations.slice(0, 1).map(operation => operation.id));

	expect(await refusal(await compile(['publish']))).toBe('Combined operation dependency cycle');
});
