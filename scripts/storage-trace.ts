#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { attempt, main, refuse } from '@/tooling/runtime';

const random = new RegExp(
	[
		'-----BEGIN PGP [A-Z ]+-----.*?-----END PGP [A-Z ]+-----',
		'\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b',
		'\\b[0-9a-f]{40,}\\b',
		'\\bbeepboop-[\\w.-]+-[A-Za-z0-9]{6}\\b',
	].join('|'),
	'g',
);
const write = /^(\S+) \S+ ("(?:[^"\\]|\\.)*")/;

type Worlds = Map<string, string[]>;

const worlds = Effect.fn('worlds')(function*(directory: string) {
	if (!(yield* attempt(() => existsSync(directory)))) return yield* refuse(`${directory} does not exist`);
	const found: Worlds = new Map();
	for (const file of yield* attempt(() => readdirSync(directory))) {
		const text = yield* attempt(() => readFileSync(join(directory, file), 'utf8'));
		for (const block of text.split(/^## /m).filter(Boolean)) {
			const [title = '', ...lines] = block.split('\n').filter(Boolean);
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

function groupsOf(lines: readonly string[]): string[] {
	const shapes = new Map<string, Map<string, number>>();
	return lines.map(line => {
		const [, storage, key = ''] = write.exec(line) ?? [];
		const shape = `${storage} ${key.replaceAll(random, '<random>')}`;
		if (shape === `${storage} ${key}`) return shape;
		const keys = shapes.get(shape) ?? new Map<string, number>();
		const index = keys.get(key) ?? keys.size + 1;
		shapes.set(shape, keys.set(key, index));
		return `${shape} #${index}`;
	});
}

function grouped(lines: readonly string[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	const names = groupsOf(lines);
	lines.forEach((line, index) => {
		const name = names[index] ?? '';
		groups.set(name, [...(groups.get(name) ?? []), line]);
	});
	return groups;
}

function diff(left: readonly string[], right: readonly string[]): string[] {
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

function unstableGroups(left: readonly string[], right: readonly string[]): Set<string> {
	const old = grouped(left), current = grouped(right);
	return new Set(
		[...new Set([...old.keys(), ...current.keys()])].filter(group =>
			!same(canonical(old.get(group) ?? []), canonical(current.get(group) ?? []))
		),
	);
}

function changes(left: readonly string[], right: readonly string[], baseline: readonly string[] | undefined): string[] {
	if (!baseline || same(canonical(baseline), canonical(left))) return diff(canonical(left), canonical(right));
	const unstable = unstableGroups(left, baseline);
	const stable = (lines: readonly string[]) => {
		const names = groupsOf(lines);
		return lines.filter((_, index) => !unstable.has(names[index] ?? ''));
	};
	return diff(canonical(stable(left)), canonical(stable(right)));
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
		`${old.size} worlds, ${writes} writes compared, ${randomized} equal after renaming random tokens or keys that differ between baseline runs, ${differences} differ`,
	);
	if (differences) return yield* refuse(`${differences} worlds wrote different storage`);
}));
