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
import { array, record, string, text } from '@/model.ts';

interface PlannedEdit {
	path: string;
	before: string;
	after: string;
}

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw Error(`${name} is required`);
	return value;
}

const context = record(JSON.parse(required('RELEASE_CONTEXT')));
if (context.operation !== 'prepare' || !context.plan || !context.id) throw Error('Expected a preparation execution');
const id = text(context.id);
const plan = record(context.plan);
const edits: PlannedEdit[] = array(plan.edits).map(value => {
	const edit = record(value);
	return { path: text(edit.path), before: string(edit.before), after: string(edit.after) };
});
const lockfiles = plan.lockfiles === undefined ? [] : array(plan.lockfiles).map(text);
const root = realpathSync(required('GITHUB_WORKSPACE'));

function safe(path: string): string {
	if (isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.git')) {
		throw Error('Unsafe release edit path');
	}
	const target = resolve(root, path), parent = realpathSync(dirname(target));
	const part = relative(root, parent);
	if (
		part === '..' || part.startsWith('../') || isAbsolute(part)
		|| existsSync(target) && lstatSync(target).isSymbolicLink()
	) throw Error('Release edit escapes the checkout');
	return target;
}

const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (revision.status !== 0 || revision.stdout.trim() !== context.sourceSha) {
	throw Error('Checkout must match the planned source commit');
}
if (process.env.PREPARATION_MODE === 'apply') {
	for (const edit of edits) {
		if (readFileSync(safe(edit.path), 'utf8') !== edit.before) throw Error('Manifest changed since planning');
	}
	for (const edit of edits) {
		const descriptor = openSync(safe(edit.path), constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
		try {
			writeFileSync(descriptor, edit.after);
		} finally {
			closeSync(descriptor);
		}
	}
	console.log(
		`Applied ${edits.length} planned manifest edits. Run the repository generators and checks before submitting.`,
	);
} else if (process.env.PREPARATION_MODE === 'submit') {
	const result = spawnSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw Error('Cannot inspect prepared changes');
	const paths = new Set([...edits.map(edit => edit.path), ...lockfiles, ...result.stdout.split('\0').filter(Boolean)]);
	const files = [...paths].map(path => ({ path, content: readFileSync(safe(path), 'utf8') }));
	const target = join(required('RUNNER_TEMP'), `release-prepared-${id}.json`);
	writeFileSync(target, JSON.stringify({ executionId: id, files }), { mode: 0o600 });
	appendFileSync(required('GITHUB_ENV'), `PREPARED_FILE=${target}\n`);
} else throw Error('Preparation mode must be apply or submit');
