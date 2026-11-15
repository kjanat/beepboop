import { readFileSync } from 'node:fs';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from 'miniflare';

const runtime = new Miniflare(convertV4MiniflareOptions({
	log: new Log(LogLevel.NONE),
	modules: true,
	compatibilityDate: '2026-10-26',
	script: readFileSync(0, 'utf8'),
	durableObjects: { PROBE: 'Probe' },
}));
try {
	const responses = await Promise.all(['precondition', 'upstream', 'defect', 'malformed'].map(async kind => {
		const response = await runtime.dispatchFetch(`https://probe.test/${kind}`);
		return { kind, status: response.status, body: await response.json() };
	}));
	process.stdout.write(JSON.stringify(responses));
} finally {
	await runtime.dispose();
}
