import { Document } from 'yaml';
import { renderWorkflow } from '@/automation/setup-actions';
import { expression } from '@/automation/setup-binaries';

export function startWorkflow(streams: readonly string[], actionsRevision: string | undefined): string {
	const [first = 'main'] = streams;
	return renderWorkflow(
		new Document({
			name: 'Start release',
			on: {
				workflow_dispatch: {
					inputs: {
						stream: { description: 'Release stream', type: 'choice', options: [...streams], default: first },
						bump: {
							description: 'Version bump',
							type: 'choice',
							options: ['patch', 'minor', 'major'],
							default: 'patch',
						},
						version: { description: 'Semantic version; replaces the bump when set', type: 'string' },
					},
				},
			},
			permissions: {},
			jobs: {
				start: {
					'runs-on': 'ubuntu-latest',
					permissions: { 'id-token': 'write' },
					steps: [{
						uses: `kjanat/beepboop/actions/release@${actionsRevision ?? 'v1'}`,
						with: { stream: expression('inputs.stream'), version: expression('inputs.version || inputs.bump') },
					}],
				},
			},
		}),
	);
}
