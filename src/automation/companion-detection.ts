import { packageId } from '@/automation/package-identity';
import { escapeRegExp } from '@/automation/release-graph/shell';
import type { SetupChoices } from '@/automation/setup-types';
import type { Inventory, Package, Snapshot } from '@/automation/types';

type Stream = SetupChoices['streams'][number];

const release = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const code = /(?:^|\/)(?:go\.mod|go\.sum)$|\.go$/;

function streamPrefixes(stream: Stream): string[] {
	return [
		...new Set([
			...(stream.promote?.tagPrefix === undefined ? [] : [stream.promote.tagPrefix]),
			...(stream.versionSource ? [stream.versionSource.prefix] : []),
			...(stream.observe ?? []).flatMap(entry =>
				entry.ref?.startsWith('refs/tags/') && entry.ref.endsWith('*') ? [entry.ref.slice(10, -1)] : []
			),
		]),
	];
}
function pushedPrefix(stream: Stream): string | undefined {
	const promote = stream.promote;
	if (!promote) return undefined;
	return promote.tagPrefix ?? (promote.binaries ? stream.versionSource?.prefix ?? 'v' : undefined);
}
function versionsOf(tags: readonly string[], prefix: string): string[] {
	return tags.flatMap(tag =>
		tag.startsWith(prefix) && release.test(tag.slice(prefix.length)) ? [tag.slice(prefix.length)] : []
	);
}
function templated(prefix: string): RegExp {
	return new RegExp(`(?<![\\w./-])${escapeRegExp(prefix)}(?:\\{|\\$|%|<|\\d)`);
}
function evidence(snapshot: Snapshot, module: string, other: string): string | undefined {
	const own = versionsOf(snapshot.tags ?? [], module);
	const counterpart = new Set(versionsOf(snapshot.tags ?? [], other));
	if (own.length && own.every(version => counterpart.has(version))) {
		return `every \`${module}<version>\` tag has a matching \`${other}<version>\` tag`;
	}
	const [path] = Object.entries(snapshot.files)
		.filter(([file, text]) => !code.test(file) && templated(module).test(text) && templated(other).test(text))
		.map(([file]) => file)
		.sort();
	return path === undefined ? undefined : `\`${path}\` refers to \`${module}<version>\` and \`${other}<version>\``;
}
function moduleOf(pkg: Package): string | undefined {
	return pkg.manager === 'go' && pkg.versionSource.startsWith('tags:')
		? pkg.versionSource.slice('tags:'.length)
		: undefined;
}
export function companionProposals(choices: SetupChoices, snapshot: Snapshot, inventory: Inventory): string[] {
	return inventory.packages.flatMap(pkg => {
		const module = moduleOf(pkg);
		const id = packageId(pkg);
		if (module === undefined) return [];
		const owner = choices.streams.find(stream => stream.packages.includes(id));
		if (!owner) return [];
		return choices.streams.flatMap(target => {
			if (target === owner || target.packages.includes(id) || target.companionModules?.includes(id)) return [];
			const pushed = pushedPrefix(target);
			if (pushed === module) return [];
			const [found] = streamPrefixes(target).flatMap(prefix => {
				const seen = prefix === module ? undefined : evidence(snapshot, module, prefix);
				return seen === undefined ? [] : [seen];
			});
			if (found === undefined) return [];
			const tracked =
				`${target.name}: ${pkg.name} tags \`${module}<version>\` in its own stream \`${owner.name}\`, and ${found}. `;
			if (!target.promote) {
				return [
					`${tracked}\`${target.name}\` only observes tags. \`companionModules\` needs a stream Beepboop promotes.`,
				];
			}
			if (pushed === undefined) {
				return [
					`${tracked}A \`${target.name}\` release pushes no version tag. \`companionModules\` needs a promotion with a tag prefix.`,
				];
			}
			return [
				`${tracked}A \`${target.name}\` release pushes \`${pushed}<version>\`. `
				+ `Option 1, keep \`${owner.name}\` and push \`${module}<version>\` on the same commit: set \`companionModules\` of \`${target.name}\` to \`${id}\` (\`--stream ${target.name} --companion-module ${pkg.name}\`). `
				+ `Option 2, release both as one stream: move ${id} into \`packages\` of \`${target.name}\`. `
				+ `Both stay proposals until you choose.`,
			];
		});
	});
}
