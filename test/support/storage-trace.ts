import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '../..');
const worlds = new Map<string, number>();

export function testFile(): string | undefined {
	const match = /\/test\/flows\/[^:)\s]+\.test\.ts/.exec(new Error().stack ?? '');
	return match ? relative(root, join(root, match[0])) : undefined;
}

function encoded(root: unknown): string {
	const visited = new Map<object, number>();
	const path: object[] = [];
	const walk = (value: unknown): string => {
		if (value === undefined) return 'undefined';
		if (typeof value === 'bigint') return `${value}n`;
		if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
		if (typeof value === 'string' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
		if (typeof value !== 'object') throw new TypeError(`storage trace cannot encode a ${typeof value}`);
		const depth = path.indexOf(value);
		if (depth >= 0) return `<cycle ${path.length - depth}>`;
		const seen = visited.get(value);
		if (seen !== undefined) return `<shared ${seen}>`;
		visited.set(value, visited.size + 1);
		path.push(value);
		try {
			return body(value);
		} finally {
			path.pop();
		}
	};
	const body = (value: object): string => {
		if (value instanceof Date) return `Date(${value.getTime()})`;
		if (value instanceof RegExp) return `RegExp(${JSON.stringify(value.source)},${JSON.stringify(value.flags)})`;
		if (value instanceof Map) {
			return `Map{${[...value].map(([key, entry]) => `${walk(key)}=>${walk(entry)}`).join(',')}}`;
		}
		if (value instanceof Set) return `Set{${[...value].map(walk).join(',')}}`;
		if (ArrayBuffer.isView(value)) {
			return `${value.constructor.name}(${new Uint8Array(value.buffer, value.byteOffset, value.byteLength).join(',')})`;
		}
		if (value instanceof ArrayBuffer) return `ArrayBuffer(${new Uint8Array(value).join(',')})`;
		if (value instanceof SharedArrayBuffer) return `SharedArrayBuffer(${new Uint8Array(value).join(',')})`;
		if (value instanceof Boolean || value instanceof Number || value instanceof String) {
			return `Object(${walk(value.valueOf())})`;
		}
		if (value instanceof Error) return `${value.name}(${JSON.stringify(value.message)})`;
		if (Array.isArray(value)) return `[${Array.from(value, walk).join(',')}]`;
		const tag = Object.prototype.toString.call(value);
		if (tag !== '[object Object]') throw new TypeError(`storage trace cannot encode ${tag}`);
		return `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}:${walk(entry)}`).join(',')}}`;
	};
	return walk(root);
}

export class StorageTrace {
	private readonly lines: string[] = [];
	private finished = false;
	constructor(
		private readonly directory: string,
		private readonly file: string,
		private readonly world: number,
	) {}

	write(storage: string, operation: string, key: string, value?: unknown): void {
		if (this.finished) return;
		const line = `${storage} ${operation} ${JSON.stringify(key)}`;
		this.lines.push(value === undefined ? line : `${line} ${encoded(value)}`);
	}

	finish(): void {
		if (this.finished) return;
		this.finished = true;
		mkdirSync(this.directory, { recursive: true });
		appendFileSync(
			join(this.directory, `${this.file.replaceAll('/', '-')}.trace`),
			`## world ${this.world}\n${this.lines.map(line => `${line}\n`).join('')}`,
		);
	}
}

export function startTrace(file: string | undefined): StorageTrace | undefined {
	const directory = process.env.BEEPBOOP_STORAGE_TRACE;
	if (!directory || !file) return undefined;
	const key = join(directory, file);
	const world = (worlds.get(key) ?? 0) + 1;
	worlds.set(key, world);
	return new StorageTrace(directory, file, world);
}
