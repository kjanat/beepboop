import { expect, spyOn, test } from 'bun:test';
import { Cause, Effect, Exit, Result } from 'effect';
import { RE2JS } from 're2js';
import { applyVersionFiles } from '@/automation/editors';
import { versionFileSchema } from '@/domain/version-files.ts';
import { decodeSync, safeDecode } from '@/kernel/schema/structs.ts';

const literal = { path: 'README.md', format: 'text', prefix: 'version="', suffix: '"' };
const pattern = { path: 'README.md', format: 'text', pattern: 'version="(?<version>[^"\\n]+)"' };

test('adversarial version patterns finish within an externally enforced deadline', () => {
	const child = Bun.spawnSync([
		process.execPath,
		'-e',
		`
		import { textVersionPattern } from './packages/domain/src/version-files.ts';
		import { Result } from 'effect';
		for (const expression of ['(?<version>(a+)+)$', '(?<version>(a|aa)+)$']) {
			const compiled = textVersionPattern(expression);
			if (Result.isFailure(compiled)) throw new Error('Expected supported pattern');
			if (compiled.success.matcher('a'.repeat(100_000) + '!').find()) throw new Error('Unexpected match');
		}
	`,
	], { cwd: new URL('../..', import.meta.url).pathname, timeout: 5000, killSignal: 'SIGKILL' });
	expect(child.exitedDueToTimeout).not.toBe(true);
	expect({ code: child.exitCode, error: child.stderr.toString() }).toEqual({ code: 0, error: '' });
});

test('pattern replacement preserves UTF-16 offsets around astral Unicode characters', async () => {
	const source = '😀 version="1.0.0" 🦀\n𐐀 version="1.0.0"';
	const { result, content } = await update(source, [pattern]);
	expect(Result.isSuccess(result)).toBe(true);
	expect(content).toBe('😀 version="1.1.0" 🦀\n𐐀 version="1.1.0"');
});

async function update(original: string, rules: unknown[], current = original) {
	const files = { 'README.md': current };
	const result = await Effect.runPromise(
		applyVersionFiles(
			{
				repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files: { 'README.md': original },
				paths: ['README.md'],
			},
			files,
			rules.map(rule => decodeSync(versionFileSchema, rule)),
			{ release: '1.1.0' },
		).pipe(Effect.result),
	);
	return { result, content: files['README.md'] };
}

test('one literal text rule updates every selected version and preserves surrounding text', async () => {
	const original = 'Current version="1.0.0".\r\nInstall version="1.0.0"; dependency="9.0.0".\r\n';
	const { result, content } = await update(original, [literal]);
	expect(Result.isSuccess(result)).toBe(true);
	expect(content).toBe('Current version="1.1.0".\r\nInstall version="1.1.0"; dependency="9.0.0".\r\n');
});

test('a pattern updates version captures across varied README formatting', async () => {
	const original = [
		'```toml',
		'fujo = "1.0.0"',
		"fujo     = '1.0.0' # aligned example",
		'fujo={ default-features = false, version = "1.0.0" }',
		'fujo = { version = "1.0.0", default-features = false }',
		'other = "7.0.0"',
		'```',
	].join('\n');
	const rule = {
		path: 'README.md',
		format: 'text',
		pattern: '^fujo[ \\t]*=[ \\t]*(?:\\{[^\\n}]*?\\bversion[ \\t]*=[ \\t]*)?["\'](?<version>[^"\'\\n]+)["\']',
	};
	const { result, content } = await update(original, [rule]);
	expect(Result.isSuccess(result)).toBe(true);
	expect(content).toBe(original.replaceAll('1.0.0', '1.1.0'));
});

test('patterns select repeated versions in plain prose without dependency syntax', async () => {
	const original = 'Current release: v1.0.0\nDownload tool-v1.0.0.tar.gz\nDependency 8.0.0\n';
	const { result, content } = await update(original, [{
		path: 'README.md',
		format: 'text',
		pattern: '(?:release: v|tool-v)(?<version>\\d+\\.\\d+\\.\\d+)',
	}]);
	expect(Result.isSuccess(result)).toBe(true);
	expect(content).toBe('Current release: v1.1.0\nDownload tool-v1.1.0.tar.gz\nDependency 8.0.0\n');
});

for (const rule of [literal, pattern]) {
	test(`${'pattern' in rule ? 'pattern' : 'literal'} rules reject conflicts in later occurrences`, async () => {
		const original = 'version="1.0.0"\nversion="1.0.0"\n';
		const current = 'version="1.1.0"\nversion="2.0.0"\n';
		const { result, content } = await update(original, [rule], current);
		expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
		expect(content).toBe(current);
	});

	test(`${'pattern' in rule ? 'pattern' : 'literal'} rules compose old and already updated occurrences`, async () => {
		const original = 'version="1.0.0"\nversion="1.0.0"\n';
		const { result, content } = await update(original, [rule], 'version="1.0.0"\nversion="1.1.0"\n');
		expect(Result.isSuccess(result)).toBe(true);
		expect(content).toBe('version="1.1.0"\nversion="1.1.0"\n');
	});

	test(`${'pattern' in rule ? 'pattern' : 'literal'} rules reject changed occurrence counts`, async () => {
		for (const current of ['version="1.0.0"\n', 'version="1.0.0"\nversion="1.0.0"\nversion="1.0.0"\n']) {
			const { result, content } = await update('version="1.0.0"\nversion="1.0.0"\n', [rule], current);
			expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
			expect(content).toBe(current);
		}
	});

	test(`${'pattern' in rule ? 'pattern' : 'literal'} rules fail when no occurrence matches`, async () => {
		const original = 'No version here.\n';
		const { result, content } = await update(original, [rule]);
		expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
		expect(content).toBe(original);
	});

	test(`${'pattern' in rule ? 'pattern' : 'literal'} replacements treat dollar expressions literally`, async () => {
		const { result, content } = await update('version="1.0.0"\nversion="1.0.0"', [{
			...rule,
			template: '{version}-$&-$$-$1',
		}]);
		expect(Result.isSuccess(result)).toBe(true);
		expect(content).toBe('version="1.1.0-$&-$$-$1"\nversion="1.1.0-$&-$$-$1"');
	});

	test(`${'pattern' in rule ? 'pattern' : 'literal'} rules reject duplicate selectors`, async () => {
		const { result } = await update('version="1.0.0"', [rule, rule]);
		expect(Result.isFailure(result) && result.failure.message).toContain('Duplicate version field');
	});
}

test('literal rules reject a missing suffix in any occurrence without changing the file', async () => {
	for (const original of ['version="1.0.0"\nversion="unfinished', 'version="1.0.0\nversion="1.0.0"\n']) {
		const { result, content } = await update(original, [literal]);
		expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
		expect(content).toBe(original);
	}
});

test('patterns reject missing, empty, unmatched and overlapping version captures', async () => {
	for (
		const [source, expression] of [
			['1.0.0', '1\\.0\\.0'],
			['version=', 'version=(?<version>)'],
			['other', '(?<version>1\\.0\\.0)?other'],
		] as const
	) {
		const { result, content } = await update(source, [{ path: 'README.md', format: 'text', pattern: expression }]);
		expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
		expect(content).toBe(source);
	}
});

test('configuration rejects invalid regex syntax and mixed text selectors', () => {
	for (const rule of [
		{ ...pattern, pattern: '(' },
		{ ...pattern, pattern: '' },
		{ ...pattern, pattern: '(?=(?<version>aa))' },
		{ ...pattern, pattern: '(?<version>a)\\1' },
		{ ...pattern, pattern: 'a'.repeat(4097) },
		{ ...literal, pattern: pattern.pattern },
	]) expect(safeDecode(versionFileSchema, rule).success).toBe(false);
});

function patternEdit(expression: string) {
	const original = 'version="1.0.0"\nversion="1.0.0"\n';
	const files = { 'README.md': original };
	const effect = applyVersionFiles(
		{
			repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: { ...files },
			paths: ['README.md'],
		},
		files,
		[{ path: 'README.md', format: 'text', pattern: expression, template: '{version}' }],
		{ release: '1.1.0' },
	);
	return { effect, files, original };
}

test('invalid regex syntax remains a recoverable failure when applying a rule directly', () => {
	const { effect, files, original } = patternEdit('(');
	const result = Effect.runSync(Effect.result(effect));
	expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
	expect(Result.isFailure(result) && result.failure.message).toBe('Invalid text version pattern');
	expect(files['README.md']).toBe(original);
});

test('unexpected scanner exceptions remain defects and leave the file unchanged', () => {
	for (const bug of [new Error('scanner defect'), new SyntaxError('unexpected scanner syntax failure')]) {
		const { effect, files, original } = patternEdit(pattern.pattern);
		const scanner = spyOn(RE2JS.prototype, 'matcher').mockImplementation(() => {
			throw bug;
		});
		let exit: Exit.Exit<void, unknown>;
		try {
			exit = Effect.runSyncExit(effect);
		} finally {
			scanner.mockRestore();
		}
		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(bug);
		expect(files['README.md']).toBe(original);
	}
});
