import type { FakeGitHub, Repository } from '@root/test/support/github.ts';

export const publishWorkflow = `name: Publish
run-name: \${{ inputs.beepboop_title || github.workflow }}
on:
  workflow_dispatch:
    inputs:
      beepboop_execution_id:
        required: true
        type: string
      beepboop_title:
        required: false
        type: string
permissions: { contents: read, id-token: write }
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: kjanat/beepboop/actions/begin@actions
        id: release
        with:
          execution-id: \${{ inputs.beepboop_execution_id }}
          stream: main
          operation: promote
      - run: npm publish
      - uses: kjanat/beepboop/actions/report@actions
        with:
          execution-id: \${{ steps.release.outputs.execution-id }}
          publications: '[{"id":"pkg:npm/widget","manager":"npm","name":"widget","version":"\${{ fromJSON(steps.release.outputs.context).version }}","outcome":"succeeded"}]'
`;

export const ciWorkflow = `name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

export interface WidgetOptions {
	approval?: 'required' | 'merge' | 'push';
	configured?: boolean;
	version?: string;
}

export function widgetConfiguration(approval: 'required' | 'merge' | 'push' = 'required'): string {
	return `${
		JSON.stringify(
			{
				$schema: 'https://beepboop.kjanat.dev/schema/v1.json',
				managers: ['npm', 'workflow'],
				streams: {
					main: {
						packages: ['pkg:npm/widget'],
						required: ['pkg:npm/widget'],
						credentials: ['npm-token'],
						prepare: { strategy: 'managed' },
						promote: {
							approval,
							workflow: { file: 'publish.yml', publications: ['pkg:npm/widget'] },
						},
					},
				},
			},
			null,
			'\t',
		)
	}\n`;
}

export function widget(github: FakeGitHub, options: WidgetOptions = {}): Repository {
	const files: Record<string, string> = {
		'package.json': `${JSON.stringify({ name: 'widget', version: options.version ?? '1.0.0' }, null, 2)}\n`,
		'README.md': '# widget\n',
		'.github/workflows/publish.yml': publishWorkflow,
		'.github/workflows/ci.yml': ciWorkflow,
	};
	if (options.configured !== false) files['.github/beepboop.json'] = widgetConfiguration(options.approval);
	const repository = github.create('octo/widget', files);
	passChecks(repository, github.head(repository));
	return repository;
}

export function passChecks(repository: Repository, sha: string): void {
	repository.checks.set(sha, [{ name: 'test', status: 'completed', conclusion: 'success', runId: 1 }]);
}
