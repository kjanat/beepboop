import type { SetupPlan } from '@/automation/setup-types';

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
function slug(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'packages';
}
export function suggestedWorkflowFile(
	role: 'prepare' | 'promote',
	selection: Selection,
	plan: SetupPlan,
	reserved: string[] = [],
): string {
	const group = selection.name === 'main' ? '' : `-${slug(selection.name)}`;
	const base = `${role === 'prepare' ? 'prepare' : 'release'}-${
		slug(
			selection.packages.length === 1
				? selection.packages[0]?.name ?? selection.name
				: plan.repository.split('/')[1] ?? selection.name,
		)
	}${group}`;
	let proposed = `${base}.yml`, index = 2;
	while (plan.workflows.some(w => w.file === proposed) || reserved.includes(proposed)) {
		proposed = `${base}-${index++}.yml`;
	}
	return proposed;
}
function quote(value: string) {
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
      return 0
    fi
    if [ "$status" != 404 ]; then
      echo "crates.io returned HTTP $status for $crate $version" >&2
      return 1
    fi
    if output="$(cargo publish --locked --package "$crate" 2>&1)"; then
      printf '%s\n' "$output"
      return 0
    fi
    printf '%s\n' "$output"
    case "$output" in
      *'status 429'*) ;;
      *)
        [ "$(crate_status "$crate" "$version")" = 200 ] && return 0
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
	return [publishCrate, ...names.map(name => `publish_crate ${quote(name)}`)].join('\n');
}
export function suggestedCommands(role: 'prepare' | 'promote', selection: Selection, plan: SetupPlan): string {
	const commands = managerCommands(role, selection, plan);
	return role === 'prepare' && commands && plan.preparation?.lockfiles.some(path => /(?:^|\/)uv\.lock$/.test(path))
		? `${commands}\nuv lock`
		: commands;
}
function managerCommands(role: 'prepare' | 'promote', selection: Selection, plan: SetupPlan): string {
	const order = plan.inventory.publicationOrder ?? [];
	const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
	const packages = [...selection.packages].sort((left, right) => rank(left.id) - rank(right.id));
	if (!packages.length) return '';
	if (packages.every(pkg => pkg.manager === 'cargo')) {
		return role === 'prepare'
			? 'cargo check --workspace --all-targets\ncargo test --workspace'
			: cratePublishCommands(packages.map(pkg => pkg.name));
	}
	if (packages.every(pkg => pkg.manager === 'npm' && /(?:^|\/)package\.json$/.test(pkg.manifest))) {
		const npm = plan.preparation?.lockfiles.some(path => path.endsWith('package-lock.json'));
		const lockfiles = plan.preparation?.lockfiles ?? [];
		const install = lockfiles.some(path => path.endsWith('bun.lock'))
			? 'bun install'
			: lockfiles.some(path => path.endsWith('pnpm-lock.yaml'))
			? 'pnpm install --no-frozen-lockfile'
			: lockfiles.some(path => path.endsWith('yarn.lock'))
			? 'YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install'
			: npm
			? 'npm install --package-lock-only\nnpm ci'
			: 'npm install';
		const command = role === 'promote' ? 'npm publish' : `${install}\nnpm run test --if-present`;
		return [
			...new Set(packages.map(pkg => {
				const dir = pkg.manifest.split('/').slice(0, -1).join('/');
				return dir ? `(cd ${quote(dir)} &&\n${command}\n)` : command;
			})),
		].join('\n');
	}
	return '';
}
