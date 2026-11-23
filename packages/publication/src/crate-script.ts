import { shellQuote } from '@/kernel/text/shell-quote.ts';

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
export function crateOutcome(commands: string, name: string): boolean {
	return commands.startsWith(publishCrate) && commands.split('\n').includes(`publish_crate ${shellQuote(name)}`);
}
const plainCrateLine = /^cargo publish --locked --package '([^']+)'$/;
export function plainCrateNames(commands: string): string[] | undefined {
	const named = commands.trim().split('\n').map(line => plainCrateLine.exec(line)?.[1]);
	return named.every((name): name is string => name !== undefined) && new Set(named).size === named.length
		? named
		: undefined;
}
export function crateScript(commands: string): boolean {
	const end = commands.lastIndexOf('\n}\n');
	return commands.startsWith('crate_status() {\n') && commands.includes('\npublish_crate() {\n') && end >= 0
		&& commands.slice(end + 3).split('\n').every(line => /^publish_crate '[^']+'$/.test(line));
}
