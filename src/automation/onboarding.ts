import type { Inventory, Snapshot } from './types.ts';

export function onboardingConfiguration(inventory: Inventory): Record<string, unknown> {
	const workflows = inventory.workflows.filter(
		(w) =>
			w.publication
			&& w.events.some((e) => ['push', 'release', 'workflow_dispatch', 'schedule'].includes(e)),
	);
	const bindings: Record<string, unknown> = {};
	for (const workflow of workflows) {
		const name = workflow.file.replace(/\.ya?ml$/, '');
		if (/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
			bindings[name] = {
				file: workflow.file,
				mode: 'observe',
				...(workflow.tagTriggered ? { ref: 'refs/tags/*' } : {}),
			};
		}
	}
	return {
		$schema: 'https://beepboop.kjanat.dev/schema/v1.json',
		managers: inventory.managers,
		streams: {
			main: {
				versioning: 'workspace',
				prepare: { version: 'manual' },
				promote: { approval: 'required' },
				workflows: bindings,
				required: inventory.packages
					.filter((p) => p.publish && !p.optional)
					.map((p) => `${p.manager}:${p.name}`),
			},
		},
	};
}
export function onboardingBody(snapshot: Snapshot, inventory: Inventory): string {
	return [
		'Configure release automation for this repository.',
		'',
		`Inspected revision: \`${snapshot.sha}\`.`,
		'',
		'## Discovered packages',
		'',
		'| Manager | Package | Version | Publish |',
		'| --- | --- | --- | --- |',
		...inventory.packages.map(
			(p) => `| ${p.manager} | ${p.name} | ${p.version} | ${p.publish ? 'yes' : 'no'} |`,
		),
		'',
		'## Workflow bindings',
		'',
		...inventory.workflows
			.filter((w) => w.publication)
			.map(
				(w) =>
					`- \`${w.file}\`: ${w.events.join(', ')}${
						w.dispatchInputs.includes('beepboop_execution_id')
							? ' — integration input detected'
							: ' — needs an explicit operation binding and generic action integration'
					}.`,
			),
		'',
		'## Review before activation',
		'',
		'- Assign independently versioned packages to their release streams.',
		'- Bind preparation and promotion workflows explicitly; promotion requires approval.',
		'- Declare required publication result IDs and credential aliases.',
		'- Existing triggers remain active until each operation has an explicit handover.',
		...inventory.diagnostics.map((d) => `- ${d}`),
	].join('\n');
}
