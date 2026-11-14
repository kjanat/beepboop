import { expect, test } from 'bun:test';
import { withEnvironment } from '@root/test/support/process';

for (const fail of [false, true]) {
	test(`fixture environments replace ambient inputs and restore their parent after ${fail ? 'failure' : 'success'}`, async () => {
		await withEnvironment({
			BEEPBOOP_EXECUTION_ID: 'parent-execution',
			UNMODELLED_WORKFLOW_INPUT: 'parent-input',
		}, async () => {
			const child = withEnvironment({ EXECUTION_ID: '' }, async () => {
				expect(process.env.EXECUTION_ID).toBe('');
				expect(process.env.BEEPBOOP_EXECUTION_ID).toBeUndefined();
				expect(process.env.UNMODELLED_WORKFLOW_INPUT).toBeUndefined();
				process.env.FIXTURE_OUTPUT = 'child-output';
				if (fail) throw new Error('Expected fixture failure');
				return 'completed';
			});
			if (fail) await expect(child).rejects.toThrow('Expected fixture failure');
			else expect(await child).toBe('completed');
			expect(process.env.BEEPBOOP_EXECUTION_ID).toBe('parent-execution');
			expect(process.env.UNMODELLED_WORKFLOW_INPUT).toBe('parent-input');
			expect(process.env.FIXTURE_OUTPUT).toBeUndefined();
			expect(process.env.EXECUTION_ID).toBeUndefined();
		});
	});
}
