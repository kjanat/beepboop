import { expect, spyOn, test } from 'bun:test';
import { ReleaseHistory } from '@/automation/release-history';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';

function execution(id: string, version = '1.0.0') {
	return decodeExecutionV1({
		id,
		repositoryId: 1,
		repository: 'octo/widget',
		stream: 'main',
		version,
		configurationSha: 'configuration',
		sourceSha: 'source',
		eventId: `manual-${id}`,
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
		publications: [],
		operation: 'prepare',
		presetShas: {},
		dependencies: [],
		attempts: 0,
		artifacts: [],
		createdAt: 1,
		updatedAt: 1,
		state: 'succeeded',
	});
}

for (const sameGroup of [false, true]) {
	test(`settled history completion lookup has a linear inspection budget (${sameGroup ? 'shared' : 'distinct'} groups)`, () => {
		const entries = Array.from(
			{ length: 1000 },
			(_, i) => execution(`historical-${i}`, sameGroup ? '1.0.0' : `1.${i}.0`),
		);
		const history = new ReleaseHistory(entries);
		let inspections = 0;
		const values = Map.prototype.values;
		const scan = spyOn(Map.prototype, 'values').mockImplementation(function<K, V>(this: Map<K, V>) {
			inspections += this.size;
			return values.call(this);
		});
		let incomplete = 0;
		try {
			for (const entry of entries) if (history.completed(entry, ['pkg:npm/widget']) === undefined) incomplete++;
		} finally {
			scan.mockRestore();
		}
		expect(incomplete).toBe(entries.length);
		expect(inspections).toBeLessThanOrEqual(entries.length);
	});
}

test('same-pass writes refresh cached negative and positive completion results and old identities', () => {
	const preparation = execution('prepare');
	const publication = execution('publish');
	const history = new ReleaseHistory([preparation, publication]);
	expect(history.completed(preparation, ['pkg:npm/widget'])).toBeUndefined();
	publication.publications = [{
		id: 'pkg:npm/widget',
		manager: 'npm',
		name: 'widget',
		version: '1.0.0',
		required: true,
		outcome: 'succeeded',
	}];
	history.update(publication);
	expect(history.completed(preparation, ['pkg:npm/widget'])?.map(entry => entry.id)).toEqual(['prepare', 'publish']);
	history.update({ ...publication, state: 'failed' });
	expect(history.completed(preparation, ['pkg:npm/widget'])).toBeUndefined();
	history.update({ ...publication, version: '2.0.0' });
	expect(history.completed(preparation, ['pkg:npm/widget'])).toBeUndefined();
	expect(history.completed({ ...publication, version: '2.0.0' }, ['pkg:npm/widget'])?.map(entry => entry.id)).toEqual([
		'publish',
	]);
});

test('completion identity isolates source, configuration, stream and release-set membership', () => {
	const member = execution('published');
	member.publications = [{
		id: 'pkg:npm/widget',
		manager: 'npm',
		name: 'widget',
		version: '1.0.0',
		required: true,
		outcome: 'succeeded',
	}];
	const history = new ReleaseHistory([member]);
	for (const other of [
		{ ...member, repositoryId: 2 },
		{ ...member, sourceSha: 'other' },
		{ ...member, configurationSha: 'other' },
		{ ...member, stream: 'other' },
		{ ...member, version: '2.0.0' },
		{ ...member, releaseSet: { preparationId: 'other', group: 'other', required: [] } },
	]) expect(history.completed(other, ['pkg:npm/widget'])).toBeUndefined();
	expect(history.completed(member, ['pkg:npm/widget'])?.map(entry => entry.id)).toEqual(['published']);
	expect(history.completed(member, ['pkg:npm/missing'])).toBeUndefined();
	expect(history.completed(member, [])).toBeUndefined();
});

test('uncommitted caller mutations cannot change cached history membership or receipts', () => {
	const member = execution('member');
	const history = new ReleaseHistory([member]);
	member.publications.push({
		id: 'pkg:npm/widget',
		manager: 'npm',
		name: 'widget',
		version: '1.0.0',
		required: true,
		outcome: 'succeeded',
	});
	expect(history.completed(member, ['pkg:npm/widget'])).toBeUndefined();
	history.update(member);
	const committed = history.completed(member, ['pkg:npm/widget']);
	expect(committed?.map(entry => entry.id)).toEqual(['member']);
	const publication = member.publications[0];
	if (!publication) throw new Error('Missing fixture publication');
	publication.outcome = 'failed';
	expect(history.completed(member, ['pkg:npm/widget'])?.[0]?.publications[0]?.outcome).toBe('succeeded');
});
