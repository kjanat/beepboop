import { expect, test } from 'bun:test';
import { Script } from 'node:vm';
import { renderDashboard } from '#automation/ui';

test('release-set dashboard exposes preview, preparation and merged-revision controls', async () => {
	const page = await renderDashboard([], []).text();
	expect(page).toContain('id="release-set"');
	expect(page).toContain('id="start-set"');
	expect(page).toContain('Preview these groups and operations before preparing.');
	expect(page).toContain('/api/releases/start-set');
	const script = page.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
	if (!script) throw new Error('Missing dashboard script');
	expect(() => new Script(script)).not.toThrow();
});
