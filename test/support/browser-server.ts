const root = new URL('../../', import.meta.url);
const built = await Bun.build({
	entrypoints: [new URL('src/ui/browser/folds.ts', root).pathname],
	target: 'browser',
	tsconfig: new URL('tsconfig.json', root).pathname,
});
if (!built.success || !built.outputs[0]) throw new Error(`Browser fixture build failed: ${built.logs.join('\n')}`);
const script = await built.outputs[0].text();
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
			case '/folds.js':
				return new Response(script, { headers: { 'content-type': 'text/javascript' } });
			default:
				return new Response(null, { status: 404 });
		}
	},
});
