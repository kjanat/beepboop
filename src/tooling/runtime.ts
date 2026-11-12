import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Scope } from 'effect';
import { Data, Effect } from 'effect';
import { parseWith } from '@/decode';
import { failWith } from '@/refusal';
import { terminate } from '@/runtime/process';

export class ToolFailure
	extends Data.TaggedError('ToolFailure')<{ readonly message: string; readonly cause?: unknown }>
{}

function message(cause: unknown): string {
	if (cause instanceof AggregateError) return [cause.message, ...cause.errors.map(message)].join('\n');
	return cause instanceof Error ? cause.message : String(cause);
}

function toolFailure(cause: unknown): ToolFailure {
	return new ToolFailure({ message: message(cause), cause });
}

export const refuse = failWith(text => new ToolFailure({ message: text }));

export function attempt<A>(run: () => A): Effect.Effect<A, ToolFailure> {
	return Effect.try({ try: run, catch: toolFailure });
}

export function attemptPromise<A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, ToolFailure> {
	return Effect.tryPromise({ try: run, catch: toolFailure });
}

export const parse = parseWith(toolFailure);

export function readJson(path: string): Effect.Effect<unknown, ToolFailure> {
	return attemptPromise((): Promise<unknown> => Bun.file(path).json());
}

export function readText(path: string): Effect.Effect<string | undefined, ToolFailure> {
	return attemptPromise(async () => {
		const file = Bun.file(path);
		return await file.exists() ? file.text() : undefined;
	});
}

export interface Command {
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly stdin?: string;
}

function spawn(args: string[], options: Command, stdin: 'inherit' | 'ignore', stdout: 'inherit' | 'pipe') {
	return Bun.spawn(args, {
		cwd: options.cwd,
		env: options.env,
		stdin: options.stdin === undefined ? stdin : new Blob([options.stdin]),
		stdout,
		stderr: 'inherit',
	});
}

function command<A>(
	args: string[],
	options: Command,
	stdin: 'inherit' | 'ignore',
	stdout: 'inherit' | 'pipe',
	read: (child: ReturnType<typeof spawn>) => Promise<A>,
): Effect.Effect<A, ToolFailure> {
	return Effect.acquireUseRelease(
		attempt(() => spawn(args, options, stdin, stdout)),
		child => attemptPromise(async () => {
			const [value, code] = await Promise.all([read(child), child.exited]);
			if (code !== 0) throw new Error(`${args[0]} failed (exit ${code})`);
			return value;
		}),
		terminate,
	);
}

export function run(args: string[], options: Command = {}): Effect.Effect<void, ToolFailure> {
	return command(args, options, 'inherit', 'inherit', () => Promise.resolve());
}

export function capture(args: string[], options: Command = {}): Effect.Effect<string, ToolFailure> {
	return command(args, options, 'ignore', 'pipe', child => new Response(child.stdout).text());
}

export function checkArguments(allowPositionals: boolean) {
	return attempt(() =>
		parseArgs({ args: Bun.argv.slice(2), options: { check: { type: 'boolean' } }, allowPositionals, strict: true })
	);
}

export function format(path: string, source: string): Effect.Effect<string, ToolFailure> {
	return capture(['bunx', 'kfmt', '--stdin', path], { stdin: source });
}

export function temporaryDirectory(prefix: string): Effect.Effect<string, ToolFailure, Scope.Scope> {
	return Effect.acquireRelease(
		attemptPromise(() => mkdtemp(join(tmpdir(), prefix))),
		directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
	);
}

export function main<E>(program: Effect.Effect<void, E>): Promise<void> {
	return Effect.runPromise(program);
}
