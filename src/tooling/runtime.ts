import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Scope } from 'effect';
import { Data, Effect } from 'effect';
import type { z } from 'zod';

export class ToolFailure
	extends Data.TaggedError('ToolFailure')<{ readonly message: string; readonly cause?: unknown }>
{}

function message(cause: unknown): string {
	if (cause instanceof AggregateError) return [cause.message, ...cause.errors.map(message)].join('\n');
	return cause instanceof Error ? cause.message : String(cause);
}

export function refuse(text: string): Effect.Effect<never, ToolFailure> {
	return Effect.fail(new ToolFailure({ message: text }));
}

export function attempt<A>(run: () => A): Effect.Effect<A, ToolFailure> {
	return Effect.try({ try: run, catch: cause => new ToolFailure({ message: message(cause), cause }) });
}

export function attemptPromise<A>(run: () => Promise<A>): Effect.Effect<A, ToolFailure> {
	return Effect.tryPromise({ try: run, catch: cause => new ToolFailure({ message: message(cause), cause }) });
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): Effect.Effect<z.output<S>, ToolFailure> {
	return attempt(() => schema.parse(value));
}

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

export function run(args: string[], options: Command = {}): Effect.Effect<void, ToolFailure> {
	return attemptPromise(() =>
		Bun.spawn(args, {
			cwd: options.cwd,
			env: options.env,
			stdin: options.stdin === undefined ? 'inherit' : new Blob([options.stdin]),
			stdout: 'inherit',
			stderr: 'inherit',
		}).exited
	).pipe(Effect.flatMap(code => code === 0 ? Effect.void : refuse(`${args[0]} failed`)));
}

export function capture(args: string[], options: Command = {}): Effect.Effect<string, ToolFailure> {
	return attemptPromise(async () => {
		const child = Bun.spawn(args, {
			cwd: options.cwd,
			env: options.env,
			stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
			stdout: 'pipe',
			stderr: 'inherit',
		});
		const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return { stdout, code };
	}).pipe(
		Effect.flatMap(({ stdout, code }) =>
			code === 0 ? Effect.succeed(stdout) : refuse(`${args.join(' ')} failed: ${stdout}`.trim())
		),
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
