import { slug, unusedName } from '@/automation/naming';
import type { SetupPlan } from '@/automation/setup-types';
import { parentDirectory } from '@/relative-path';

export interface Selection {
	name: string;
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
		selection.packages.length && selection.packages.every(pkg => pkg.versionSource?.startsWith('tags:'))
		&& !plan.preparation?.versionFileStreams.includes(selection.name)
	) reasons.push('These packages take their versions from Git tags and need a preparation job.');
	return reasons;
}
function fileSlug(value: string) {
	return slug(value).slice(0, 70) || 'packages';
}
export function suggestedWorkflowFile(
	role: 'prepare' | 'promote',
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
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
const publishCrate = String.raw`crate_status() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' --retry 4 --retry-delay 5 \
    --user-agent "$GITHUB_REPOSITORY (beepboop)" "https://crates.io/api/v1/crates/$1/$2"
}
publish_crate() {
  local crate="$1" version status output wait
  version="$(cargo metadata --locked --no-deps --format-version 1 \
    | jq -r --arg crate "$crate" '.packages[] | select(.name == $crate) | .version')"
  for attempt in 1 2 3 4 5; do
    status="$(crate_status "$crate" "$version")"
    if [ "$status" = 200 ]; then
      echo "$crate $version is on crates.io"
      echo "$crate=succeeded" >> "$GITHUB_OUTPUT"
      return 0
    fi
    if [ "$status" != 404 ]; then
      echo "crates.io returned HTTP $status for $crate $version" >&2
      return 1
    fi
    if output="$(cargo publish --locked --package "$crate" 2>&1)"; then
      printf '%s\n' "$output"
      echo "$crate=succeeded" >> "$GITHUB_OUTPUT"
      return 0
    fi
    printf '%s\n' "$output"
    case "$output" in
      *'status 429'*) ;;
      *)
        if [ "$(crate_status "$crate" "$version")" = 200 ]; then
          echo "$crate=succeeded" >> "$GITHUB_OUTPUT"
          return 0
        fi
        return 1
        ;;
    esac
    wait=90
    if [[ "$output" =~ try\ again\ after\ ([A-Za-z]{3},\ [0-9]{2}\ [A-Za-z]{3}\ [0-9]{4}\ [0-9:]{8}\ GMT) ]]; then
      wait=$(($(date -u -d "${'$'}{BASH_REMATCH[1]}" +%s) - $(date -u +%s) + 5))
    fi
    echo "crates.io rate limits $crate $version; attempt $attempt waits $wait seconds"
    if [ "$wait" -gt 0 ]; then sleep "$wait"; fi
  done
  echo "crates.io kept rate limiting $crate $version" >&2
  return 1
}`;
export function cratePublishCommands(names: string[]): string {
	return [publishCrate, ...names.map(name => `publish_crate ${shellQuote(name)}`)].join('\n');
}
export const ledgerCommand = 'beepboop publish';
type Context = Pick<SetupPlan, 'inventory' | 'preparation'>;
export function suggestedCommands(role: 'prepare' | 'promote', selection: Selection, plan: Context): string {
	if (ungenerated(selection).length) return '';
	if (role === 'promote') return selection.packages.length ? ledgerCommand : '';
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
export function crateOutcome(commands: string, name: string): boolean {
	return commands.startsWith(publishCrate) && commands.split('\n').includes(`publish_crate ${shellQuote(name)}`);
}
export function refreshedCommands(
	role: 'prepare' | 'promote',
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
const plainCrateLine = /^cargo publish --locked --package '([^']+)'$/;
function plainCrateLines(commands: string, selection: Selection): boolean {
	const lines = commands.split('\n');
	const named = lines.map(line => plainCrateLine.exec(line)?.[1]);
	const crates = selection.packages.filter(pkg => pkg.manager === 'cargo').map(pkg => pkg.name);
	return named.every((name): name is string => name !== undefined)
		&& new Set(named).size === named.length
		&& named.length === crates.length && crates.every(name => named.includes(name));
}
export function crateScript(commands: string): boolean {
	const end = commands.lastIndexOf('\n}\n');
	return commands.startsWith('crate_status() {\n') && commands.includes('\npublish_crate() {\n') && end >= 0
		&& commands.slice(end + 3).split('\n').every(line => /^publish_crate '[^']+'$/.test(line));
}
