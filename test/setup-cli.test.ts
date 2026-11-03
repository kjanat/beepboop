import { expect, test } from 'bun:test';
import { command } from '@kjanat/dreamcli';
import { runCommand } from '@kjanat/dreamcli/testkit';
import { discover } from '@/automation/managers';
import { previewSetup } from '@/automation/setup';
import type { SetupChoices } from '@/automation/setup-types';
import { chooseSetup } from '@/cli/setup';

test('DreamCLI prompts produce the same validated setup plan as the dashboard API', async () => {
	const source = {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: { 'package.json': '{"name":"tool","version":"1.0.0"}' },
	};
	const inventory = discover(source), initial = await previewSetup(source, inventory, undefined, { head: null });
	let choices: SetupChoices | undefined;
	const setup = command('setup').action(async ({ ask }) => {
		choices = await chooseSetup(initial, ask);
	});
	const result = await runCommand(setup, [], {
		answers: [
			true,
			['pkg:npm/tool'],
			'workspace',
			['pkg:npm/tool'],
			'new',
			'prepare-main.yml',
			'dispatchOnly',
			'bun install\nbun test',
			'new',
			'publish-main.yml',
			'dispatchOnly',
			'npm publish',
			false,
			'b'.repeat(40),
		],
	});
	expect(result.exitCode).toBe(0);
	expect(choices?.streams[0]?.promote?.file).toBe('publish-main.yml');
	const plan = await previewSetup(source, inventory, choices, { head: null });
	expect(plan.blockers).toEqual([]);
	expect(plan.edits).toHaveLength(3);
	expect((await previewSetup(source, inventory, JSON.parse(JSON.stringify(choices)), { head: null })).planId).toBe(
		plan.planId,
	);
});
test('cancelling DreamCLI setup does not reach apply', async () => {
	const { PROMPT_CANCEL } = await import('@kjanat/dreamcli/testkit');
	const source = {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: { 'package.json': '{"name":"tool","version":"1.0.0"}' },
	};
	const plan = await previewSetup(source, discover(source), undefined, { head: null });
	let completed = false;
	const result = await runCommand(
		command('setup').action(async ({ ask }) => {
			await chooseSetup(plan, ask);
			completed = true;
		}),
		[],
		{ answers: [PROMPT_CANCEL] },
	);
	expect(result.exitCode).not.toBe(0);
	expect(completed).toBe(false);
});
