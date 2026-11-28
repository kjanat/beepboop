import { tagPrefix } from '@/domain/version-tags.ts';
import { parentDirectory } from '@/kernel/path/relative-path.ts';
import { slug, unusedName } from '@/kernel/text/naming.ts';
import { shellQuote } from '@/kernel/text/shell-quote.ts';
import { crateScript, plainCrateNames } from '@/publication/crate-script.ts';
import type { SetupPlan } from '@/setup/types.ts';

export interface Selection {
	name: string;
	actionRelease?: 'source' | 'distribution';
	packages: { id: string; name: string; manifest: string; versionSource?: string; manager?: string }[];
}
export function preparationReasons(plan: SetupPlan, selection: Selection): string[] {
	const reasons: string[] = [];
	if (plan.preparation?.lockfiles.length) {
		reasons.push(`${plan.preparation.lockfiles.join(', ')} must be updated with the package versions.`);
	}
	if (plan.preparation?.workflowStreams.includes(selection.name)) {
		reasons.push('This repository delegates version preparation to a workflow.');
	}
	if (
		selection.packages.length
		&& selection.packages.every(pkg => pkg.versionSource !== undefined && tagPrefix(pkg.versionSource) !== undefined)
		&& !plan.preparation?.versionFileStreams.includes(selection.name)
	) reasons.push('These packages take their versions from Git tags and need a preparation job.');
	return reasons;
}
function fileSlug(value: string) {
	return slug(value).slice(0, 70) || 'packages';
}
export function suggestedWorkflowFile(
	role: 'prepare' | 'release',
	selection: Selection,
	plan: SetupPlan,
	reserved: string[] = [],
): string {
	const group = selection.name === 'main' ? '' : `-${fileSlug(selection.name)}`;
	const base = `${role === 'prepare' ? 'prepare' : 'release'}-${
		fileSlug(
			selection.packages.length === 1
				? selection.packages[0]?.name ?? selection.name
				: plan.repository.split('/')[1] ?? selection.name,
		)
	}${group}`;
	return unusedName(
		`${base}.yml`,
		index => `${base}-${index}.yml`,
		proposed => plan.workflows.some(w => w.file === proposed) || reserved.includes(proposed),
	);
}
export const ledgerCommand = 'beepboop publish';
export function defaultTagPrefix(stream: string, streams: number): string {
	return streams === 1 || stream === 'main' ? 'v' : `${stream}-v`;
}
type Context = Pick<SetupPlan, 'inventory' | 'preparation'>;
export function suggestedCommands(role: 'prepare' | 'release', selection: Selection, plan: Context): string {
	if (ungenerated(selection).length) return '';
	if (role === 'release') return selection.packages.length ? ledgerCommand : '';
	const commands = managerCommands(selection, plan);
	return role === 'prepare' && commands && plan.preparation?.lockfiles.some(path => /(?:^|\/)uv\.lock$/.test(path))
		? `${commands}\nuv lock`
		: commands;
}
type Selected = Selection['packages'][number];
function npmPackage(pkg: Selected): boolean {
	return pkg.manager === 'npm' && /(?:^|\/)package\.json$/.test(pkg.manifest);
}
const generators: Record<
	string,
	{
		covers(pkg: Selected): boolean;
		commands(packages: Selected[], plan: Context): string;
	}
> = {
	cargo: {
		covers: () => true,
		commands: () => 'cargo check --workspace --all-targets\ncargo test --workspace',
	},
	npm: {
		covers: npmPackage,
		commands: (packages, plan) => {
			const lockfiles = plan.preparation?.lockfiles ?? [];
			const install = lockfiles.some(path => path.endsWith('bun.lock'))
				? 'bun install'
				: lockfiles.some(path => path.endsWith('pnpm-lock.yaml'))
				? 'pnpm install --no-frozen-lockfile'
				: lockfiles.some(path => path.endsWith('yarn.lock'))
				? 'YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install'
				: lockfiles.some(path => path.endsWith('package-lock.json'))
				? 'npm install --package-lock-only\nnpm ci'
				: 'npm install';
			const command = `${install}\nnpm run test --if-present`;
			return [
				...new Set(packages.map(pkg => {
					const dir = parentDirectory(pkg.manifest);
					return dir ? `(cd ${shellQuote(dir)} &&\n${command}\n)` : command;
				})),
			].join('\n');
		},
	},
	pypi: {
		covers: pkg => /(?:^|\/)pyproject\.toml$/.test(pkg.manifest),
		commands: packages =>
			packages.map(pkg => {
				const dir = parentDirectory(pkg.manifest);
				return `uv build${dir ? ` --project ${shellQuote(dir)}` : ''} --out-dir "$RUNNER_TEMP"/dist/${
					shellQuote(pkg.name)
				}`;
			}).join('\n'),
	},
};
export function ungenerated(selection: Selection): Selected[] {
	return selection.packages.filter(pkg => !generators[pkg.manager ?? '']?.covers(pkg));
}
function ordered(packages: Selected[], plan: Context): Selected[] {
	const order = plan.inventory.publicationOrder ?? [];
	const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
	return [...packages].sort((left, right) => rank(left.id) - rank(right.id));
}
function managerCommands(selection: Selection, plan: Context): string {
	const groups = new Map<string, Selected[]>();
	for (const pkg of ordered(selection.packages, plan)) {
		const manager = pkg.manager ?? '';
		groups.set(manager, [...(groups.get(manager) ?? []), pkg]);
	}
	return [...groups].flatMap(([manager, packages]) => generators[manager]?.commands(packages, plan) ?? [])
		.join('\n');
}
export function refreshedCommands(
	role: 'prepare' | 'release',
	commands: string,
	selection: Selection,
	candidates: Selection['packages'],
	plan: Context,
): string {
	if (!commands) return commands;
	if (crateScript(commands) || plainCrateLines(commands, selection)) {
		return suggestedCommands(role, selection, plan) || commands;
	}
	const named = candidates.filter(pkg =>
		[shellQuote(pkg.name), shellQuote(parentDirectory(pkg.manifest)), shellQuote(`dist/${pkg.name}`)].some(token =>
			commands.includes(token)
		)
	);
	const generated = [selection.packages, named].some(packages =>
		packages.length > 0 && suggestedCommands(role, { name: selection.name, packages }, plan) === commands
	);
	return generated ? suggestedCommands(role, selection, plan) || commands : commands;
}
function plainCrateLines(commands: string, selection: Selection): boolean {
	const named = plainCrateNames(commands);
	const crates = selection.packages.filter(pkg => pkg.manager === 'cargo').map(pkg => pkg.name);
	return named !== undefined && named.length === crates.length && crates.every(name => named.includes(name));
}
