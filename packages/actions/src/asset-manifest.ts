import { basename, extname } from 'node:path';
import { parse } from 'csv-parse/sync';
import { Schema } from 'effect';
import { decodeSync, matchesPattern, mutableArray, refined, strictStruct } from '@/kernel/schema/structs.ts';

const nonblank = refined(
	Schema.String,
	value => value.trim().length > 0 && !value.includes('\0'),
	'Expected nonblank text',
);
const filename = refined(
	nonblank,
	value => !/[\\/]/.test(value) && value !== '.' && value !== '..',
	'Expected a filename',
);
const entry = strictStruct({
	asset: nonblank,
	sha256: Schema.optionalKey(Schema.String.check(matchesPattern(/^(?:sha256:)?[a-f\d]{64}$/i))),
	displayname: Schema.optionalKey(nonblank),
	name: Schema.optionalKey(filename),
});
const manifest = mutableArray(entry).check(Schema.isMinLength(1));
export type AssetManifestEntry = typeof entry.Type;

const columns = ['asset', 'sha256', 'displayname', 'name'];

function delimited(input: string, delimiter: string) {
	const rows = parse(input, { delimiter, skip_empty_lines: true, relax_column_count: true });
	const first = rows[0] ?? [];
	let keys = columns;
	if (first.includes('asset') && (first[0] === 'asset' || first.every(key => columns.includes(key)))) {
		const unknown = first.find(key => !columns.includes(key));
		if (unknown !== undefined) throw new Error(`Unknown asset manifest column: ${unknown}`);
		if (new Set(first).size !== first.length) throw new Error('Asset manifest has duplicate column names');
		keys = first;
		rows.shift();
	}
	return rows.map((row, index) => {
		if (row.length > keys.length) throw new Error(`Too many fields in asset manifest record ${index + 1}`);
		return Object.fromEntries(row.flatMap((value, i) => value === '' ? [] : [[keys[i], value]]));
	});
}

function records(input: string, format: string): unknown {
	switch (format) {
		case 'csv':
		case 'tsv':
			return delimited(input, format === 'csv' ? ',' : '\t');
		case 'json':
			return JSON.parse(input);
		case 'ndjson':
			return input.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
		case 'nl-sv':
			return input.split(/\r?\n/).filter(line => line.trim()).map(asset => ({ asset }));
		default:
			throw new Error(`Unknown asset manifest format: ${format}`);
	}
}

function detectFormat(input: string, manifestPath: string) {
	const extension = extname(manifestPath).slice(1).toLowerCase();
	if (['csv', 'tsv', 'json', 'ndjson', 'nl-sv'].includes(extension)) return extension;
	if (extension === 'jsonl') return 'ndjson';

	const text = input.trimStart();
	if (text.startsWith('[')) return 'json';
	if (text.startsWith('{')) return 'ndjson';

	// A delimiter inside a quoted filename belongs to the field.
	const delimiter = text.replace(/"(?:[^"]|"")*"/g, '').match(/[,\t]/)?.[0];
	if (delimiter === '\t') return 'tsv';
	if (delimiter === ',' || /^"/m.test(text)) return 'csv';
	return 'nl-sv';
}

export function parseAssetManifest(input: string, format = 'auto', manifestPath = ''): AssetManifestEntry[] {
	const source = input.replace(/^\uFEFF/, '');
	const entries = decodeSync(
		manifest,
		records(source, format === 'auto' ? detectFormat(source, manifestPath) : format),
	);
	const names = new Set<string>();
	for (const item of entries) {
		const name = decodeSync(filename, item.name ?? basename(item.asset));
		if (names.has(name)) throw new Error(`Duplicate release asset name: ${name}`);
		names.add(name);
		if (item.sha256) item.sha256 = item.sha256.toLowerCase().replace(/^sha256:/, '');
	}
	return entries;
}
