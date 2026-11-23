import { expect, test } from 'bun:test';
import { checkJobs, deploys } from '@/automation/deployment-jobs';

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
	'',
].join('\n');

test('checkJobs labels each job by name or id and marks matrices and environments', () => {
	expect(checkJobs(workflow)).toEqual([
		{ label: 'verify', matrix: false, deploys: false },
		{ label: 'publish', matrix: true, deploys: true },
		{ label: 'Deploy pages', matrix: false, deploys: true },
		{ label: 'pages (integration)', matrix: false, deploys: false },
		{ label: 'secrets', matrix: false, deploys: false },
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
