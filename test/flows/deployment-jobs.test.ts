import { expect, test } from 'bun:test';
import { deploymentJobs, deploys } from '@/automation/deployment-jobs';

const workflow = [
	'on: push',
	'jobs:',
	'  verify:',
	'    runs-on: ubuntu-latest',
	'  publish:',
	'    environment: tag',
	'  pages:',
	'    name: Deploy pages',
	'    environment: { name: github-pages, url: "${{ steps.deploy.outputs.page_url }}" }',
	'  secrets:',
	'    environment: null',
	'',
].join('\n');

test('deploymentJobs names the jobs that declare an environment, by name or id', () => {
	expect(deploymentJobs(workflow)).toEqual(['publish', 'Deploy pages']);
});

test('deploymentJobs finds nothing in a file that is not YAML', () => {
	expect(deploymentJobs('jobs: [')).toEqual([]);
});

test.each([
	['publish', true],
	['publish (ubuntu-latest, 22)', true],
	['publisher', false],
	['verify', false],
])('deploys matches %p against the publish job: %p', (check, expected) => {
	expect(deploys(check, ['publish'])).toBe(expected);
});
