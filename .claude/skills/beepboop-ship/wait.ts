import { completedReviews, outcome } from './review.ts';

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
	const reviews = completedReviews(
		await gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments`]),
		head,
	);
	const result = outcome(states, reviews);
	if (result._tag === 'Reviewed') {
		console.log(JSON.stringify({ head, mergeable: view.mergeable, states, codex: result.codex }, null, 2));
		process.exit(result.exit);
	}
	if (result._tag === 'Failed') {
		console.log(JSON.stringify({ head, failed: states }, null, 2));
		process.exit(result.exit);
	}
	await Bun.sleep(30_000);
}
console.log('timeout');
process.exit(2);
