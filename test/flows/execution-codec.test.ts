import { expect, test } from 'bun:test';
import { packedRelease } from '@root/test/support/packed-release.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Schema } from 'effect';
import { executionSchema } from '@/release/adapters/codecs/execution-v1.ts';

let world: World;
eachWorld(created => {
	world = created;
});

test('stored execution documents decode and encode back to the same document', async () => {
	const { repository } = await packedRelease(world);
	const journal = await world.coordinator(repository).exportJournal();
	const documents = journal.filter(entry => entry.key.startsWith('execution:')).map(entry => entry.value);
	expect(documents.length).toBeGreaterThan(1);
	for (const document of documents) {
		const decoded = Schema.decodeUnknownSync(executionSchema)(document);
		expect(document).toEqual(decoded);
		expect(document).toEqual(Schema.encodeSync(executionSchema)(decoded));
	}
}, 30_000);
