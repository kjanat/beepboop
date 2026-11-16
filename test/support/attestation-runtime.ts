import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Schema } from 'effect';
import { unstable_dev } from 'wrangler';

const input = Schema.decodeUnknownSync(Schema.Struct({
	script: Schema.String,
	cases: Schema.Array(Schema.Struct({ body: Schema.String, production: Schema.Boolean })),
}))(JSON.parse(readFileSync(0, 'utf8')));
const directory = mkdtempSync(join(tmpdir(), 'beepboop-attestation-workerd-'));
const config = join(directory, 'wrangler.json');
writeFileSync(config, JSON.stringify({ name: 'beepboop-attestation-fixture', tsconfig: relative(directory, join(dirname(input.script), '../../../tsconfig.json')) }));
const runtime = await unstable_dev(input.script, {
	config, local: true, logLevel: 'none', port: 0, inspectorPort: 0,
	compatibilityDate: '2026-10-26', compatibilityFlags: ['nodejs_compat'], envFiles: [],
	experimental: { disableExperimentalWarning: true, disableDevRegistry: true, forceLocal: true, watch: false },
});
try {
	const responses = [];
	for (const testCase of input.cases) {
		const response = await runtime.fetch(`https://probe.test/${testCase.production ? 'production' : 'fixture'}`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: testCase.body,
		});
		responses.push({ status: response.status, body: await response.json() });
	}
	process.stdout.write(JSON.stringify(responses));
} finally {
	await runtime.stop();
	rmSync(directory, { recursive: true, force: true });
}
