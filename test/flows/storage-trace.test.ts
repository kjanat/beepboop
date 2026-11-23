import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStorage } from '@root/test/support/do-storage.ts';
import { withEnvironment } from '@root/test/support/process.ts';
import { finishTrace, startTrace, testFile } from '@root/test/support/storage-trace.ts';
import { World } from '@root/test/support/world.ts';

const root = new URL('../../', import.meta.url).pathname;
const traceFile = 'test-flows-storage-trace.test.ts.trace';
type Writes = (storage: MemoryStorage) => Promise<void>;

async function traced(directory: string, writes: Writes): Promise<void> {
	await withEnvironment({ BEEPBOOP_STORAGE_TRACE: directory }, async () => {
		startTrace(testFile());
		await writes(new MemoryStorage('AutomationCoordinator:1'));
		finishTrace();
	});
}

async function compared(...directories: string[]): Promise<{ code: number; output: string }> {
	const child = Bun.spawn([process.execPath, 'scripts/storage-trace.ts', ...directories], {
		cwd: root,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [output, errors, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, output: output + errors };
}

async function inTemp(work: (temp: string) => Promise<void>): Promise<void> {
	const temp = mkdtempSync(join(tmpdir(), 'beepboop-trace-'));
	try {
		await work(temp);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

function summary(randomized: number, differ: number): string {
	return `1 worlds, 4 writes compared, ${randomized} equal after renaming random tokens or keys that differ between baseline runs, ${differ} differ\n`;
}

test('every Durable Object storage write lands in the trace in write order', () =>
	inTemp(async temp => {
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		await traced(temp, async storage => {
			await storage.put('execution:a', { id: 'a', reason: undefined, at: new Date(5), seen: new Map([['k', 1]]) });
			await storage.put({ 'outbox:1': { revision: 1 }, 'journal:seq': 1, 'odd key': cyclic });
			await storage.delete('execution:a');
			await storage.delete(['outbox:1', 'journal:seq']);
			await storage.setAlarm(new Date(60_000));
			await storage.deleteAlarm();
			await storage.transaction(async transaction => {
				await transaction.put('release:x', true);
				throw new Error('rolled back');
			}).catch(() => undefined);
			await storage.deleteAll();
		});

		expect(readFileSync(join(temp, traceFile), 'utf8')).toBe([
			'## world 1',
			'AutomationCoordinator:1 put "execution:a" {"id":"a","reason":undefined,"at":Date(5),"seen":Map{"k"=>1}}',
			'AutomationCoordinator:1 put "outbox:1" {"revision":1}',
			'AutomationCoordinator:1 put "journal:seq" 1',
			'AutomationCoordinator:1 put "odd key" {"self":<cycle 1>}',
			'AutomationCoordinator:1 delete "execution:a"',
			'AutomationCoordinator:1 delete "outbox:1"',
			'AutomationCoordinator:1 delete "journal:seq"',
			'AutomationCoordinator:1 setAlarm "<alarm>" 60000',
			'AutomationCoordinator:1 deleteAlarm "<alarm>"',
			'AutomationCoordinator:1 put "release:x" true',
			'AutomationCoordinator:1 rollback "<transaction>"',
			'AutomationCoordinator:1 deleteAll "<all>"',
			'',
		].join('\n'));
	}));

test('a test World traces each coordinator under its namespace and instance name', () =>
	inTemp(async temp => {
		await withEnvironment({ BEEPBOOP_STORAGE_TRACE: temp }, async () => {
			const world = await World.create();
			try {
				await world.coordinators.instance('42').storage.put('reconcile-at', null);
				await world.budgets.instance('crates-io').storage.setAlarm(7);
			} finally {
				world.dispose();
			}
		});

		expect(readFileSync(join(temp, traceFile), 'utf8')).toBe([
			'## world 1',
			'AutomationCoordinator:42 put "reconcile-at" null',
			'PublishBudget:crates-io setAlarm "<alarm>" 7',
			'',
		].join('\n'));
	}));

test('storage traces match across random tokens and report changed documents and write order', () =>
	inTemp(async temp => {
		const signature = (body: string) => `-----BEGIN PGP SIGNATURE-----\n${body}\n-----END PGP SIGNATURE-----`;
		const run = (id: string, folder: string, quarantine: object): Writes => async storage => {
			const delivery = crypto.randomUUID();
			await storage.put(`execution:${id}`, { id, tag: signature(id.slice(0, 4)), path: `/tmp/${folder}/x` });
			await storage.put(`inbox:${delivery}`, { delivery });
			await storage.delete(`inbox:${delivery}`);
			await storage.put('quarantine:x', quarantine);
		};
		const directory = (name: string) => join(temp, name);
		const a = 'a'.repeat(40), b = 'b'.repeat(40);
		await traced(directory('before'), run(a, 'beepboop-cli-report-Ab12Cd', { error: 'e', at: 1 }));
		await traced(directory('same'), run(b, 'beepboop-cli-report-Zz98Yy', { error: 'e', at: 1 }));
		await traced(directory('reordered'), run(a, 'beepboop-cli-report-Ab12Cd', { at: 1, error: 'e' }));
		await traced(directory('swapped'), async storage => {
			await storage.put('quarantine:x', { error: 'e', at: 1 });
			await run(a, 'beepboop-cli-report-Ab12Cd', { error: 'e', at: 1 })(storage);
		});
		await traced(directory('unsettled'), run(a, 'beepboop-cli-report-Ab12Cd', { error: 'e', at: 2 }));
		await traced(directory('extra'), async storage => {
			await run(a, 'beepboop-cli-report-Ab12Cd', { error: 'e', at: 3 })(storage);
			await storage.put('ledger:y', true);
		});

		expect(await compared(directory('before'), directory('same'))).toEqual({ code: 0, output: summary(1, 0) });
		expect(await compared(directory('before'), directory('reordered'))).toEqual({
			code: 1,
			output: [
				`${traceFile} world 1:`,
				'- AutomationCoordinator:1 put "quarantine:x" {"error":"e","at":1}',
				'+ AutomationCoordinator:1 put "quarantine:x" {"at":1,"error":"e"}',
				summary(0, 1),
			].join('\n'),
		});
		expect((await compared(directory('before'), directory('swapped'))).code).toBe(1);
		expect(await compared(directory('before'), directory('unsettled'), directory('unsettled'))).toEqual({
			code: 0,
			output: summary(1, 0),
		});
		expect(await compared(directory('before'), directory('reordered'), directory('unsettled'))).toEqual({
			code: 0,
			output: summary(1, 0),
		});
		expect(await compared(directory('before'), directory('same'), directory('reordered'))).toEqual({
			code: 0,
			output: summary(1, 0),
		});
		expect(await compared(directory('before'), directory('extra'), directory('unsettled'))).toEqual({
			code: 1,
			output: [`${traceFile} world 1:`, '+ AutomationCoordinator:1 put "ledger:y" true', summary(0, 1)].join('\n'),
		});
		expect(await compared(directory('before'), directory('missing'))).toEqual({
			code: 2,
			output: `${directory('missing')} does not exist\n`,
		});
	}));
