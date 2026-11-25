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
