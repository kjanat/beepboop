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
		// Upstream maven #13 accepts an uppercase qualifier key, while rpm #1 and gem #1 require rejection.
		// Follow the core lowercase-key rule until upstream resolves this contradictory fixture.
		if (file === 'maven.json' && index === 13) {
			test.todo('upstream maven #13 conflicts with the lowercase qualifier-key rule');
			continue;
		}
		test(`${file} #${index}: ${fixture.description}`, () => {
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
