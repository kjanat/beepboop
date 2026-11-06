import { latestTag } from '@/automation/managers/tags';
import { packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { ReleaseGraph, StreamProposal, Target } from '@/automation/release-graph/graph';
import type { Destination } from '@/automation/release-graph/workflows';
import type { SetupChoices } from '@/automation/setup-types';
import type { Inventory, Snapshot } from '@/automation/types';
import { identifierPattern } from '@/domain/configuration';

const labels: Record<Destination, string> = {
	npm: 'npm',
	jsr: 'JSR',
	'crates-io': 'crates.io',
	pypi: 'PyPI',
	oci: 'container registry',
	'oci-artifact': 'OCI artifacts',
	'github-release': 'GitHub release',
	'go-proxy': 'Go module proxy',
	aur: 'AUR',
	homebrew: 'Homebrew',
	scoop: 'Scoop',
	winget: 'WinGet',
	'vscode-marketplace': 'Visual Studio Marketplace',
	'open-vsx': 'Open VSX',
	'zed-extensions': 'Zed extension registry',
	docs: 'documentation',
};
function code(value: string): string {
	return `\`${value}\``;
}
function list(values: string[]): string {
	return values.map(code).join(', ');
}
function bindingName(file: string, taken: Set<string>): string {
	const stem = file.replace(/\.ya?ml$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	let name = identifierPattern.test(stem) && stem !== 'prepare' && stem !== 'promote' ? stem : `observe-${stem}`;
	name = name.slice(0, 64);
	let candidate = name, index = 2;
	while (taken.has(candidate)) candidate = `${name.slice(0, 60)}-${index++}`;
	taken.add(candidate);
	return candidate;
}

function branchRef(patterns: readonly string[]): string {
	const [only] = patterns;
	return patterns.length === 1 && only !== undefined && /^[\w./-]+$/.test(only) ? `refs/heads/${only}` : 'refs/heads/*';
}

export function adoptionChoices(graph: ReleaseGraph, inventory: Inventory): SetupChoices['streams'] {
	const known = new Map(inventory.packages.filter(publishable).map(pkg => [packageId(pkg), pkg]));
	return graph.streams.map(stream => {
		const packages = [...new Set(stream.targets.flatMap(target => target.packages))].filter(id => known.has(id));
		const optional = new Set(
			stream.targets.flatMap(target => target.required ? target.optionalVariants : target.packages),
		);
		const required = packages.filter(id => {
			const pkg = known.get(id);
			return !!pkg && !pkg.optional && !optional.has(pkg.name) && !optional.has(id);
		});
		const fileVersions = packages.some(id => {
			const pkg = known.get(id);
			return !!pkg && !pkg.versionSource.startsWith('tags:');
		});
		const versioning: SetupChoices['streams'][number]['versioning'] = stream.versionGroup.lockstep === 'conflicting'
			? 'independent'
			: packages.length || stream.trigger.kind === 'tags'
			? 'workspace'
			: 'none';
		const taken = new Set<string>();
		const tagPrefix = stream.trigger.kind === 'tags'
			? stream.trigger.prefix
			: stream.versionGroup.source.kind === 'tags'
			? stream.versionGroup.source.prefix
			: undefined;
		const observe = stream.workflows.filter(entry => entry.role === 'entry' || entry.role === 'channel').map(entry => {
			const covered = new Set(
				stream.targets.filter(target =>
					target.operations.some(operation =>
						operation.startsWith(`${entry.file}#`)
						|| stream.workflows.some(member =>
							member.role !== 'entry' && member.role !== 'channel' && operation.startsWith(`${member.file}#`)
						)
					)
				).flatMap(target => target.packages),
			);
			const tagged = entry.tagPatterns.length > 0 || entry.events.includes('release');
			const versioned = (id: string) => {
				const pkg = known.get(id);
				return tagged
					|| (entry.events.includes('workflow_dispatch') && !!pkg && !pkg.versionSource.startsWith('tags:'));
			};
			return {
				name: bindingName(entry.file, taken),
				file: entry.file,
				...(tagged
					? { ref: `refs/tags/${tagPrefix ?? ''}*` }
					: entry.branchPatterns.length
					? { ref: branchRef(entry.branchPatterns) }
					: {}),
				publications: entry.role === 'channel' ? [] : required.filter(id => covered.has(id) && versioned(id)),
			};
		});
		const versionSource: SetupChoices['streams'][number]['versionSource'] =
			stream.trigger.kind === 'tags' && !fileVersions ? { kind: 'tags', prefix: stream.trigger.prefix } : undefined;
		return {
			name: stream.id,
			packages,
			versioning,
			required,
			...(versionSource ? { versionSource } : {}),
			...(observe.length ? { observe } : {}),
		};
	});
}

function targetLine(target: Target): string {
	const names =
		target.variants.length && target.names.length === 1 && target.names[0]?.startsWith(`${target.variants.length} `)
			? `${target.names[0]} (${
				target.optionalVariants.length ? `${target.optionalVariants.length} optional` : 'all required'
			})`
			: target.destination === 'github-release' && (target.variants.length || target.binaries?.length)
			? `${target.names.map(code).join(', ')} with ${
				[...(target.binaries?.length ? [`binaries ${list(target.binaries)}`] : []), ...target.variants].join(', ')
			}`
			: target.names.length
			? list(target.names)
			: 'packages named at run time';
	const flags = [
		...(target.required ? [] : ['optional']),
		...(target.downstream ? ['submission; merged availability is checked separately'] : []),
		...(target.repository ? [`published to ${code(target.repository)}`] : []),
	];
	return `${labels[target.destination]}: ${names}${flags.length ? ` (${flags.join('; ')})` : ''}, from ${
		list(target.operations)
	}`;
}

function startCommand(stream: StreamProposal, snapshot: Snapshot): string {
	if (stream.trigger.kind === 'tags') {
		const prefix = stream.trigger.prefix;
		const latest = latestTag(snapshot.tags ?? [], prefix);
		const next = latest
			? latest.replace(
				/^(\d+)\.(\d+)\.(\d+).*$/,
				(_, major: string, minor: string, patch: string) => `${major}.${minor}.${Number(patch) + 1}`,
			)
			: '0.1.0';
		const tag = `${prefix}${next}`;
		return `${
			latest ? `Latest release ${code(`${prefix}${latest}`)}. ` : 'No release tag yet. '
		}Start the next release with ${
			code(`git tag ${tag} && git push origin ${tag}`)
		}; Beepboop observes the workflows it starts.`;
	}
	if (stream.trigger.kind === 'dispatch') {
		return `Start a release with ${
			code(`gh workflow run ${stream.trigger.workflow}`)
		}; Beepboop observes the run and its publications.`;
	}
	if (stream.trigger.kind === 'schedule') {
		return `${code(stream.trigger.workflow)} runs on its schedule; Beepboop observes each run.`;
	}
	return `${code(stream.trigger.kind === 'branch' ? stream.trigger.workflow : 'release')} starts on its own triggers.`;
}

const roles: Record<StreamProposal['workflows'][number]['role'], string> = {
	entry: 'starts the release',
	called: 'runs from the release',
	recovery: 'runs from the release and can be dispatched alone to recover a destination',
	channel: 'publishes the scheduled channel',
	initiator: 'prepares and starts the release',
	maintenance: 'runs separately to maintain aliases, release notes or downstream packages',
};

export function adoptionMarkdown(graph: ReleaseGraph, snapshot: Snapshot): string[] {
	const lines: string[] = ['## Release plan', ''];
	if (graph.mirror) {
		lines.push(
			`This repository publishes no builds of its own. ${
				code(graph.mirror.producer)
			} builds the assets it receives (named in ${code(graph.mirror.source)}). Configure releases in ${
				code(graph.mirror.producer)
			} and declare this repository as its mirror destination there.`,
			'',
		);
	}
	for (const stream of graph.streams) {
		lines.push(`### Stream ${code(stream.id)}`, '');
		const trigger = stream.trigger.kind === 'tags'
			? `tags matching ${list(stream.trigger.patterns)}`
			: stream.trigger.kind === 'dispatch'
			? `manual dispatch of ${code(stream.trigger.workflow)}`
			: stream.trigger.kind === 'schedule'
			? `the schedule of ${code(stream.trigger.workflow)}`
			: stream.trigger.kind === 'branch'
			? `pushes that run ${code(stream.trigger.workflow)}`
			: 'published GitHub releases';
		lines.push(`- Starts from ${trigger}.`);
		lines.push(
			`- Workflows: ${stream.workflows.map(entry => `${code(entry.file)} ${roles[entry.role]}`).join('; ')}.`,
		);
		lines.push(`- Channels: ${stream.channels.join(', ')}.`);
		if (stream.facets.length) lines.push(`- Categories: ${stream.facets.join(', ')}.`);
		const group = stream.versionGroup;
		const source = group.source.kind === 'tags'
			? `tags starting with ${code(group.source.prefix)}`
			: group.source.kind === 'file'
			? code(group.source.path)
			: 'no version';
		const carriers = group.carriers.length
			? ` Version carriers: ${
				group.carriers.length > 12
					? `${group.carriers.length} files, ${
						group.carriers.filter(carrier => carrier.status === 'declared').length
					} declared`
					: group.carriers.map(carrier => `${code(carrier.path)} (${carrier.status})`).join(', ')
			}.`
			: '';
		lines.push(`- Version: ${source}.${carriers}`);
		if (stream.targets.length) {
			lines.push('- Publication order:');
			const phases = [...new Set(stream.targets.map(target => target.phase))].sort((a, b) => a - b);
			phases.forEach((phase, index) => {
				for (const target of stream.targets.filter(candidate => candidate.phase === phase)) {
					lines.push(`  ${index + 1}. ${targetLine(target)}`);
				}
			});
		}
		if (stream.aliases.length) {
			lines.push(`- Moving aliases update in ${list(stream.aliases)}, after the publications they depend on.`);
		}
		for (const item of stream.evidence) {
			lines.push(`- ${item.status === 'declared' ? 'Evidence' : 'Review'}: ${item.detail}`);
		}
		for (const item of group.evidence) {
			lines.push(`- ${item.status === 'declared' ? 'Version evidence' : 'Version review'}: ${item.detail}`);
		}
		for (const gap of stream.gaps) lines.push(`- Gap: ${gap}`);
		lines.push(`- ${startCommand(stream, snapshot)}`, '');
	}
	if (graph.incomplete.length) {
		lines.push('### Not ready to publish', '');
		for (const product of graph.incomplete) {
			lines.push(
				`- ${code(product.name)} (${product.kind === 'vscode-extension' ? 'VS Code extension' : 'Zed extension'}, ${
					code(product.manifest)
				})${product.recipe ? `. Build recipe: ${code(product.recipe)}` : ''}. Possible destinations: ${
					product.destinations.map(destination => labels[destination]).join(', ')
				}. Existing releases do not require it.`,
				...product.gaps.map(gap => `  - ${gap}`),
			);
		}
		lines.push('');
	}
	if (graph.omissions.length) {
		lines.push('### Left out', '');
		for (const omission of graph.omissions) lines.push(`- ${omission.subject}: ${omission.reason}.`);
		lines.push('');
	}
	if (graph.notes.length) {
		lines.push('### Notes', '', ...graph.notes.map(note => `- ${note}`), '');
	}
	if (graph.unresolved.length) {
		lines.push('### Decisions needed', '');
		for (const item of graph.unresolved) lines.push(`- ${item}`);
		lines.push('');
	}
	return lines;
}
