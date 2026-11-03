import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { type PackageIdentity, packageIdentity, purl } from '@/package-url';

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
		if (fixture.test_group !== 'required') continue;
		test(`${file} #${index}: ${fixture.description}`, () => {
			// ECMA-427 §5.6.6 requires lowercase keys. The pinned Maven fixture contradicts it.
			// Assert both its rejection and its corrected canonical form; never skip the case.
			if (file === 'maven.json' && index === 13) {
				expect(fixture.input).toBe(
					'pkg:Maven/org.apache.xmlgraphics/batik-anim@1.9.1?type=pom&repositorY_url=repo.spring.io/release',
				);
				expect(fixture.expected_failure).toBe(false);
				expect(() => packageIdentity(fixture.input)).toThrow('Qualifier keys must be lowercase');
				const canonicalInput = String(fixture.input).replace('repositorY_url=', 'repository_url=');
				const expected = Object.fromEntries(
					Object.entries(fixture.expected_output).filter(([, value]) => value !== null),
				);
				expect(packageIdentity(canonicalInput)).toEqual(expected);
				expect(packageIdentity(purl(canonicalInput))).toEqual(expected);
				return;
			}
			const run = () => fixture.test_type === 'parse' ? packageIdentity(fixture.input) : purl(fixture.input);
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
