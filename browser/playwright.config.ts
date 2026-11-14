import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: '**/*.spec.ts',
	outputDir: '../output/playwright/results',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	workers: 2,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:4179',
		browserName: 'chromium',
		launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
		trace: 'retain-on-failure',
	},
	webServer: {
		command: 'bun test/support/browser-server.ts',
		cwd: new URL('..', import.meta.url).pathname,
		url: 'http://127.0.0.1:4179/empty',
		reuseExistingServer: false,
	},
});
