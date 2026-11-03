import { RepositoryGateway } from '@/automation/github';
import type { Snapshot } from '@/automation/types';

/** GitHub responses used to exercise coordinator recovery and approval gates. */
export class FixtureGateway extends RepositoryGateway {
	invalidSignature = false;
	invalidCheck = false;
	override async token(): Promise<string> {
		return 'fixture-token';
	}
	override async call(path: string): Promise<unknown> {
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
