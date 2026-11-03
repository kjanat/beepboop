import { tagPrefix } from '@/automation/managers/tags';
import { packageId } from '@/automation/package-identity';
import { validRef } from '@/automation/policy';
import type { DiscoveredWorkflow, Inventory, ManagerName, Snapshot, Stream } from '@/automation/types';

type Binding = { file: string; mode: 'observe'; ref?: string };
type OnboardingStream = {
	versioning: Stream['versioning'];
	versionSource?: { kind: 'tags'; prefix: string };
	prepare: { version: 'manual' };
	workflows: Record<string, Binding>;
	required: string[];
};
export type OnboardingConfiguration = {
	$schema: string;
	managers: ManagerName[];
	streams: { main: OnboardingStream };
};
interface Onboarding {
	configuration: OnboardingConfiguration;
	derived: string[];
	review: string[];
}

const schema = 'https://beepboop.kjanat.dev/schema/v1.json';
const docs = 'https://github.com/kjanat/beepboop/blob/master/docs';
export const onboardingReferences: readonly { label: string; url: string }[] = [
	{ label: 'Configuration schema', url: schema },
	{ label: 'Streams and settings', url: `${docs}/automation.md#configure-release-streams` },
	{ label: 'Workflow integration', url: `${docs}/automation.md#connect-a-workflow` },
	{ label: 'Publication IDs', url: `${docs}/automation.md#publication-results` },
	{ label: 'Tag versions and release refs', url: `${docs}/automation.md#version-selection-and-release-refs` },
	{ label: 'Workflow outputs', url: `${docs}/release-planning.md#workflow-output-contracts` },
];

function code(value: string): string {
	return `\`${value}\``;
}
function list(values: string[]): string {
	return values.length ? values.map(code).join(', ') : 'none';
}
function literal(pattern: string): string {
	return /^[A-Za-z0-9._/-]*/.exec(pattern)?.[0] ?? '';
}
function positive(patterns: string[]): string[] {
	return patterns.filter(pattern => !pattern.startsWith('!'));
}
function refPattern(namespace: 'heads' | 'tags', patterns: string[]): string {
	const included = positive(patterns);
	const [first] = included;
	if (included.length === 1 && first && literal(first) === first && validRef(`refs/${namespace}/${first}`)) {
		return `refs/${namespace}/${first}`;
	}
	const prefixes = included.map(literal);
	let common = prefixes[0] ?? '';
	for (const prefix of prefixes) while (!prefix.startsWith(common)) common = common.slice(0, -1);
	const pattern = `refs/${namespace}/${common}*`;
	return validRef(pattern) ? pattern : `refs/${namespace}/*`;
}
function coversTags(workflow: DiscoveredWorkflow, prefix: string): boolean {
	return workflow.events.includes('release') || positive(workflow.tagPatterns ?? []).some(pattern => {
		const fixed = literal(pattern);
		return fixed.startsWith(prefix)
			|| (prefix.startsWith(fixed)
				&& (!prefix.slice(fixed.length).includes('/') || pattern.slice(fixed.length).startsWith('**')));
	});
}
function trigger(workflow: DiscoveredWorkflow): { ref: string; source: string } | undefined {
	if (workflow.events.includes('release')) return { ref: 'refs/tags/*', source: code('on.release') };
	if (workflow.tagPatterns) {
		return {
			ref: refPattern('tags', workflow.tagPatterns),
			source: `${code('on.push.tags')} ${list(workflow.tagPatterns)}`,
		};
	}
	if (workflow.branchPatterns) {
		return {
			ref: refPattern('heads', workflow.branchPatterns),
			source: `${code('on.push.branches')} ${list(workflow.branchPatterns)}`,
		};
	}
	return undefined;
}

function derive(snapshot: Snapshot, inventory: Inventory): Onboarding {
	const derived: string[] = [],
		review: string[] = [];
	const bound = new Map<string, DiscoveredWorkflow>();
	for (const workflow of inventory.workflows) {
		const name = workflow.file.replace(/\.ya?ml$/, '');
		if (
			workflow.publication
			&& workflow.events.some((e) => ['push', 'release', 'workflow_dispatch', 'schedule'].includes(e))
			&& /^[a-z][a-z0-9-]{0,63}$/.test(name)
		) {
			bound.set(name, workflow);
		}
	}

	const dropped = inventory.managers.filter(name => {
		const owned = inventory.packages.filter(p => p.manager === name);
		return owned.length > 0 && !owned.some(p => p.publish);
	});
	const managers = inventory.managers.filter(name => !dropped.includes(name));
	derived.push(
		`- ${code('managers')} selects discovery and verification adapters. Discovered at the inspected revision: ${
			list(managers)
		}.`,
	);
	for (const name of dropped) {
		const manifests = [...new Set(inventory.packages.filter(p => p.manager === name).map(p => p.manifest))];
		derived.push(`  - ${code(name)} is omitted. Its packages in ${list(manifests)} are unpublishable.`);
	}

	const workflows: Record<string, Binding> = {};
	const bindings: string[] = [];
	for (const [name, workflow] of bound) {
		const filter = trigger(workflow);
		workflows[name] = { file: workflow.file, mode: 'observe', ...(filter ? { ref: filter.ref } : {}) };
		bindings.push(
			filter
				? `  - ${code(name)}: ${code(workflow.file)}. ${code('ref')} ${code(filter.ref)} covers ${filter.source}.`
				: `  - ${code(name)}: ${code(workflow.file)}. It has no tag or branch filter. Default-branch runs count.`,
		);
		if (filter?.ref.startsWith('refs/tags/') && workflow.events.includes('workflow_dispatch')) {
			review.push(
				`- ${code(workflow.file)} also runs on ${
					code('workflow_dispatch')
				}. Those runs start on a branch and fall outside ${code(filter.ref)}.`,
			);
		}
	}

	const publishable = inventory.packages.filter(p => p.publish);
	const released = publishable.flatMap(p => {
		const version = p.published ?? p.version;
		return version === undefined ? [] : [version];
	});
	const versions = [...new Set(released)];
	const tagged = Object.values(workflows).some(binding => binding.ref?.startsWith('refs/tags/'));
	const versioning = versions.length > 1 ? 'independent' : publishable.length || tagged ? 'workspace' : 'none';
	const meaning = `${code('streams.main.versioning')} sets one version for the stream (${
		code('workspace')
	}), separate package versions (${code('independent')}), or no version (${code('none')}).`;
	derived.push(
		`- ${meaning} ${
			versioning === 'independent'
				? `Publishable packages carry versions ${list(versions)}.`
				: versions.length && released.length === publishable.length
				? `Every publishable package carries version ${list(versions)}.`
				: versions.length
				? `Released publishable packages carry version ${list(versions)}.`
				: publishable.length && tagged
				? 'No publishable package has a release. Tag-triggered workflows carry the version.'
				: publishable.length
				? 'No publishable package has a release.'
				: tagged
				? 'No package is publishable. Tag-triggered workflows carry the version.'
				: 'No publishable package or tag trigger carries a version.'
		}`,
	);

	const sources = [...bound.values()].flatMap(workflow =>
		positive(workflow.tagPatterns ?? [])
			.filter(pattern => literal(pattern) !== pattern)
			.map(pattern => ({ prefix: literal(pattern), file: workflow.file }))
	);
	const tagVersioned = publishable.flatMap(p => {
		const prefix = tagPrefix(p.versionSource);
		return prefix === undefined ? [] : [{ id: packageId(p), prefix, released: p.version !== undefined }];
	});
	const fileVersioned = publishable.length > tagVersioned.length;
	const prefixes = [...new Set(sources.map(source => source.prefix))];
	const packagePrefixes = [...new Set(tagVersioned.map(entry => entry.prefix))];
	const [prefix] = prefixes.length ? prefixes : packagePrefixes;
	const versionSource: OnboardingStream['versionSource'] = !fileVersioned
			&& (prefixes.length ? prefixes : packagePrefixes).length === 1 && prefix !== undefined
			&& /^[A-Za-z0-9._-]*$/.test(prefix)
		? { kind: 'tags', prefix }
		: undefined;
	if (versionSource) {
		derived.push(
			`- ${code('streams.main.versionSource')} reads the current version from tags starting with ${
				code(versionSource.prefix)
			}. The prefix comes from ${
				prefixes.length
					? `${code('on.push.tags')} in ${list([...new Set(sources.map(source => source.file))])}`
					: `the tag versions of ${list(tagVersioned.map(entry => entry.id))}`
			}.`,
		);
	}

	derived.push(`- ${code('streams.main.prepare.version')} is ${code('manual')}, the only accepted value.`);
	derived.push(
		`- ${code('streams.main.workflows')} binds operations to workflow files. ${
			code('mode: observe')
		} tracks runs started by the workflow's own triggers. ${
			code('ref')
		} selects which runs count and accepts one trailing ${code('*')}.`,
		...(bindings.length ? bindings : ['  - No workflow name mentions publish, release, deploy or promote.']),
	);

	const triggers = [...bound.values()];
	const required = inventory.packages
		.filter(p => p.publish && !p.optional)
		.filter(p => {
			const id = packageId(p), prefix = tagPrefix(p.versionSource);
			if (prefix === undefined) return true;
			if (p.version === undefined) {
				review.push(
					`- ${code(id)} has no release tag starting with ${code(prefix)}. Add it to ${
						code('streams.main.required')
					} after its first tagged release.`,
				);
				return false;
			}
			if (!triggers.some(workflow => coversTags(workflow, prefix))) {
				review.push(
					`- ${code(id)} takes its version from tags starting with ${
						code(prefix)
					}. No bound workflow runs on those tags.`,
				);
				return false;
			}
			return true;
		})
		.map(p => ({ id: packageId(p), source: code(p.manifest) }));
	const releasers = [...bound.values()].filter(workflow => workflow.createsRelease).map(workflow => workflow.file);
	const release = packageId({ manager: 'github-release', name: snapshot.repository.name });
	if (releasers.length && versioning !== 'independent') {
		required.push({ id: release, source: `the release step in ${list(releasers)}` });
	}
	derived.push(
		`- ${code('streams.main.required')} lists publication IDs (${
			code('pkg:type/namespace/name')
		}) that must succeed before Beepboop emits a release event.`,
		...(required.length
			? required.map(entry => `  - ${code(entry.id)} from ${entry.source}.`)
			: ['  - Nothing publishable was found.']),
	);
	if (versioning === 'independent') {
		review.push('- Assign independently versioned packages to their release streams.');
		if (releasers.length) {
			review.push(
				`- ${list(releasers)} creates a GitHub release. Add ${code(release)} to the ${
					code('publications')
				} of the operation that publishes it.`,
			);
		}
	}

	return {
		configuration: {
			$schema: schema,
			managers,
			streams: {
				main: {
					versioning,
					...(versionSource ? { versionSource } : {}),
					prepare: { version: 'manual' },
					workflows,
					required: [...new Set(required.map(entry => entry.id))],
				},
			},
		},
		derived,
		review,
	};
}

export function onboardingConfiguration(snapshot: Snapshot, inventory: Inventory): OnboardingConfiguration {
	return derive(snapshot, inventory).configuration;
}
export function onboardingBody(snapshot: Snapshot, inventory: Inventory): string {
	const { derived, review } = derive(snapshot, inventory);
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
			(p) =>
				`| ${p.manager} | ${p.name} | ${p.published ?? p.version ?? 'unreleased'}${
					p.published !== undefined && p.version !== undefined && p.published !== p.version
						? ` (manifest ${p.version})`
						: ''
				} | ${p.publish ? 'yes' : 'no'} |`,
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
		'## Configuration reference',
		'',
		'The schema and guides define every field in `.github/beepboop.json`.',
		'',
		...onboardingReferences.map(reference => `- ${reference.label}: ${reference.url}`),
		'',
		'## Generated values',
		'',
		...derived,
		'',
		'## Review before activation',
		'',
		`- Bind ${code('promote.workflow')} to gate releases on approval. No generated binding gates promotion.`,
		`- Choose ${code('prepare.workflow')} and ${code('prepare.strategy')} for release PRs.`,
		`- Declare ${code('credentials')} aliases and registry ${code('channels')} where publishers need them.`,
		`- Declare ${code('outputs')} only for Actions artifacts named by output ID and reported through ${
			code('actions/report')
		}. Files attached to a GitHub release do not count.`,
		`- Switch a binding to ${code('mode: dispatch')} after adding a ${code('beepboop_execution_id')} ${
			code('workflow_dispatch')
		} input.`,
		...review,
		'- Existing triggers remain active until each operation has an explicit handover.',
		...inventory.diagnostics.map((d) => `- ${d}`),
	].join('\n');
}
