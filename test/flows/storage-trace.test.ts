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
		env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'GITHUB_ACTIONS')),
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

function summary(randomized: number, differ: number, writes = 4): string {
	const report =
		`1 worlds, ${writes} writes compared, ${randomized} equal after renaming random tokens or equal to the second baseline run, ${differ} differ\n`;
	return differ ? `${report}${differ} worlds wrote different storage\n` : report;
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
			await run(a, 'beepboop-cli-report-Ab12Cd', { error: 'e', at: 2 })(storage);
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
			code: 1,
			output: [
				`${traceFile} world 1:`,
				'- AutomationCoordinator:1 put "quarantine:x" {"error":"e","at":1}',
				'+ AutomationCoordinator:1 put "quarantine:x" {"at":1,"error":"e"}',
				summary(0, 1),
			].join('\n'),
		});
		expect(await compared(directory('before'), directory('same'), directory('reordered'))).toEqual({
			code: 0,
			output: summary(1, 0),
		});
		expect(await compared(directory('before'), directory('extra'), directory('unsettled'))).toEqual({
			code: 1,
			output: [
				`${traceFile} world 1:`,
				'- AutomationCoordinator:1 put "quarantine:x" {"error":"e","at":1}',
				'+ AutomationCoordinator:1 put "quarantine:x" {"error":"e","at":2}',
				'+ AutomationCoordinator:1 put "ledger:y" true',
				summary(0, 1),
			].join('\n'),
		});
		expect(await compared(directory('before'), directory('missing'))).toEqual({
			code: 1,
			output: `${directory('missing')} does not exist\n`,
		});
	}));

test('a key that differs between baseline runs leaves token names of other keys intact', () =>
	inTemp(async temp => {
		const directory = (name: string) => join(temp, name);
		const run = (quarantine: object, state: string): Writes => async storage => {
			await storage.put('quarantine:x', quarantine);
			await storage.put('execution:s', { id: 's', run: crypto.randomUUID(), state });
		};
		await traced(directory('before'), run({ error: 'e' }, 'ready'));
		await traced(directory('again'), run({ error: 'e', trace: crypto.randomUUID() }, 'ready'));
		await traced(directory('after'), run({ error: 'e' }, 'failed'));

		expect(await compared(directory('before'), directory('after'), directory('again'))).toEqual({
			code: 1,
			output: [
				`${traceFile} world 1:`,
				'- AutomationCoordinator:1 put "execution:s" {"id":"s","run":"<random 1>","state":"ready"}',
				'+ AutomationCoordinator:1 put "execution:s" {"id":"s","run":"<random 1>","state":"failed"}',
				summary(0, 1, 2),
			].join('\n'),
		});
	}));

test('a random key that only the second baseline run writes leaves other random keys comparable', () =>
	inTemp(async temp => {
		const directory = (name: string) => join(temp, name);
		const run = (value: number, extra: boolean): Writes => async storage => {
			if (extra) await storage.put(`inbox:${crypto.randomUUID()}`, true);
			await storage.put(`execution:${crypto.randomUUID()}`, { value });
			await storage.put('quarantine:x', 1);
		};
		await traced(directory('before'), run(1, false));
		await traced(directory('again'), run(1, true));
		await traced(directory('after'), run(2, false));

		expect(await compared(directory('before'), directory('after'), directory('again'))).toEqual({
			code: 1,
			output: [
				`${traceFile} world 1:`,
				'- AutomationCoordinator:1 put "execution:<random 1>" {"value":1}',
				'+ AutomationCoordinator:1 put "execution:<random 1>" {"value":2}',
				summary(0, 1, 2),
			].join('\n'),
		});
	}));

test('a key that differs between baseline runs fails when the new run writes neither baseline value', () =>
	inTemp(async temp => {
		const directory = (name: string) => join(temp, name);
		const stable = crypto.randomUUID();
		const run = (state: string, transient: boolean): Writes => async storage => {
			if (transient) await storage.put(`execution:${crypto.randomUUID()}`, { state: 'transient' });
			await storage.put(`execution:${stable}`, { state });
		};
		await traced(directory('before'), run('ready', false));
		await traced(directory('again'), run('ready', true));
		await traced(directory('after'), run('failed', false));

		expect(await compared(directory('before'), directory('after'), directory('again'))).toEqual({
			code: 1,
			output: [
				`${traceFile} world 1:`,
				'- AutomationCoordinator:1 put "execution:<random 1>" {"state":"ready"}',
				'+ AutomationCoordinator:1 put "execution:<random 1>" {"state":"failed"}',
				summary(0, 1, 1),
			].join('\n'),
		});
	}));
