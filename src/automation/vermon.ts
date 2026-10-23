import { WorkerEntrypoint } from 'cloudflare:workers';
import { record, text } from '#model';
import { readBody } from '#webhook';
import { type AutomationBindings, AutomationService } from './service.ts';

/** Exposed only as a named service-binding entrypoint, never by the public router. */
export class VermonEvents extends WorkerEntrypoint<AutomationBindings> {
	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'POST') {
			return new Response(null, { status: 404 });
		}
		const data = record(JSON.parse(new TextDecoder().decode(await readBody(request))));
		if (data.type !== 'package.version.changed') {
			return new Response('Unsupported event', { status: 400 });
		}
		const pkg = record(data.package),
			version = record(data.version);
		const registry = text(pkg.registry);
		if (!['npm', 'jsr'].includes(registry)) {
			return new Response('Unsupported registry', { status: 400 });
		}
		const id = text(data.id);
		if (request.headers.get('Idempotency-Key') !== id) {
			return new Response('Event identity mismatch', { status: 400 });
		}
		await new AutomationService(this.env).event({
			id,
			source: `${registry}:${text(pkg.name)}`,
			event: 'package.version.changed',
			version: text(version.current),
		});
		return new Response(null, { status: 202 });
	}
}
