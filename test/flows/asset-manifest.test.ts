import { expect, test } from 'bun:test';
import { parseAssetManifest } from '@/actions/asset-manifest.ts';

const digest = 'ab'.repeat(32);
const first = { asset: 'dist/pkg,1.zip', sha256: digest, displayname: 'Linux "x86"', name: 'linux.zip' };
const second = { asset: 'dist/pkg 2.zip' };

test('all structured manifests retain paths, digest, display label and optional filename', () => {
	const expected = [first, second];
	const csv =
		`\uFEFFasset,sha256,displayname,name\r\n"dist/pkg,1.zip",SHA256:${digest.toUpperCase()},"Linux ""x86""",linux.zip\r\ndist/pkg 2.zip,,,\r\n`;
	expect(parseAssetManifest(csv, 'csv')).toEqual(expected);
	const tsv =
		`name\tdisplayname\tsha256\tasset\nlinux.zip\t"Linux ""x86"""\t${digest}\tdist/pkg,1.zip\n\t\t\tdist/pkg 2.zip`;
	expect(parseAssetManifest(tsv, 'tsv')).toEqual(expected);
	expect(parseAssetManifest(JSON.stringify(expected), 'json')).toEqual(expected);
	expect(parseAssetManifest(expected.map(item => JSON.stringify(item)).join('\r\n'), 'ndjson')).toEqual(expected);
	expect(parseAssetManifest('dist/a,,Mac binary\ndist/b', 'csv')).toEqual([
		{ asset: 'dist/a', displayname: 'Mac binary' },
		{ asset: 'dist/b' },
	]);
	expect(parseAssetManifest(`\n${first.asset}\r\n${second.asset}\n`, 'nl-sv')).toEqual([
		{ asset: first.asset },
		second,
	]);
});

test('invalid records and duplicate output names fail before upload', () => {
	for (
		const [format, source] of [
			['csv', '"unclosed'],
			['csv', 'a,b,c,d,e'],
			['csv', 'asset,name,name\na,b,c'],
			['csv', 'asset,sha265\nfile,'],
			['json', '[{"asset":"a","sha256":"bad"}]'],
			['json', '[{"asset":"a","sha265":"bad"}]'],
			['json', '[{"asset":"a","name":"../out"}]'],
			['ndjson', '{"asset":"  "}'],
			['nl-sv', 'dist/a\nother/a'],
			['json', '[]'],
			['tsv', '\n'],
			['json', '{"asset":"file"}'],
			['invalid', 'a'],
		] as const
	) {
		expect(() => parseAssetManifest(source, format)).toThrow();
	}
});

test('inline asset manifests infer the format and keep labels and digests', () => {
	const entries = [first, second];
	expect(parseAssetManifest('\uFEFF\n' + JSON.stringify(entries, null, 2))).toEqual(entries);
	expect(parseAssetManifest(entries.map(item => JSON.stringify(item)).join('\r\n'))).toEqual(entries);
	for (const delimiter of [',', '\t']) {
		const source = [
			['asset', 'sha256', 'displayname'].join(delimiter),
			['dist/pkg', digest, 'Linux binary'].join(delimiter),
		].join('\n');
		expect(parseAssetManifest(source)).toEqual([{ asset: 'dist/pkg', sha256: digest, displayname: 'Linux binary' }]);
	}
	expect(parseAssetManifest('dist/archive,,Compressed archive')).toEqual([
		{ asset: 'dist/archive', displayname: 'Compressed archive' },
	]);
	expect(parseAssetManifest('dist/pkg 1.zip\r\ndist/pkg 2.zip\n')).toEqual([{ asset: 'dist/pkg 1.zip' }, second]);
	expect(() => parseAssetManifest('[{"asset": "missing closing bracket"}')).toThrow();
});

test('recognized manifest extensions select the parser and an explicit format overrides the extension', () => {
	const source = 'dist/build,,Linux binary';
	expect(parseAssetManifest(source, 'auto', 'dist/assets.nl-sv')).toEqual([{ asset: source }]);
	expect(parseAssetManifest(source, 'csv', 'dist/assets.nl-sv')).toEqual([
		{ asset: 'dist/build', displayname: 'Linux binary' },
	]);
	expect(() => parseAssetManifest('dist/not-json', 'auto', 'dist/assets.json')).toThrow();
	expect(parseAssetManifest(JSON.stringify([second]), 'auto', 'dist/manifest')).toEqual([second]);
});

test('single-column CSV quoting survives automatic detection across records', () => {
	const quoted = '"dist/part,1.zip"';
	expect(parseAssetManifest(quoted)).toEqual([{ asset: 'dist/part,1.zip' }]);
	expect(parseAssetManifest(quoted + '\n"dist/part,2.zip"')).toEqual([
		{ asset: 'dist/part,1.zip' },
		{ asset: 'dist/part,2.zip' },
	]);
	expect(parseAssetManifest('asset\r\nplain.zip\r\n"part ""two"".zip"')).toEqual([
		{ asset: 'plain.zip' },
		{ asset: 'part "two".zip' },
	]);
	expect(parseAssetManifest('"dist/pkg,1.zip"\t\tLinux binary')).toEqual([
		{ asset: 'dist/pkg,1.zip', displayname: 'Linux binary' },
	]);
	expect(parseAssetManifest(quoted, 'nl-sv')).toEqual([{ asset: quoted }]);
	expect(() => parseAssetManifest('"unclosed')).toThrow();
});
