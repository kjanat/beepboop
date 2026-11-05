#!/usr/bin/env bun
import { Effect } from 'effect';
import { attempt, main, refuse } from '@/tooling/runtime';

await main(Effect.gen(function*() {
	const origin = yield* attempt(() => new URL(process.argv[2] ?? 'https://beepboop.kjanat.dev'));
	if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
		return yield* refuse('Expected HTTPS origin');
	}
	console.log(
		JSON.stringify(
			{
				name: 'Beepboop by kjanat',
				url: 'https://github.com/kjanat/beepboop',
				public: false,
				description: 'Release automation across repositories.',
				hook_attributes: { url: new URL('/webhooks/github', origin).href, active: true },
				default_permissions: {
					contents: 'write',
					actions: 'write',
					workflows: 'write',
					metadata: 'read',
					pull_requests: 'write',
					checks: 'read',
					statuses: 'read',
				},
				default_events: [
					'push',
					'release',
					'workflow_run',
					'pull_request',
					'installation',
					'installation_repositories',
				],
			},
			null,
			2,
		),
	);
}));
