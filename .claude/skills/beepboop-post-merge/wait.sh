#!/usr/bin/env bash
set -euo pipefail

pr=$1
repo=kjanat/beepboop
merged_at=$(gh pr view "$pr" --repo "$repo" --json mergedAt --jq .mergedAt)
if [ -z "$merged_at" ]; then
	echo "pr #$pr is unmerged"
	exit 1
fi
merged=$(date -u --date "$merged_at" +%s)

reviews() {
	gh api --paginate "repos/$repo/issues/$pr/comments" \
		--jq '.[] | select((.user.login | test("coderabbit"; "i")) and (.body | test("<!-- post_merge_actions_result -->")) and (.body | test("big if true"; "i"))) | {id, created_at, html_url, body}'
}

until [ "$(date -u +%s)" -ge $((merged + 900)) ]; do sleep 30; done
until [ -n "$(reviews)" ] || [ "$(date -u +%s)" -ge $((merged + 1800)) ]; do sleep 30; done

found=$(reviews)
if [ -n "$found" ]; then
	echo "$found"
	exit 0
fi
echo "pr #$pr merged $merged_at: no Big if true comment after 30 minutes"
exit 3
