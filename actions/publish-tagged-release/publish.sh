#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[[ ${GITHUB_REF_TYPE:-} == tag && -n ${GITHUB_REF_NAME:-} ]] || fail 'This action requires a tag ref.'
: "${GH_TOKEN:?Missing Beepboop App token}"
: "${GH_REPO:?Missing workflow repository}"
tag=$GITHUB_REF_NAME
flags=(--verify-tag --title "${RELEASE_TITLE:-$tag}")
prerelease=${RELEASE_PRERELEASE:-false}
latest=${RELEASE_LATEST:-auto}
case $prerelease in
  true) flags+=(--prerelease) ;;
  false) ;;
  *) fail 'prerelease must be true or false.' ;;
esac
if [[ $prerelease == true ]]; then
  [[ $latest != true ]] || fail 'A prerelease cannot be marked Latest.'
  [[ $latest != auto ]] || latest=false
fi
case $latest in
  true|false) flags+=("--latest=$latest") ;;
  auto) ;;
  *) fail 'latest must be true, false or auto.' ;;
esac

assets=()
if [[ -n ${RELEASE_ASSET_DIRECTORY:-} ]]; then
  dir=$RELEASE_ASSET_DIRECTORY
  [[ -d $dir && ! -L $dir ]] || fail "Expected a release asset directory: $dir"
  shopt -s nullglob
  for asset in "$dir"/*; do
    [[ -f $asset && ! -L $asset ]] || fail "Expected a regular release asset: $asset"
    [[ $asset != *\#* ]] || fail "Release asset paths cannot contain #: $asset"
    assets+=("$asset")
  done
  (( ${#assets[@]} > 0 )) || fail "No release assets found in: $dir"
fi

publish() {
  gh release create "${flags[@]}" "$@" -- "$tag" "${assets[@]}"
}

if [[ -n ${RELEASE_CHANGELOG:-} ]]; then
  [[ -z ${RELEASE_NOTES_FILE:-} ]] || fail 'Set changelog or notes-file, not both.'
  [[ -f $RELEASE_CHANGELOG ]] || fail "Changelog does not exist: $RELEASE_CHANGELOG"
  notes=$(TAG="$tag" awk '
    BEGIN { heading = "## [" ENVIRON["TAG"] "]" }
    { sub(/\r$/, "") }
    match($0, /^ ? ? ?(```+|~~~+)/) {
      delimiter = substr($0, 1, RLENGTH)
      remainder = substr($0, RLENGTH + 1)
      sub(/^ +/, "", delimiter)
      if (fence == "") {
        fence = delimiter
      } else if (index(delimiter, fence) == 1 && remainder ~ /^[[:space:]]*$/) {
        fence = ""
      }
      if (found) print
      next
    }
    fence != "" {
      if (found) print
      next
    }
    /^##[[:space:]]/ {
      if (found) exit
      if ($0 == heading || index($0, heading " ") == 1) found = 1
      next
    }
    found { print }
  ' < "$RELEASE_CHANGELOG")
  [[ $notes =~ [^[:space:]] ]] || fail "Changelog has no notes for $tag."
  publish --notes-file - <<< "$notes"
elif [[ -n ${RELEASE_NOTES_FILE:-} ]]; then
  [[ -f $RELEASE_NOTES_FILE ]] || fail "Release notes file does not exist: $RELEASE_NOTES_FILE"
  publish --notes-file - < "$RELEASE_NOTES_FILE"
else
  publish --generate-notes
fi
