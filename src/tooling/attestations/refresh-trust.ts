import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { toTrustMaterial } from '@sigstore/verify';
import { Effect } from 'effect';
import { attempt, attemptPromise, main } from '@/tooling/runtime';

// GitHub CLI verifies both TUF repositories against its embedded bootstrap roots.
await main(Effect.gen(function*() {
	const exported = yield* attempt(() => spawnSync('gh', ['attestation', 'trusted-root'], { encoding: 'utf8' }));
	if (exported.status !== 0) {
		return yield* Effect.fail(new Error('GitHub CLI could not authenticate Sigstore trusted roots'));
	}
	const roots: unknown[] = yield* attempt(() => exported.stdout.trim().split('\n').map(line => JSON.parse(line)));
	for (const root of roots) yield* attempt(() => toTrustMaterial(TrustedRoot.fromJSON(root)));
	if (roots.length < 2) {
		return yield* Effect.fail(new Error('Both GitHub and Sigstore Public Good trusted roots are required'));
	}
	const rendered = `${JSON.stringify(roots, null, 2)}\n`;
	const target = fileURLToPath(new URL('../../automation/trust/github-sigstore.json', import.meta.url));
	yield* attemptPromise(() => Bun.write(target, rendered));
	console.info(
		`Refreshed ${roots.length} TUF-authenticated Sigstore roots (${
			createHash('sha256').update(rendered).digest('hex')
		})`,
	);
}));
