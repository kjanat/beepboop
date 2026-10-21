import type { Configuration, GitHubPort, Journal, Operation, Release, Route, Run } from '#model';
export const route: Route = {
	id: 'scoop',
	source: { id: 11, name: 'kjanat/source' },
	destination: { id: 22, name: 'kjanat/destination' },
	workflow: 'release.yml',
	ref: 'master',
	minimumVersion: '2.0.0',
	readiness: [{ workflow: 'release.yml', jobs: ['Verify published candidate'] }],
	assets: ['SHA256SUMS'],
	pypi: null,
	dryRun: false,
};
export const configuration: Configuration = {
	owner: 'kjanat',
	ownerId: 33,
	enabled: true,
	routes: [route],
};
export function release(): Release {
	return {
		id: 44,
		tag: 'v2.0.0',
		sha: 'a'.repeat(40),
		publishedAt: new Date(1_000_000).toISOString(),
		assets: [{ id: 55, name: 'SHA256SUMS', size: 100, digest: `sha256:${'b'.repeat(64)}` }],
	};
}
export function run(): Run {
	return {
		id: 66,
		status: 'queued',
		conclusion: null,
		title: 'Beepboop 11:44:scoop',
		sha: 'c'.repeat(40),
		branch: 'master',
		event: 'workflow_dispatch',
		path: '.github/workflows/release.yml',
		repositoryId: 22,
	};
}
export class MemoryJournal implements Journal {
	entries = new Map<string, Operation>();
	versions = new Map<string, string>();
	async get(id: string): Promise<Operation | undefined> {
		return this.entries.get(id);
	}
	async put(operation: Operation): Promise<void> {
		this.entries.set(operation.id, structuredClone(operation));
	}
	async all(): Promise<Operation[]> {
		return [...this.entries.values()];
	}
	async watermark(id: string): Promise<string | undefined> {
		return this.versions.get(id);
	}
	async advance(id: string, version: string): Promise<void> {
		this.versions.set(id, version);
	}
}
export class FakeGitHub implements GitHubPort {
	value: Release | null = release();
	readyValue = true;
	dispatches = 0;
	loseResponse = false;
	foundRun: Run | null = null;
	currentRun = run();
	async latest(): Promise<Release | null> {
		return this.value;
	}
	async release(): Promise<Release | null> {
		return this.value;
	}
	async ready(): Promise<boolean> {
		return this.readyValue;
	}
	async dispatch(): Promise<number> {
		this.dispatches++;
		if (this.loseResponse) throw new Error('Timeout after accepting dispatch');
		return 66;
	}
	async reconcile(): Promise<Run | null> {
		return this.foundRun;
	}
	async run(): Promise<Run> {
		return this.currentRun;
	}
}
