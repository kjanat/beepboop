import { createServer } from 'node:http';
import { createRuntime } from '@root/test/runtime/environment';

const context = await createRuntime();
try {
	const seeded = await context.fetch('https://automation.test/browser-init');
	if (!seeded.ok) throw Error('Browser fixture initialization failed');
	const server = createServer(async (request, response) => {
		try {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			const headers = new Headers();
			for (const [key, value] of Object.entries(request.headers)) {
				if (value && key !== 'host') headers.set(key, Array.isArray(value) ? value.join(',') : value);
			}
			headers.set('cookie', `__Host-beepboop_access=${context.access}`);
			if (headers.has('origin')) headers.set('origin', 'https://automation.test');
			const result = await context.fetch(`https://automation.test${request.url}`, {
				method: request.method,
				headers: Object.fromEntries(headers),
				body: chunks.length ? Buffer.concat(chunks) : undefined,
				redirect: 'manual',
			});
			response.writeHead(result.status, Object.fromEntries(result.headers));
			response.end(Buffer.from(await result.arrayBuffer()));
		} catch {
			response.writeHead(500);
			response.end('Fixture request failed');
		}
	});
	await new Promise<void>(resolve => server.listen(4331, '127.0.0.1', resolve));
	console.log('Authenticated test fixture at http://127.0.0.1:4331 (isolated temporary database).');
	await new Promise<void>(resolve => {
		process.once('SIGINT', () => server.close(() => resolve()));
		process.once('SIGTERM', () => server.close(() => resolve()));
	});
} finally {
	await context.close();
}
