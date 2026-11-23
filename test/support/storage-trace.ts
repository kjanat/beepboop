import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '../..');
const worlds = new Map<string, number>();
let active: { directory: string; file: string; world: number; lines: string[] } | undefined;

export function testFile(): string | undefined {
	const match = /\/test\/flows\/[^:)\s]+\.test\.ts/.exec(new Error().stack ?? '');
	return match ? relative(root, join(root, match[0])) : undefined;
}

export function startTrace(file: string | undefined): void {
	finishTrace();
	const directory = process.env.BEEPBOOP_STORAGE_TRACE;
	if (!directory || !file) return;
	const key = join(directory, file);
	const world = (worlds.get(key) ?? 0) + 1;
	worlds.set(key, world);
	active = { directory, file, world, lines: [] };
}

function encoded(value: unknown, ancestors: readonly object[] = []): string {
	if (value === undefined) return 'undefined';
	if (typeof value === 'bigint') return `${value}n`;
	if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
	if (typeof value !== 'object' || value === null) return JSON.stringify(value);
	const depth = ancestors.indexOf(value);
	if (depth >= 0) return `<cycle ${ancestors.length - depth}>`;
	const inner = (entry: unknown) => encoded(entry, [...ancestors, value]);
	if (value instanceof Date) return `Date(${value.getTime()})`;
	if (value instanceof Map) {
		return `Map{${[...value].map(([key, entry]) => `${inner(key)}=>${inner(entry)}`).join(',')}}`;
	}
	if (value instanceof Set) return `Set{${[...value].map(inner).join(',')}}`;
	if (ArrayBuffer.isView(value)) {
		return `${value.constructor.name}(${new Uint8Array(value.buffer, value.byteOffset, value.byteLength).join(',')})`;
	}
	if (value instanceof ArrayBuffer) return `ArrayBuffer(${new Uint8Array(value).join(',')})`;
	if (Array.isArray(value)) return `[${Array.from(value, entry => inner(entry)).join(',')}]`;
	return `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}:${inner(entry)}`).join(',')}}`;
}

export function traceWrite(storage: string, operation: string, key: string, value?: unknown): void {
	if (!active) return;
	const line = `${storage} ${operation} ${JSON.stringify(key)}`;
	active.lines.push(value === undefined ? line : `${line} ${encoded(value)}`);
}

export function finishTrace(): void {
	if (!active) return;
	mkdirSync(active.directory, { recursive: true });
	appendFileSync(
		join(active.directory, `${active.file.replaceAll('/', '-')}.trace`),
		`## world ${active.world}\n${active.lines.map(line => `${line}\n`).join('')}`,
	);
	active = undefined;
}
