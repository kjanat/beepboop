#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [before, after, again] = process.argv.slice(2);
if (!before || !after) {
	console.error('usage: scripts/storage-trace.ts <before-directory> <after-directory> [<second-before-directory>]');
	process.exit(2);
}

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

function worlds(directory: string): Worlds {
	if (!existsSync(directory)) throw new Error(`${directory} does not exist`);
	const found: Worlds = new Map();
	for (const file of readdirSync(directory)) {
		for (const block of readFileSync(join(directory, file), 'utf8').split(/^## /m).filter(Boolean)) {
			const [title = '', ...lines] = block.split('\n').filter(Boolean);
			const world = `${file} ${title}`;
			if (found.has(world)) throw new Error(`${directory} holds ${world} twice; trace into an empty directory`);
			found.set(world, lines);
		}
	}
	if (!found.size) throw new Error(`${directory} holds no traces; set BEEPBOOP_STORAGE_TRACE for the test run`);
	return found;
}

function traces(before: string, after: string): [Worlds, Worlds, Worlds] {
	try {
		return [worlds(before), worlds(after), again ? worlds(again) : new Map()];
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(2);
	}
}

function canonical(lines: readonly string[]): string[] {
	const names = new Map<string, string>();
	return lines.map(line =>
		line.replaceAll(random, token => {
			const name = names.get(token) ?? `<random ${names.size + 1}>`;
			names.set(token, name);
			return name;
		})
	);
}

function same(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((line, index) => line === right[index]);
}

function groupOf(line: string): string {
	const [, storage, key] = write.exec(line) ?? [];
	return `${storage} ${key}`;
}

function grouped(lines: readonly string[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const line of lines) groups.set(groupOf(line), [...(groups.get(groupOf(line)) ?? []), line]);
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

function changedGroups(left: readonly string[], right: readonly string[]): Set<string> {
	const old = grouped(left), current = grouped(right);
	return new Set(
		[...new Set([...old.keys(), ...current.keys()])].filter(group =>
			!same(old.get(group) ?? [], current.get(group) ?? [])
		),
	);
}

function changes(world: string, left: readonly string[], right: readonly string[]): string[] {
	const old = canonical(left), current = canonical(right);
	const baseline = repeated.get(world);
	if (!baseline || same(canonical(baseline), old)) return diff(old, current);
	const unstable = changedGroups(old, canonical(baseline));
	const kept = (line: string) => !unstable.has(groupOf(line));
	return diff(old.filter(kept), current.filter(kept));
}

const [old, current, repeated] = traces(before, after);
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
	const lines = changes(world, left, right);
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
process.exit(differences ? 1 : 0);
