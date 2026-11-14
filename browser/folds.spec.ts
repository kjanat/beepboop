import { expect, test } from './fixtures';

test('native mouse and keyboard choices survive navigation without initialization writes', async ({ folds }) => {
	await folds.seed({ 'release:1': { initial: false, open: true } });
	await folds.load();
	await expect(folds.release).toHaveAttribute('open', '');
	await folds.writes(0);
	const summary = folds.release.locator('summary');
	await summary.click();
	await expect(folds.release).not.toHaveAttribute('open');
	await folds.writes(1);
	await summary.press('Enter');
	await expect(folds.release).toHaveAttribute('open', '');
	await folds.writes(2);
	await summary.press('Space');
	await folds.writes(3);
	expect((await folds.saved())['release:1']).toEqual({ initial: false, open: false });
	await folds.load('?default-open');
	await expect(folds.release).toHaveAttribute('open', '');
	await folds.writes(0);
	await folds.load();
	await expect(folds.release).not.toHaveAttribute('open');
	await folds.writes(0);
});

test('programmatic toggles never become user choices', async ({ folds }) => {
	await folds.load();
	await folds.release.evaluate(element => new Promise<void>(resolve => {
		element.addEventListener('toggle', () => setTimeout(resolve, 0), { once: true });
		(element as HTMLDetailsElement).open = true;
	}));
	await folds.writes(0);
	expect(await folds.saved()).toEqual({});
});

test('retention remains bounded and preserves visible choices', async ({ folds }) => {
	await folds.seed(
		Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [`old:${i}`, { initial: false, open: true }])),
	);
	await folds.load();
	await folds.release.locator('summary').click();
	await folds.writes(1);
	const saved = await folds.saved();
	expect(Object.keys(saved)).toHaveLength(1024);
	expect(saved['release:1']).toEqual({ initial: false, open: true });
});

for (const mode of ['denied', 'quota']) {
	test(`native disclosure works when storage is ${mode}`, async ({ folds }) => {
		await folds.load(`?${mode}`);
		await folds.release.locator('summary').click();
		await expect(folds.release).toHaveAttribute('open', '');
		await folds.writes(mode === 'quota' ? 1 : 0);
		expect(await folds.saved()).toEqual({});
	});
}
