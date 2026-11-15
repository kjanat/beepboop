import { readFile } from 'node:fs/promises';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from 'miniflare';

const source = process.argv[2];
if (!source) throw new Error('Expected the bundled RPC fixture');
const runtime = new Miniflare(convertV4MiniflareOptions({
	log: new Log(LogLevel.NONE),
	modules: true,
	compatibilityDate: '2026-10-26',
	script: await readFile(source, 'utf8'),
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
