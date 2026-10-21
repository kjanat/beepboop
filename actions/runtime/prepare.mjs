import { spawnSync } from 'node:child_process';
import { appendFileSync, constants, existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
const context = JSON.parse(process.env.RELEASE_CONTEXT);
if (context.operation !== 'prepare' || !context.plan || !context.id) throw Error('Expected a preparation execution');
const root = realpathSync(process.env.GITHUB_WORKSPACE);
function safe(path) {
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
	for (const edit of context.plan.edits) {
		const path = safe(edit.path);
		if (readFileSync(path, 'utf8') !== edit.before) throw Error('Manifest changed since planning');
	}
	for (const edit of context.plan.edits) {
		writeFileSync(safe(edit.path), edit.after, { flag: constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW });
	}
	console.log(
		`Applied ${context.plan.edits.length} planned manifest edits. Run the repository generators and checks before submitting.`,
	);
} else if (process.env.PREPARATION_MODE === 'submit') {
	const result = spawnSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw Error('Cannot inspect prepared changes');
	const paths = new Set([...context.plan.edits.map(edit => edit.path), ...result.stdout.split('\0').filter(Boolean)]);
	const files = [...paths].map(path => ({ path, content: readFileSync(safe(path), 'utf8') }));
	const target = join(process.env.RUNNER_TEMP, `release-prepared-${context.id}.json`);
	writeFileSync(target, JSON.stringify({ executionId: context.id, files }), { mode: 0o600 });
	appendFileSync(process.env.GITHUB_ENV, `PREPARED_FILE=${target}\n`);
} else throw Error('Preparation mode must be apply or submit');
