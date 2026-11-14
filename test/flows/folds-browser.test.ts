import { expect, test } from 'bun:test';
import type { Document } from 'happy-dom';
import { Window } from 'happy-dom';

// Browser modules are checked separately to keep DOM and Worker Element types apart.
const folds: {
	rememberFolds(
		root: Document,
		open: () => { getItem(key: string): string | null; setItem(key: string, value: string): void },
	): void;
} = await import(new URL('../../src/ui/browser/folds.ts', import.meta.url).href);

function page(open: { release: boolean; run: boolean }) {
	const window = new Window();
	window.document.body.innerHTML = `
		<details data-fold="release:1" ${open.release ? 'open' : ''}><summary>Release</summary></details>
		<details data-fold="run:a" ${open.run ? 'open' : ''}><summary>Run</summary></details>
		<details><summary>Unnamed</summary></details>`;
	const state = () => [...window.document.querySelectorAll('details')].map(fold => fold.hasAttribute('open'));
	return { window, state };
}

test('a reload keeps the folds the user opened and closed', async () => {
	const stored = new Map<string, string>();
	const held = {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => void stored.set(key, value),
	};
	const storage = () => held;
	const first = page({ release: false, run: true });
	folds.rememberFolds(first.window.document, storage);
	const [release, run] = [...first.window.document.querySelectorAll('details')];
	if (!release || !run) throw new Error('No folds');
	release.querySelector('summary')!.click();
	run.querySelector('summary')!.click();
	await new Promise(resolve => setTimeout(resolve, 0));
	await first.window.happyDOM.close();

	const reloaded = page({ release: false, run: true });
	folds.rememberFolds(reloaded.window.document, storage);
	expect(reloaded.state()).toEqual([true, false, false]);
	await reloaded.window.happyDOM.close();

	const changed = page({ release: true, run: false });
	folds.rememberFolds(changed.window.document, storage);
	expect(changed.state()).toEqual([true, false, false]);
	const needsUser = page({ release: false, run: false });
	stored.set('beepboop:folds', JSON.stringify({ 'run:a': { initial: true, open: false } }));
	folds.rememberFolds(needsUser.window.document, storage);
	expect(needsUser.state()).toEqual([false, false, false]);
	const becameOpen = page({ release: false, run: true });
	stored.set('beepboop:folds', JSON.stringify({ 'run:a': { initial: false, open: false } }));
	folds.rememberFolds(becameOpen.window.document, storage);
	expect(becameOpen.state()).toEqual([false, true, false]);
	stored.set('beepboop:folds', 'not json');
	const broken = page({ release: false, run: true });
	folds.rememberFolds(broken.window.document, storage);
	expect(broken.state()).toEqual([false, true, false]);
	const denied = page({ release: false, run: true });
	folds.rememberFolds(denied.window.document, () => {
		throw new Error('SecurityError');
	});
	expect(denied.state()).toEqual([false, true, false]);
	await Promise.all([changed, needsUser, becameOpen, broken, denied].map(entry => entry.window.happyDOM.close()));
});

test('fold retention evicts older off-page choices and survives quota failures', async () => {
	let value = JSON.stringify(Object.fromEntries([
		['run:a', { initial: true, open: false }],
		...Array.from({ length: 1100 }, (_, i) => [`old:${i}`, { initial: false, open: true }]),
	]));
	const current = page({ release: false, run: true });
	folds.rememberFolds(current.window.document, () => ({
		getItem: () => value,
		setItem: (_key, next) => {
			value = next;
		},
	}));
	current.window.document.querySelector('summary')!.click();
	await new Promise(resolve => setTimeout(resolve, 0));
	const saved = JSON.parse(value);
	expect(Object.keys(saved)).toHaveLength(1024);
	expect(saved['run:a']).toEqual({ initial: true, open: false });
	expect(saved['release:1']).toEqual({ initial: false, open: true });
	expect(saved['old:0']).toBeUndefined();
	const denied = page({ release: false, run: true });
	folds.rememberFolds(denied.window.document, () => ({
		getItem: () => null,
		setItem: () => {
			throw new Error('QuotaExceededError');
		},
	}));
	denied.window.document.querySelector('summary')!.click();
	await new Promise(resolve => setTimeout(resolve, 0));
	expect(denied.state()).toEqual([true, true, false]);
	await Promise.all([current.window.happyDOM.close(), denied.window.happyDOM.close()]);
});

test('initialization and programmatic toggles do not persist preferences', async () => {
	let writes = 0;
	const current = page({ release: false, run: true });
	folds.rememberFolds(current.window.document, () => ({
		getItem: () => '{"release:1":{"initial":false,"open":true}}',
		setItem: () => {
			writes++;
		},
	}));
	const release = current.window.document.querySelector('details')!;
	release.dispatchEvent(new current.window.Event('toggle'));
	release.open = false;
	release.dispatchEvent(new current.window.Event('toggle'));
	await new Promise(resolve => setTimeout(resolve, 0));
	expect(writes).toBe(0);
	await current.window.happyDOM.close();
});
