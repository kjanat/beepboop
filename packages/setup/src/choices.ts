import { object } from '@/discovery/managers/manifest-editing.ts';
import { isLockfile } from '@/domain/catalog.ts';
import type { Inventory, Package, Snapshot } from '@/domain/inventory.ts';
import { packageId } from '@/domain/package-identity.ts';
import { publishable } from '@/domain/package-publication.ts';
import { releaseStarts, versionBump } from '@/domain/release-start.ts';
import { versionPrMerge } from '@/domain/setup-terms.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';
import { setupChoicesSchema } from '@/setup/contract.ts';
import { crateScript, defaultTagPrefix, refreshedCommands, suggestedCommands } from '@/setup/defaults.ts';
import type { Operation } from '@/setup/options.ts';
import type { SetupChoices, SetupWorkflow } from '@/setup/types.ts';
import { actionReleaseOffer } from '@/setup/workflows/action-release.ts';
import { workflowActions } from '@/setup/workflows/integrate.ts';

export function releases(
	snapshot: Snapshot,
	stream: SetupChoices['streams'][number],
	workflow: SetupWorkflow | undefined,
	previous: Record<string, unknown>,
): boolean {
	if (stream.actionRelease) return !!workflow;
	if (!workflow || workflow.binaries || stream.observe?.length || stream.versionSource) return false;
	const release = `github-release:${snapshot.repository.name}`;
	const source = snapshot.files[`.github/workflows/${workflow.file}`];
	return Array.isArray(previous.publications) && previous.publications.includes(release)
		|| !!workflow.tagPrefix && source === undefined || workflowActions(source).has('publish-release');
}
export function completeChoices(
	snapshot: Snapshot,
	inventory: Inventory,
	choices: SetupChoices,
	raw: Record<string, unknown>,
): SetupChoices {
	const context = {
		inventory,
		preparation: { lockfiles: snapshot.paths.filter(isLockfile), versionFileStreams: [], workflowStreams: [] },
	};
	const candidates = inventory.packages.filter(publishable).map(pkg => ({
		id: packageId(pkg),
		name: pkg.name,
		manifest: pkg.manifest,
		manager: pkg.manager,
		...(pkg.versionSource ? { versionSource: pkg.versionSource } : {}),
	}));
	const streamCount =
		new Set([...Object.keys(object(raw.streams)), ...choices.streams.map(stream => stream.name)]).size;
	const completed = {
		...choices,
		streams: choices.streams.map(stream => {
			const chosen = candidates.filter(pkg => stream.packages.includes(pkg.id));
			const previousPolicy = object(object(object(object(object(raw.streams)[stream.name]).promote).workflow).refs);
			const actionPrefix = typeof previousPolicy.prefix === 'string'
				? previousPolicy.prefix
				: stream.versionSource?.prefix ?? defaultTagPrefix(stream.name, streamCount);
			const elsewhere = new Set([
				...(stream.operations?.flatMap(entry => entry.publications) ?? []),
				...(stream.observe?.flatMap(entry => entry.publications) ?? []),
			]);
			const complete = (operation: Operation, workflow: SetupWorkflow | undefined): SetupWorkflow | undefined => {
				if (!workflow) return undefined;
				const scope = {
					name: stream.name,
					packages: operation === 'prepare'
						? chosen
						: chosen.filter(pkg => !elsewhere.has(pkg.id) && !workflow.publicationSteps[pkg.id]),
				};
				const build = actionReleaseOffer(snapshot)?.commands ?? '';
				const publication = suggestedCommands(operation, scope, context);
				const combined = operation === 'promote' && stream.actionRelease?.kind === 'distribution'
						&& snapshot.files[`.github/workflows/${workflow.file}`] === undefined && workflow.commands === build
						&& build
					? [build, publication].filter(Boolean).join('\n')
					: workflow.commands;
				const commands = refreshedCommands(operation, combined, scope, candidates, context);
				const generated = commands !== ''
					&& (commands === suggestedCommands(operation, scope, context) || crateScript(commands));
				const source = snapshot.files[`.github/workflows/${workflow.file}`];
				const tagged = source === undefined || workflowActions(source).has('publish-refs');
				return {
					...workflow,
					commands,
					...(operation === 'promote' && stream.actionRelease ? { tagPrefix: workflow.tagPrefix ?? actionPrefix } : {}),
					...(operation === 'promote' && generated && !workflow.credentials
							&& scope.packages.some(pkg => pkg.manager === 'cargo')
						? { credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' } }
						: {}),
					...(operation === 'promote' && tagged && !workflow.tagPrefix && !workflow.binaries && !stream.observe?.length
							&& !stream.actionRelease
						? { tagPrefix: stream.versionSource?.prefix ?? defaultTagPrefix(stream.name, streamCount) }
						: {}),
				};
			};
			const operations = stream.operations?.map(entry => {
				const scope = { name: stream.name, packages: chosen.filter(pkg => entry.publications.includes(pkg.id)) };
				const commands = refreshedCommands('promote', entry.commands, scope, candidates, context);
				const generated = commands !== ''
					&& (commands === suggestedCommands('promote', scope, context) || crateScript(commands));
				return {
					...entry,
					commands,
					...(generated && !entry.credentials && scope.packages.some(pkg => pkg.manager === 'cargo')
						? { credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' } }
						: {}),
				};
			});
			const stored = object(object(raw.streams)[stream.name]);
			const configured = object(stored.promote).approval;
			const approval = stream.approval
				?? (configured === 'required' || configured === 'merge' || configured === 'push' ? configured : undefined);
			const starts = safeDecode(releaseStarts, stored.start);
			const start = stream.start
				?? (starts.success ? starts.data.flatMap(entry => entry.via === 'action' ? [entry.via] : []) : undefined);
			const bumped = safeDecode(versionBump, object(stored.prepare).bump);
			const bump = stream.bump ?? (bumped.success ? bumped.data : undefined);
			const merged = safeDecode(versionPrMerge, object(stored.prepare).versionPrMerge);
			const merge = stream.versionPrMerge ?? (merged.success ? merged.data : undefined);
			const prepare = complete('prepare', stream.prepare),
				promote = complete(
					'promote',
					stream.promote ?? (stream.actionRelease
						? {
							file: 'release.yml',
							job: 'promote',
							triggers: 'dispatchOnly',
							commands: stream.actionRelease.kind === 'distribution'
								? actionReleaseOffer(snapshot)?.commands ?? ''
								: '',
							publicationSteps: {},
							tagPrefix: actionPrefix,
						}
						: undefined),
				);
			return {
				...stream,
				...(stream.actionRelease && !stream.packages.length && !stream.versionFiles?.length && !stream.versionSource
					? { versionSource: { kind: 'tags' as const, prefix: promote?.tagPrefix ?? 'v' } }
					: {}),
				...(promote && approval ? { approval } : {}),
				...(start ? { start } : {}),
				...(bump ? { bump } : {}),
				...(merge ? { versionPrMerge: merge } : {}),
				...(prepare ? { prepare } : {}),
				...(promote ? { promote } : {}),
				...(operations ? { operations } : {}),
			};
		}),
	};
	const canonical = safeDecode(setupChoicesSchema, completed);
	return canonical.success ? canonical.data : completed;
}
export function withDependencies(inventory: Inventory, choices: SetupChoices): SetupChoices['streams'] {
	const unreleased = (pkg: Package) =>
		publishable(pkg)
		&& (pkg.publicationStatus === 'missing'
			|| (pkg.publicationStatus === 'published' && pkg.published !== pkg.version));
	const streamed = new Set(choices.streams.flatMap(stream => stream.packages));
	return choices.streams.map(stream => {
		const packages = [...stream.packages];
		for (let index = 0; index < packages.length; index++) {
			const pkg = inventory.packages.find(candidate => packageId(candidate) === packages[index]);
			for (const name of pkg?.dependencies ?? []) {
				const dependency = inventory.packages.find(other =>
					other.manager === pkg?.manager && other.name === name && unreleased(other)
				);
				const id = dependency && packageId(dependency);
				if (!id || streamed.has(id)) continue;
				streamed.add(id);
				packages.push(id);
			}
		}
		const added = packages.filter(id => !stream.packages.includes(id));
		return added.length
			? { ...stream, packages, required: [...stream.required, ...added.filter(id => !stream.required.includes(id))] }
			: stream;
	});
}
