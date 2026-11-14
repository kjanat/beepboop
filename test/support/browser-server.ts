const root = new URL('../../', import.meta.url);
const built = await Bun.build({
	entrypoints: ['folds', 'app'].map(name => new URL(`src/ui/browser/${name}.ts`, root).pathname),
	target: 'browser',
	tsconfig: new URL('tsconfig.json', root).pathname,
});
if (!built.success || built.outputs.length !== 2) {
	throw new Error(`Browser fixture build failed: ${built.logs.join('\n')}`);
}
const scripts = new Map(
	await Promise.all(
		built.outputs.map(async output =>
			[new URL(output.path, root).pathname.split('/').at(-1), await output.text()] as const
		),
	),
);
const polling = await Bun.file(new URL('browser/fixtures/polling.html', root)).text();
const html = await Bun.file(new URL('browser/fixtures/folds.html', root)).text();
Bun.serve({
	hostname: '127.0.0.1',
	port: 4179,
	fetch(request) {
		switch (new URL(request.url).pathname) {
			case '/empty':
				return new Response('<!doctype html><title>Fixture origin</title>', {
					headers: { 'content-type': 'text/html' },
				});
			case '/folds':
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			case '/polling':
				return new Response(polling, { headers: { 'content-type': 'text/html' } });
			case '/app.js':
			case '/folds.js':
				return new Response(scripts.get(new URL(request.url).pathname.slice(1)), {
					headers: { 'content-type': 'text/javascript' },
				});
			default:
				return new Response(null, { status: 404 });
		}
	},
});
