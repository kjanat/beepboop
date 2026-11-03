import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import beepboop from '@root/test/fixtures/setup/beepboop.json' with { type: 'json' };

function required<T>(value: T | null | undefined): T {
	assert(value !== undefined && value !== null);
	return value;
}

import { parse } from 'yaml';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { discover } from '@/automation/managers';
import { previewSetup, suggestSetup } from '@/automation/setup';
import type { SetupChoices } from '@/automation/setup-types';
import { workflowEvidence } from '@/automation/setup-workflows';
import type { Snapshot } from '@/automation/types';

const revision = 'b'.repeat(40);
const snapshot: Snapshot = {
	repository: { name: 'example/tool', id: 1, defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: {
		'package.json': '{"name":"tool","version":"1.0.0"}',
		'.github/workflows/publish.yml': `name: Publish
on: [push]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - id: publish
        run: npm publish
`,
	},
};
const choices: SetupChoices = {
	actionsRevision: revision,
	streams: [{
		name: 'tool',
		packages: ['pkg:npm/tool'],
		required: ['pkg:npm/tool'],
		versioning: 'workspace',
		prepare: { file: 'prepare.yml', triggers: 'dispatchOnly', commands: 'bun install\nbun test', publicationSteps: {} },
		promote: {
			file: 'publish.yml',
			job: 'publish',
			triggers: 'dispatchOnly',
			commands: '',
			publicationSteps: { 'pkg:npm/tool': 'publish' },
		},
	}],
};
const preview = (source = snapshot, input: unknown = choices, head: string | null = null) =>
	previewSetup(source, discover(source), input, { head });
test('setup produces dispatch, managed preparation and per-step publication reporting', async () => {
	const plan = await preview();
	expect(plan.blockers).toEqual([]);
	const config = JSON.parse(plan.edits.find(edit => edit.path.endsWith('beepboop.json'))?.after ?? '');
	const parsed = parseRepositoryConfiguration(config);
	expect(parsed.streams.tool?.prepare.strategy).toBe('managed');
	expect(parsed.streams.tool?.promote.workflow?.publications).toEqual(['pkg:npm/tool']);
	const publish = parse(plan.edits.find(edit => edit.path.endsWith('publish.yml'))?.after ?? '');
	expect(Object.keys(publish.on)).toEqual(['workflow_dispatch']);
	expect(publish.jobs.publish.steps.find((step: { id?: string }) => step.id === 'publish').run).toBe('npm publish');
	expect(publish.jobs.publish.steps.at(-1).with.publications).toContain("steps.publish.outcome == 'success'");
	expect(publish.jobs.publish.steps.at(-1).with.publications).toContain('"outcome":');
	expect(publish.jobs.publish.steps[2].with.ref).toContain('sourceSha');
	expect(publish.jobs.publish.permissions['id-token']).toBe('write');
	const prepare = parse(plan.edits.find(edit => edit.path.endsWith('prepare.yml'))?.after ?? '');
	expect(prepare.jobs.prepare.steps.at(-1).with.mode).toBe('submit');
	expect(plan.notes.some(note => note.includes('replaces push'))).toBe(true);
});
test('preview binds source, decisions, branch head, and proposed content', async () => {
	const original = await preview();
	expect((await preview()).planId).toBe(original.planId);
	expect((await preview({ ...snapshot, sha: 'c'.repeat(40) })).planId).not.toBe(original.planId);
	expect((await preview(snapshot, choices, revision)).planId).not.toBe(original.planId);
	const changed = structuredClone(choices);
	required(required(changed.streams[0]).prepare).commands = 'bun test --coverage';
	expect((await preview(snapshot, changed)).planId).not.toBe(original.planId);
});
test('automatic triggers and unsupported jobs block instead of silently changing behavior', async () => {
	const unchanged = structuredClone(choices);
	required(required(unchanged.streams[0]).promote).triggers = 'review';
	expect((await preview(snapshot, unchanged)).blockers.join('\n')).toContain('dispatch-only');
	const matrix = structuredClone(snapshot);
	matrix.files['.github/workflows/publish.yml'] = required(matrix.files['.github/workflows/publish.yml']).replace(
		'runs-on:',
		'strategy: { matrix: { os: [ubuntu-latest] } }\n    runs-on:',
	);
	expect((await preview(matrix)).blockers.join('\n')).toContain('matrix');
	const unmapped = structuredClone(choices);
	required(required(unmapped.streams[0]).promote).publicationSteps = {};
	expect((await preview(snapshot, unmapped)).blockers.join('\n')).toContain('select the publishing command step');
});
test('unselected streams, presets and custom workflow inputs survive setup', async () => {
	const source = structuredClone(snapshot);
	source.files['.github/beepboop.json'] = JSON.stringify({
		extends: ['github>example/presets:release'],
		streams: {
			other: { versioning: 'none', required: [] },
			tool: {
				versioning: 'workspace',
				channels: { stable: 'production', prerelease: 'testing' },
				promote: { workflow: { file: 'publish.yml', inputs: { channel: 'stable' } } },
			},
		},
	});
	const plan = await preview(source);
	const config = JSON.parse(required(plan.edits.find(edit => edit.path.endsWith('beepboop.json'))).after);
	expect(config.extends).toEqual(['github>example/presets:release']);
	expect(config.streams.other).toEqual({ versioning: 'none', required: [] });
	expect(config.streams.tool.channels.stable).toBe('production');
	expect(config.streams.tool.promote.workflow.inputs).toEqual({ channel: 'stable' });
});
test('Beepboop onboarding fixture suggests cli roles and requires explicit publication trigger handover', async () => {
	const source: Snapshot = structuredClone(beepboop.snapshot);
	const inventory = discover(source), suggestion = suggestSetup(source, inventory);
	expect(suggestion.streams).toHaveLength(1);
	expect(suggestion.streams[0]?.name).toBe('cli');
	expect(suggestion.streams[0]?.prepare?.file).toBe('prepare-cli.yml');
	expect(suggestion.streams[0]?.promote?.file).toBe('publish-cli.yml');
	expect(suggestion.streams[0]?.packages).toEqual(
		['pkg:npm/%40kjanat/beepboop', 'pkg:jsr/%40kjanat/beepboop'],
	);
	expect(inventory.workflows.find(w => w.file === 'prepare-cli.yml')?.publication).toBe(false);
	const plan = await preview(source, suggestion);
	expect(plan.blockers.join('\n')).toContain('dispatch-only');
	required(required(suggestion.streams[0]).promote).triggers = 'dispatchOnly';
	const accepted = await preview(source, suggestion);
	expect(accepted.blockers).toEqual([]);
	expect(accepted.edits.some(edit => edit.path.endsWith('publish-actions.yml'))).toBe(false);
	const config = JSON.parse(required(accepted.edits.find(edit => edit.path.endsWith('beepboop.json'))).after);
	expect(config.streams.cli.promote.workflow.publications).toEqual(required(suggestion.streams[0]).packages);
	const configured: Snapshot = {
		...source,
		files: { ...source.files, '.github/beepboop.json': JSON.stringify(beepboop.configuration) },
	};
	expect(suggestSetup(configured, discover(configured)).streams[0]?.prepare?.file).toBe('prepare-cli.yml');
});
test('a workflow name alone never invents preparation or promotion integration', () => {
	const source: Snapshot = {
		...snapshot,
		files: {
			...snapshot.files,
			'.github/workflows/prepare.yml': 'name: Prepare release\non: workflow_dispatch\njobs: {}\n',
		},
	};
	expect(suggestSetup(source, discover(source)).streams[0]?.promote).toBeUndefined();
	expect(workflowEvidence('publish.yml', required(source.files['.github/workflows/publish.yml'])).roles).toEqual([]);
});

test('missing workflow permission blocks the proposal without hiding its reviewable edits', async () => {
	const plan = await previewSetup(snapshot, discover(snapshot), choices, { head: null, workflowPermission: false });
	expect(plan.blockers.join('\n')).toContain('Workflows: write');
	expect(plan.edits).toHaveLength(3);
});
test('newly discovered packages remain available and an old proposal is marked superseded', async () => {
	const source = structuredClone(snapshot);
	source.files['packages/extra/package.json'] = '{"name":"extra","version":"1.0.0"}';
	source.files['.github/beepboop.json'] = '{"streams":{"different":{"versioning":"none"}}}';
	const plan = await previewSetup(source, discover(source), choices, {
		head: revision,
		prior: { url: 'https://github.com/example/tool/pull/10', content: '{"streams":{"main":{}}}' },
	});
	expect(plan.packageIds).toContain('pkg:npm/extra');
	expect(plan.prior?.superseded).toBe(true);
	const config = JSON.parse(required(plan.edits.find(edit => edit.path.endsWith('beepboop.json'))).after);
	expect(config.streams.different).toEqual({ versioning: 'none' });
});
