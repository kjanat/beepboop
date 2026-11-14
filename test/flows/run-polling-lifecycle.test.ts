import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

// Browser modules use their own DOM project instead of Worker's global Element types.
const polling: {
	pollChanges(options: {
		rendered: number;
		load(signal: AbortSignal): Promise<number>;
		changed(): void;
	}): () => void;
} = await import(new URL('../../src/ui/browser/polling.ts', import.meta.url).href);

test('cancelled polling retains its slot until an uncooperative load settles and ignores late snapshots', async () => {
	const window = new Window();
	let now = 0, next = 0;
	const timers = new Map<number, { at: number; run(): void }>();
	const originals = ['document', 'window', 'setTimeout', 'clearTimeout'].map(name =>
		[name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
	);
	Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true });
	Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
	Object.defineProperty(globalThis, 'setTimeout', {
		value: (run: () => void, delay = 0) => {
			const id = ++next;
			timers.set(id, { at: now + delay, run });
			return id;
		},
		configurable: true,
	});
	Object.defineProperty(globalThis, 'clearTimeout', {
		value: (id: number) => timers.delete(id),
		configurable: true,
	});
	const advance = (milliseconds: number) => {
		const until = now + milliseconds;
		for (;;) {
			const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			const [id, timer] = due;
			timers.delete(id);
			now = timer.at;
			timer.run();
		}
		now = until;
	};
	const visibility = (hidden: boolean) => {
		Object.defineProperty(window.document, 'hidden', { value: hidden, configurable: true });
		window.document.dispatchEvent(new window.Event('visibilitychange'));
	};
	const transition = (type: 'pagehide' | 'pageshow') => window.dispatchEvent(new window.Event(type));
	const requests: { signal: AbortSignal; resolve(value: number): void }[] = [];
	let changes = 0;
	let stop = () => {};
	try {
		visibility(false);
		stop = polling.pollChanges({
			rendered: 100,
			load: signal =>
				new Promise(resolve => {
					requests.push({ signal, resolve });
				}),
			changed: () => {
				changes++;
			},
		});
		advance(5000);
		expect(requests).toHaveLength(1);
		const first = requests[0];
		if (!first) throw new Error('Missing first request');
		visibility(true);
		expect(first.signal.aborted).toBe(true);
		visibility(false);
		transition('pagehide');
		transition('pageshow');
		advance(60_000);
		expect(requests).toHaveLength(1);
		first.resolve(101);
		await Promise.resolve();
		expect(changes).toBe(0);
		advance(4999);
		expect(requests).toHaveLength(1);
		advance(1);
		expect(requests).toHaveLength(2);
		const second = requests[1];
		if (!second) throw new Error('Missing second request');
		transition('pagehide');
		expect(second.signal.aborted).toBe(true);
		second.resolve(200);
		await Promise.resolve();
		advance(60_000);
		expect(requests).toHaveLength(2);
		expect(changes).toBe(0);
		transition('pageshow');
		advance(5000);
		expect(requests).toHaveLength(3);
		const third = requests[2];
		if (!third) throw new Error('Missing third request');
		advance(20_000);
		expect(third.signal.aborted).toBe(true);
		advance(60_000);
		expect(requests).toHaveLength(3);
		third.resolve(300);
		await Promise.resolve();
		expect(changes).toBe(0);
		advance(5000);
		expect(requests).toHaveLength(4);
		const fourth = requests[3];
		if (!fourth) throw new Error('Missing fourth request');
		fourth.resolve(101);
		await Promise.resolve();
		expect(changes).toBe(1);
		advance(60_000);
		expect(requests).toHaveLength(4);
	} finally {
		stop();
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
		await window.happyDOM.close();
	}
});
