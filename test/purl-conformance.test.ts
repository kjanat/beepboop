import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { type PackageIdentity, packageIdentity, purl } from '@/package-url';
import { normalizePackage } from '@/package-url/normalize';

interface Case {
	description: string;
	test_group: string;
	test_type: string;
	input: string | PackageIdentity;
	expected_output: string | PackageIdentity;
	expected_failure: boolean;
}
for (const file of readdirSync('test/fixtures/purl')) {
	const cases = JSON.parse(readFileSync(`test/fixtures/purl/${file}`, 'utf8')).tests as Case[];
	for (const [index, fixture] of cases.entries()) {
		test(`${fixture.test_group} ${file} #${index}: ${fixture.description}`, () => {
			// ECMA-427 §5.6.6 requires lowercase keys. The pinned Maven fixture contradicts it.
			// Assert both its rejection and its corrected canonical form; never skip the case.
			if (file === 'maven.json' && index === 13) {
				expect(fixture.input).toBe(
					'pkg:Maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=pom&repositorY_url=repo.spring.io/release',
				);
				expect(fixture.expected_failure).toBe(false);
				expect(() => packageIdentity(fixture.input)).toThrow('Qualifier keys must be lowercase');
				const normalized = normalizePackage(fixture.input);
				const expected = Object.fromEntries(
					Object.entries(fixture.expected_output).filter(([, value]) => value !== null),
				);
				expect(normalized as unknown).toEqual(expected);
				expect(packageIdentity(purl(normalized)) as unknown).toEqual(expected);
				return;
			}
			if (file === 'git.json' && index === 0) {
				// The definition marks Git paths case-sensitive; lowercasing can name another repository.
				expect(fixture.test_group).toBe('recommended');
				expect(fixture.input).toBe('pkg:git/github/Package-url/purl-Spec@244fd47e07d1004f0aed9c');
				expect(purl(normalizePackage(fixture.input))).toBe(String(fixture.input));
				return;
			}
			const run = () => {
				const identity = fixture.test_group === 'recommended'
					? normalizePackage(fixture.input)
					: packageIdentity(fixture.input);
				return fixture.test_type === 'parse' ? identity : purl(identity);
			};
			if (fixture.expected_failure) expect(run).toThrow();
			else if (fixture.test_type === 'parse') {
				const expected = Object.fromEntries(
					Object.entries(fixture.expected_output).filter(([, value]) => value !== null),
				);
				expect(run() as unknown).toEqual(expected);
			} else expect(run()).toBe(fixture.expected_output);
		});
	}
}
