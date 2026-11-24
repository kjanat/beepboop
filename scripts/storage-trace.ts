#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { attempt, main, refuse } from '@/tooling/runtime';

const random = new RegExp(
	[
		'-----BEGIN PGP [A-Z ]+-----.*?-----END PGP [A-Z ]+-----',
		'\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b',
		'(?<![0-9a-f])(?:[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}){2}(?![0-9a-f])',
		'\\bbeepboop-[\\w.-]+-[A-Za-z0-9]{6}\\b',
	].join('|'),
	'g',
);

type Worlds = Map<string, string[]>;

const operation =
	/^\S+ (?:put|setAlarm) "(?:[^"\\]|\\.)*" \S.*$|^\S+ (?:delete|deleteAll|deleteAlarm|rollback) "(?:[^"\\]|\\.)*"$/;

function parse(file: string, text: string): [string, string[]][] | string {
	if (!text.startsWith('## world ') || !text.endsWith('\n')) return `${file} is not a complete storage trace`;
	const blocks: [string, string[]][] = [];
	for (const [index, line] of text.slice(0, -1).split('\n').entries()) {
		if (/^## world [1-9][0-9]*$/.test(line)) blocks.push([line.slice(3), []]);
		else if (!operation.test(line)) return `${file}:${index + 1} is not a storage trace line: ${line}`;
		else blocks.at(-1)?.[1].push(line);
	}
	return blocks;
}

const worlds = Effect.fn('worlds')(function*(directory: string) {
	if (!(yield* attempt(() => existsSync(directory)))) return yield* refuse(`${directory} does not exist`);
	const found: Worlds = new Map();
	for (const file of yield* attempt(() => readdirSync(directory))) {
		const text = yield* attempt(() => readFileSync(join(directory, file), 'utf8'));
		const blocks = parse(file, text);
		if (typeof blocks === 'string') return yield* refuse(blocks);
		for (const [title, lines] of blocks) {
			const world = `${file} ${title}`;
			if (found.has(world)) return yield* refuse(`${directory} holds ${world} twice; trace into an empty directory`);
			found.set(world, lines);
		}
	}
	if (!found.size) return yield* refuse(`${directory} holds no traces; set BEEPBOOP_STORAGE_TRACE for the test run`);
	return found;
});

function renamer(): (text: string) => string {
	const names = new Map<string, string>();
	return text =>
		text.replaceAll(random, token => {
			const name = names.get(token) ?? `<random ${names.size + 1}>`;
			names.set(token, name);
			return name;
		});
}

function canonical(lines: readonly string[]): string[] {
	return lines.map(renamer());
}

function same(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((line, index) => line === right[index]);
}

const alignable = 4_000_000;

function align(left: readonly string[], right: readonly string[]): string[] {
	if ((left.length + 1) * (right.length + 1) > alignable) {
		return [
			`~ ${left.length} before lines and ${right.length} after lines are too many to align`,
			...left.map(line => `- ${line}`),
			...right.map(line => `+ ${line}`),
		];
	}
	const width = right.length + 1;
	const common = new Int32Array((left.length + 1) * width);
	const at = (i: number, j: number) => common[i * width + j] ?? 0;
	for (let i = left.length - 1; i >= 0; i--) {
		for (let j = right.length - 1; j >= 0; j--) {
			common[i * width + j] = left[i] === right[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
		}
	}
	const lines: string[] = [];
	let i = 0, j = 0;
	while (i < left.length || j < right.length) {
		if (i < left.length && j < right.length && left[i] === right[j]) {
			i++;
			j++;
		} else if (j >= right.length || (i < left.length && at(i + 1, j) >= at(i, j + 1))) {
			lines.push(`- ${left[i++]}`);
		} else lines.push(`+ ${right[j++]}`);
	}
	return lines;
}

function diff(left: readonly string[], right: readonly string[]): string[] {
	let head = 0;
	while (head < left.length && head < right.length && left[head] === right[head]) head++;
	let tail = 0;
	while (
		tail < left.length - head && tail < right.length - head
		&& left[left.length - 1 - tail] === right[right.length - 1 - tail]
	) tail++;
	return align(left.slice(head, left.length - tail), right.slice(head, right.length - tail));
}

function changes(left: readonly string[], right: readonly string[], baseline: readonly string[] | undefined): string[] {
	const written = canonical(right);
	if (baseline && same(canonical(baseline), written)) return [];
	return diff(canonical(left), written);
}

await main(Effect.gen(function*() {
	const [before, after, again] = process.argv.slice(2);
	if (!before || !after) {
		return yield* refuse(
			'usage: scripts/storage-trace.ts <before-directory> <after-directory> [<second-before-directory>]',
		);
	}
	const old = yield* worlds(before), current = yield* worlds(after);
	const repeated: Worlds = again ? yield* worlds(again) : new Map();
	let writes = 0, randomized = 0, differences = 0;
	for (const world of [...new Set([...old.keys(), ...current.keys()])].sort()) {
		const left = old.get(world), right = current.get(world);
		if (left === undefined || right === undefined) {
			console.log(`${world}: only in ${left === undefined ? after : before}`);
			differences++;
			continue;
		}
		writes += left.length;
		if (same(left, right)) continue;
		const lines = changes(left, right, repeated.get(world));
		if (!lines.length) {
			randomized++;
			continue;
		}
		console.log(`${world}:`);
		for (const line of lines) console.log(line);
		differences++;
	}
	console.log(
		`${old.size} worlds, ${writes} writes compared, ${randomized} equal after renaming random tokens or equal to the second baseline run, ${differences} differ`,
	);
	if (differences) return yield* refuse(`${differences} worlds wrote different storage`);
}));
