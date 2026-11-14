import { expect, test } from 'bun:test';
import { jsonBatches } from '@/persistence/d1/json-batches';

test('JSON parameters count exact UTF-8 bytes including enclosing arrays and commas', () => {
	for (const length of [999_995, 999_996, 999_997, 999_998]) {
		const input = 'x'.repeat(length), batches = jsonBatches([input]);
		expect(batches).toHaveLength(1);
		const batch = batches[0]!;
		if (length <= 999_996) {
			expect('json' in batch).toBe(true);
			if ('json' in batch) {
				expect(new TextEncoder().encode(batch.json).length).toBe(length + 4);
				expect(JSON.parse(batch.json)).toEqual([input]);
			}
		} else expect(batch).toEqual({ row: input });
	}
	const input = ['λ'.repeat(249_998), 'λ'.repeat(249_998), '\\"'.repeat(250_000), 'end'];
	const batches = jsonBatches(input);
	const restored: string[] = [];
	for (const batch of batches) {
		if ('json' in batch) {
			expect(new TextEncoder().encode(batch.json).length).toBeLessThanOrEqual(1_000_000);
			restored.push(...JSON.parse(batch.json));
		} else restored.push(batch.row);
	}
	expect(restored).toEqual(input);
	expect(jsonBatches([])).toEqual([]);
});
