import { beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eachDirectory } from '@root/test/support/directories.ts';
import { cratePublishCommands } from '@/automation/setup-defaults';

let stub = '';
eachDirectory('crate-publish-', created => {
	stub = created;
});
beforeEach(() => {
	const tool = (name: string, body: string) => {
		writeFileSync(join(stub, name), `#!/usr/bin/env bash\n${body}`);
		chmodSync(join(stub, name), 0o755);
	};
	tool(
		'cargo',
		String.raw`if [ "$1" = metadata ]; then
  echo '{"packages":[{"name":"core","version":"1.0.1"},{"name":"cli","version":"1.0.1"}]}'
  exit 0
fi
crate="$4"
echo "publish $crate" >> "$STUB/log"
outcome="$(head -n 1 "$STUB/publish-$crate")"
sed -i 1d "$STUB/publish-$crate"
case "$outcome" in
  ok) touch "$STUB/published-$crate"; echo "Uploaded $crate" ;;
  late) touch "$STUB/published-$crate"; echo "error: timed out waiting for $crate"; exit 101 ;;
  429) echo "error: the remote server responded with an error (status 429 Too Many Requests): Please try again after Mon, 09 Nov 2026 10:00:00 GMT"; exit 101 ;;
  *) echo "error: could not compile $crate"; exit 101 ;;
esac
`,
	);
	tool(
		'curl',
		String.raw`url="${'$'}{@: -1}"
crate="$(basename "$(dirname "$url")")"
if [ -e "$STUB/published-$crate" ]; then echo 200; else echo 404; fi
`,
	);
	tool('sleep', 'echo "sleep $1" >> "$STUB/log"\n');
	tool('date', 'case "$*" in *-d*) echo 1000 ;; *) echo 900 ;; esac\n');
});

function publish(outcomes: Record<string, string[]>, published: string[] = []) {
	for (const [crate, lines] of Object.entries(outcomes)) {
		writeFileSync(join(stub, `publish-${crate}`), lines.join('\n'));
	}
	for (const crate of published) writeFileSync(join(stub, `published-${crate}`), '');
	const result = Bun.spawnSync([
		'bash',
		'--noprofile',
		'--norc',
		'-eo',
		'pipefail',
		'-c',
		cratePublishCommands(['core', 'cli']),
	], {
		env: {
			PATH: `${stub}:${process.env.PATH}`,
			STUB: stub,
			GITHUB_REPOSITORY: 'octo/lint',
			GITHUB_OUTPUT: join(stub, 'output'),
		},
	});
	const lines = (file: string) =>
		existsSync(join(stub, file)) ? readFileSync(join(stub, file), 'utf8').trim().split('\n') : [];
	const log = lines('log'), outputs = lines('output');
	rmSync(join(stub, 'output'), { force: true });
	return {
		exitCode: result.exitCode,
		log,
		outputs,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

test('crates already on crates.io are skipped and the rest publish in order', () => {
	const result = publish({ cli: ['ok'] }, ['core']);
	expect(result.exitCode).toBe(0);
	expect(result.log).toEqual(['publish cli']);
	expect(result.stdout).toContain('core 1.0.1 is on crates.io');
	expect(result.outputs).toEqual(['core=succeeded', 'cli=succeeded']);
});

test('a rate limited crate waits until crates.io allows it and retries', () => {
	const result = publish({ core: ['429', 'ok'], cli: ['ok'] });
	expect(result.exitCode).toBe(0);
	expect(result.log).toEqual(['publish core', 'sleep 105', 'publish core', 'publish cli']);
});

test('a crate that fails after an earlier one published reports each crate on its own', () => {
	const result = publish({ core: ['ok'], cli: ['fail'] });
	expect(result.exitCode).not.toBe(0);
	expect(result.outputs).toEqual(['core=succeeded']);
});

test('a crate that keeps hitting the rate limit fails after five attempts', () => {
	const result = publish({ core: ['429', '429', '429', '429', '429'], cli: ['ok'] });
	expect(result.exitCode).not.toBe(0);
	expect(result.log.filter(line => line === 'publish core')).toHaveLength(5);
	expect(result.log).not.toContain('publish cli');
	expect(result.stderr).toContain('crates.io kept rate limiting core 1.0.1');
});

test('a failed publish stops the release unless crates.io has the version', () => {
	const failed = publish({ core: ['fail'], cli: ['ok'] });
	expect(failed.exitCode).not.toBe(0);
	expect(failed.log).toEqual(['publish core']);
	expect(failed.outputs).toEqual([]);
	rmSync(join(stub, 'log'));
	const late = publish({ core: ['late'], cli: ['ok'] });
	expect(late.exitCode).toBe(0);
	expect(late.log).toEqual(['publish core', 'publish cli']);
	expect(late.outputs).toEqual(['core=succeeded', 'cli=succeeded']);
});
