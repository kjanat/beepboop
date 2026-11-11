import { expect, test } from 'bun:test';
import type { Document } from 'happy-dom';
import { Window } from 'happy-dom';

// Browser modules are checked separately to keep DOM and Worker Element types apart.
const folds: {
	rememberFolds(
		root: Document,
		storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
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
	const storage = {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => void stored.set(key, value),
	};
	const first = page({ release: false, run: true });
	folds.rememberFolds(first.window.document, storage);
	const [release, run] = [...first.window.document.querySelectorAll('details')];
	if (!release || !run) throw new Error('No folds');
	release.open = true;
	release.dispatchEvent(new first.window.Event('toggle'));
	run.open = false;
	run.dispatchEvent(new first.window.Event('toggle'));
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
	await Promise.all([changed, needsUser, becameOpen, broken].map(entry => entry.window.happyDOM.close()));
});
