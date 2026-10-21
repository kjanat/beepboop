const origin = new URL(process.argv[2] ?? 'https://beepboop.kjanat.dev');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
	throw new Error('Expected HTTPS origin');
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
				metadata: 'read',
				pull_requests: 'write',
				checks: 'read',
				statuses: 'read',
			},
			default_events: [
				'push',
				'release',
				'workflow_run',
				'installation',
				'installation_repositories',
			],
		},
		null,
		2,
	),
);

export {};
