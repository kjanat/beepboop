import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { generateManifests, renderManifests } from '../src/distribution/winget/generate.ts';

const { values } = parseArgs({
	options: {
		config: { type: 'string' },
		version: { type: 'string' },
		tag: { type: 'string' },
		checksums: { type: 'string' },
		'release-notes': { type: 'string' },
		'release-date': { type: 'string' },
		out: { type: 'string' },
	},
	strict: true,
});
function required(key: keyof typeof values, environment: string): string {
	const value = values[key] ?? process.env[environment];
	if (!value) throw new Error(`Missing --${key} (${environment})`);
	return value;
}
const configuration = JSON.parse(await readFile(required('config', 'WINGET_CONFIG'), 'utf8'));
const manifests = generateManifests({
	configuration,
	version: required('version', 'WINGET_VERSION'),
	tag: values.tag || process.env.WINGET_TAG || undefined,
	releaseDate: required('release-date', 'WINGET_RELEASE_DATE'),
	checksums: await readFile(required('checksums', 'WINGET_CHECKSUMS'), 'utf8'),
	releaseNotes: await readFile(required('release-notes', 'WINGET_RELEASE_NOTES'), 'utf8'),
});
const out = resolve(required('out', 'WINGET_OUT'));
await mkdir(out, { recursive: true });
const files = [];
for (const [name, content] of Object.entries(renderManifests(manifests))) {
	const path = join(out, name);
	await writeFile(path, content, { flag: 'wx' });
	files.push(path);
	console.log(path);
}
if (process.env.GITHUB_OUTPUT) {
	const delimiter = `output_${crypto.randomUUID()}`;
	await appendFile(
		process.env.GITHUB_OUTPUT,
		`directory<<${delimiter}\n${out}\n${delimiter}\nfiles=${JSON.stringify(files)}\n`,
	);
}
