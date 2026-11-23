const pr = process.argv[2];
const repo = 'kjanat/beepboop';
const required = ['verify', 'CodeQL', 'browser'];

async function gh(args: string[]): Promise<string> {
	const proc = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out;
}

for (let attempt = 0; attempt < 120; attempt++) {
	const view = JSON.parse(
		await gh(['pr', 'view', pr, '--repo', repo, '--json', 'headRefOid,statusCheckRollup,mergeable']),
	);
	const head: string = view.headRefOid;
	const checks: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[] =
		view.statusCheckRollup;
	const states = required.map(name => {
		const check = checks.find(c => (c.name ?? c.context) === name);
		return { name, status: check?.status ?? check?.state ?? 'missing', conclusion: check?.conclusion ?? '' };
	});
	const comments = JSON.parse(
		await gh(['api', `repos/${repo}/issues/${pr}/comments`, '--paginate', '--jq', '[.[] | .body]']),
	);
	const codex = comments
		.flatMap((body: string) => [...body.matchAll(/codex-review-state:v1\s*(\{.*?\})\s*-->/gs)].map(match => match[1]))
		.map((raw: string) => {
			try {
				return JSON.parse(raw);
			} catch {
				return undefined;
			}
		})
		.filter((state: { code_review?: { commit_sha?: string; status?: string } } | undefined) =>
			state?.code_review?.commit_sha === head && state.code_review.status === 'completed'
		);
	const checksDone = states.every(state =>
		state.status === 'COMPLETED' || state.status === 'SUCCESS' || state.status === 'FAILURE'
	);
	if (checksDone && codex.length) {
		console.log(JSON.stringify({ head, mergeable: view.mergeable, states, codex: codex.at(-1) }, null, 2));
		process.exit(0);
	}
	const failed = states.find(state => state.conclusion === 'FAILURE');
	if (failed) {
		console.log(JSON.stringify({ head, failed: states }, null, 2));
		process.exit(1);
	}
	await Bun.sleep(30_000);
}
console.log('timeout');
process.exit(2);
