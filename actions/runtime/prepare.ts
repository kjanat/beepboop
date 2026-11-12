import { spawnSync } from 'node:child_process';
import {
	appendFileSync,
	closeSync,
	constants,
	existsSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ActionFailure, Invalid } from '@root/actions/runtime/protocol.ts';
import { attempt, refuse, required } from '@root/actions/runtime/protocol.ts';
import { Effect, Result } from 'effect';
import { checkoutAt } from '@/git.ts';
import { array, record, string, strings, text } from '@/model.ts';
import { hasPathSegment } from '@/relative-path.ts';

interface PlannedEdit {
	path: string;
	before: string;
	after: string;
}

interface Preparation {
	id: string;
	sourceSha: unknown;
	edits: PlannedEdit[];
	lockfiles: string[];
}

function plannedEdit(value: unknown): Result.Result<PlannedEdit, Invalid> {
	return Result.gen(function*() {
		const edit = yield* record(value);
		return { path: yield* text(edit.path), before: yield* string(edit.before), after: yield* string(edit.after) };
	});
}

function preparation(source: string): Result.Result<Preparation, Invalid> {
	return Result.gen(function*() {
		const input = yield* record(yield* attempt((): unknown => JSON.parse(source)));
		const context = typeof input.contextFile === 'string'
			? yield* record(yield* attempt((): unknown => JSON.parse(readFileSync(input.contextFile as string, 'utf8'))))
			: input;
		if (context.operation !== 'prepare' || !context.plan || !context.id) {
			return yield* refuse('Expected a preparation execution');
		}
		const plan = yield* record(context.plan);
		return {
			id: yield* text(context.id),
			sourceSha: context.sourceSha,
			edits: yield* Result.all((yield* array(plan.edits)).map(plannedEdit)),
			lockfiles: plan.lockfiles === undefined ? [] : yield* strings(plan.lockfiles),
		};
	});
}

function safe(root: string, path: string): Result.Result<string, ActionFailure> {
	if (isAbsolute(path) || hasPathSegment(path, ['..', '.git'])) {
		return refuse('Unsafe release edit path');
	}
	return attempt(() => {
		const target = resolve(root, path), parent = realpathSync(dirname(target));
		const part = relative(root, parent);
		return {
			target,
			escapes: part === '..' || part.startsWith('../') || isAbsolute(part)
				|| existsSync(target) && lstatSync(target).isSymbolicLink(),
		};
	}).pipe(
		Result.flatMap(({ target, escapes }) =>
			escapes ? refuse('Release edit escapes the checkout') : Result.succeed(target)
		),
	);
}

function overwrite(target: string, content: string): Result.Result<void, ActionFailure> {
	return attempt(() => {
		const descriptor = openSync(target, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
		try {
			writeFileSync(descriptor, content);
		} finally {
			closeSync(descriptor);
		}
	});
}

function prepare(environment: NodeJS.ProcessEnv): Result.Result<void, Invalid> {
	return Result.gen(function*() {
		const { id, sourceSha, edits, lockfiles } = yield* preparation(yield* required(environment, 'RELEASE_CONTEXT'));
		const workspace = yield* required(environment, 'GITHUB_WORKSPACE');
		const root = yield* attempt(() => realpathSync(workspace));
		if (!checkoutAt(root, sourceSha)) return yield* refuse('Checkout must match the planned source commit');
		if (environment.PREPARATION_MODE === 'apply') {
			for (const edit of edits) {
				const target = yield* safe(root, edit.path);
				if ((yield* attempt(() => readFileSync(target, 'utf8'))) !== edit.before) {
					return yield* refuse('Manifest changed since planning');
				}
			}
			for (const edit of edits) yield* overwrite(yield* safe(root, edit.path), edit.after);
			console.log(
				`Applied ${edits.length} planned manifest edits. Run the repository generators and checks before submitting.`,
			);
		} else if (environment.PREPARATION_MODE === 'submit') {
			const result = spawnSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8' });
			if (result.status !== 0) return yield* refuse('Cannot inspect prepared changes');
			const paths = new Set([
				...edits.map(edit => edit.path),
				...lockfiles,
				...result.stdout.split('\0').filter(Boolean),
			]);
			const files: { path: string; content: string }[] = [];
			for (const path of paths) {
				const target = yield* safe(root, path);
				files.push({ path, content: yield* attempt(() => readFileSync(target, 'utf8')) });
			}
			const target = join(yield* required(environment, 'RUNNER_TEMP'), `release-prepared-${id}.json`);
			const variables = yield* required(environment, 'GITHUB_ENV');
			yield* attempt(() => writeFileSync(target, JSON.stringify({ executionId: id, files }), { mode: 0o600 }));
			yield* attempt(() => appendFileSync(variables, `PREPARED_FILE=${target}\n`));
		} else return yield* refuse('Preparation mode must be apply or submit');
	});
}

await Effect.runPromise(Effect.fromResult(prepare(process.env)));
