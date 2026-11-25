#!/usr/bin/env bash
set -euo pipefail

if [[ ! ${DRAFT_ID:-} =~ ^[1-9][0-9]*$ || -z ${DRAFT_TAG:-} ]]; then
	echo "No draft release is recorded for this execution. Declare github-release:${GITHUB_REPOSITORY} in its publications." >&2
	exit 1
fi

release=$(gh api --hostname github.com "repos/${GITHUB_REPOSITORY}/releases/${DRAFT_ID}")
upload_url=$(jq -er --arg id "$DRAFT_ID" --arg tag "$DRAFT_TAG" '
	if (.id | tostring) != $id or .draft != true or .tag_name != $tag then
		error("GitHub release does not match the recorded draft")
	else
		.upload_url | select(type == "string" and length > 0 and (test("[[:cntrl:]]") | not))
	end
' <<<"$release")
printf 'release-id=%s\nupload-url=%s\n' "$DRAFT_ID" "$upload_url" >>"$GITHUB_OUTPUT"
