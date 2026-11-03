import { RepositoryGateway } from '@/automation/github';
import type { Snapshot } from '@/automation/types';

/** GitHub responses used to exercise coordinator recovery and approval gates. */
export class FixtureGateway extends RepositoryGateway {
	finished = false;
	lostDispatchResponse = false;
	dispatchedIds: string[] = [];
	invalidSignature = false;
	invalidCheck = false;
	override async token(): Promise<string> {
		return 'fixture-token';
	}
	override async call(path: string, _token?: string, _method?: string, body?: unknown): Promise<unknown> {
		if (path.endsWith('/dispatches')) {
			const input = body as { inputs: { beepboop_execution_id: string } };
			this.dispatchedIds.push(input.inputs.beepboop_execution_id);
			if (this.lostDispatchResponse) {
				this.lostDispatchResponse = false;
				throw new Error('Response lost after GitHub accepted dispatch');
			}
			return { workflow_run_id: Number.parseInt(input.inputs.beepboop_execution_id.slice(0, 8), 16) };
		}
		if (path.includes('/runs?event=workflow_dispatch')) {
			return {
				workflow_runs: this.dispatchedIds.map(id => ({
					id: Number.parseInt(id.slice(0, 8), 16),
					repository: { id: 91 },
					path: '.github/workflows/release.yml',
					head_branch: 'main',
					display_title: `Release operation ${id}`,
					run_attempt: 1,
				})),
			};
		}
		if (/actions\/runs\/\d+$/.test(path)) {
			return {
				repository: { id: 91 },
				path: '.github/workflows/release.yml',
				head_branch: 'main',
				status: this.finished ? 'completed' : 'in_progress',
				conclusion: this.finished ? 'success' : null,
				run_attempt: 1,
			};
		}
		if (path.includes('/check-runs')) {
			return {
				total_count: 1,
				check_runs: [{ status: 'completed', conclusion: this.invalidCheck ? 'failure' : 'success' }],
			};
		}
		if (path.endsWith('/status')) return { total_count: 0 };
		if (path.includes('/commits/')) return { commit: { verification: { verified: !this.invalidSignature } } };
		throw Error(`Unexpected fixture gateway path: ${path}`);
	}
	override async snapshot(): Promise<Snapshot> {
		return { repository: { id: 91, name: 'example/seventh', defaultBranch: 'main' }, sha: 'b'.repeat(40), files: {} };
	}
	override async preparedSnapshot(): Promise<Snapshot> {
		return {
			repository: { id: 91, name: 'example/seventh', defaultBranch: 'main' },
			sha: 'd'.repeat(40),
			files: {
				'package.json': '{"name":"tool","version":"2.0.0"}',
				'.github/workflows/release.yml': 'on: {workflow_dispatch: {inputs: {beepboop_execution_id: {type: string}}}}',
			},
		};
	}
	override async pullRequest(...args: Parameters<RepositoryGateway['pullRequest']>): Promise<never> {
		const checkpoint = args[6];
		if (!checkpoint) throw Error('Missing preparation checkpoint');
		await checkpoint('c'.repeat(40));
		throw Error('Fixture interruption after checkpoint');
	}
	override async resumePreparation(...args: Parameters<RepositoryGateway['resumePreparation']>) {
		return { head: args[4], url: 'https://github.com/example/seventh/pull/1' };
	}
}
