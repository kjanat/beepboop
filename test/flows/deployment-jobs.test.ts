import { expect, test } from 'bun:test';
import { checkJobs, deploys } from '@/discovery/workflow-analysis/deployment-jobs.ts';

const workflow = [
	'on: push',
	'jobs:',
	'  verify:',
	'    runs-on: ubuntu-latest',
	'  publish:',
	'    environment: tag',
	'    strategy: { matrix: { os: [ubuntu-latest] } }',
	'  pages:',
	'    name: Deploy pages',
	'    environment: { name: github-pages, url: "${{ steps.deploy.outputs.page_url }}" }',
	'  integration:',
	'    name: pages (integration)',
	'  secrets:',
	'    environment: null',
	'  release:',
	'    name: Publish ${{ matrix.target }}.x',
	'    environment: registry',
	'    strategy: { matrix: { target: [npm, jsr] } }',
	'  test:',
	'    name: Test ${{ matrix.os }}',
	'    strategy: { matrix: { os: [ubuntu-latest] } }',
	'',
].join('\n');

test('checkJobs labels each job by name or id and marks matrices and environments', () => {
	expect(checkJobs(workflow)).toEqual([
		{ label: 'verify', matrix: false, deploys: false, calls: false },
		{ label: 'publish', matrix: true, deploys: true, calls: false },
		{ label: 'Deploy pages', matrix: false, deploys: true, calls: false },
		{ label: 'pages (integration)', matrix: false, deploys: false, calls: false },
		{ label: 'secrets', matrix: false, deploys: false, calls: false },
		{ label: 'Publish ${{ matrix.target }}.x', matrix: true, deploys: true, calls: false },
		{ label: 'Test ${{ matrix.os }}', matrix: true, deploys: false, calls: false },
	]);
});

test('checkJobs finds no jobs in a file that is not YAML', () => {
	expect(checkJobs('jobs: [')).toEqual([]);
});

test.each([
	['publish', true],
	['publish (ubuntu-latest)', true],
	['Deploy pages', true],
	['Deploy pages (preview)', false],
	['pages (integration)', false],
	['publisher', false],
	['verify', false],
	['Publish npm.x', true],
	['Publish npmx', false],
	['Test ubuntu-latest', false],
])('deploys classifies the check %p as a deployment: %p', (check, expected) => {
	expect(deploys(check, checkJobs(workflow))).toBe(expected);
});

test('deploys keeps a check that matches a deployment job and a job without an environment', () => {
	const jobs = checkJobs(
		[
			'jobs:',
			'  verify:',
			'    environment: tag',
			'    strategy: { matrix: { suite: [unit] } }',
			'  other:',
			'    name: verify (unit)',
			'',
		].join('\n'),
	);
	expect(deploys('verify (unit)', jobs)).toBe(false);
});

test.each([
	["${{ format('publish ({0})', matrix.suite) }}"],
	['${{ matrix.suite }}'],
	["${{ format('}}', matrix.suite) }} (integration)"],
	['${{ matrix.suite'],
])('deploys keeps a check that a plain job called %p can render', name => {
	const jobs = checkJobs(
		[
			'jobs:',
			'  publish:',
			'    environment: tag',
			'    strategy: { matrix: { target: [npm] } }',
			'  suites:',
			`    name: "${name}"`,
			'    strategy: { matrix: { suite: [integration] } }',
			'',
		].join('\n'),
	);
	expect(deploys('publish (integration)', jobs)).toBe(false);
	expect(deploys('publish (npm)', jobs)).toBe(name === "${{ format('}}', matrix.suite) }} (integration)");
});

test('checkJobs marks a reusable workflow caller as a job without an environment', () => {
	expect(checkJobs(['jobs:', '  tests:', '    uses: ./.github/workflows/tests.yml', ''].join('\n'))).toEqual([
		{ label: 'tests', matrix: false, deploys: false, calls: true },
	]);
});

test.each([
	['tests', 'tests / publish', false],
	['tests', 'tests / inner / publish', false],
	['tests', 'publish', true],
	['Run ${{ matrix.suite }}', 'Run unit / publish', false],
	['Run ${{ matrix.suite }}', 'Run unit (linux) / publish', false],
	['Run ${{ matrix.suite }}', 'publish', true],
])('deploys keeps a check that the caller %p of a reusable workflow can own: %p', (caller, check, expected) => {
	const jobs = checkJobs(
		[
			'jobs:',
			'  deployment:',
			`    name: "${check}"`,
			'    environment: tag',
			'  tests:',
			`    name: "${caller}"`,
			'    uses: ./.github/workflows/tests.yml',
			'    strategy: { matrix: { suite: [unit] } }',
			'',
		].join('\n'),
	);
	expect(deploys(check, jobs)).toBe(expected);
});

test.each([
	['Ship npm to jsr', true],
	['Ship npm jsr', false],
	['Ship to', false],
	['Ship n\npm to jsr', false],
	['Ship npm to j\u2028sr', false],
])('deploys matches %p against the literal text around each expression: %p', (check, expected) => {
	const jobs = checkJobs(
		['jobs:', '  ship:', '    name: Ship ${{ matrix.a }} to ${{ matrix.b }}', '    environment: tag', ''].join('\n'),
	);
	expect(deploys(check, jobs)).toBe(expected);
});

test('deploys rejects a check against many adjacent expressions in linear time', () => {
	const jobs = checkJobs(
		['jobs:', '  ship:', `    name: ${'${{ matrix.x }}'.repeat(12)}Z`, '    environment: tag', ''].join('\n'),
	);
	const started = performance.now();
	expect(deploys('a'.repeat(24), jobs)).toBe(false);
	expect(performance.now() - started).toBeLessThan(50);
});
