import type { Locator } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

type Choices = Record<string, { initial: boolean; open: boolean }>;
interface Folds {
	release: Locator;
	load(query?: string): Promise<void>;
	seed(choices: Choices): Promise<void>;
	saved(): Promise<Choices>;
	writes(count: number): Promise<void>;
}
export const test = base.extend<{ folds: Folds }>({
	folds: async ({ page }, use) => {
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto('/empty');
		await use({
			release: page.locator('details[data-fold="release:1"]'),
			async load(query = '') {
				await page.goto(`/folds${query}`);
				await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
			},
			async seed(choices) {
				await page.evaluate(value => sessionStorage.setItem('beepboop:folds', JSON.stringify(value)), choices);
			},
			async saved() {
				return page.evaluate(() => JSON.parse(sessionStorage.getItem('beepboop:folds') ?? '{}'));
			},
			async writes(count) {
				await expect(page.locator('#writes')).toHaveText(String(count));
			},
		});
		expect(errors).toEqual([]);
	},
});
export { expect } from '@playwright/test';
