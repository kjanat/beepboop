# Beepboop agent instructions

## Deployment

Cloudflare Workers Builds deploys `beepboop.kjanat.dev` on every push to
`master`. The build runs in Cloudflare and has no GitHub Actions run. A merged
pull request is live once that build finishes.

## MO

This repo requires PR's.
Please get your shit tested properly with other subagents, and only then create pr.
Do not ask to create a PR.

coderabbit reviews the pr whenever it wants, for free. codex also is supposed to review the pr.
after pr has been merged, check in 15 minutes after to check if coderabbit posted a "Big if true" comment.

It usually contains worthwhile shit to address. Do that.

## Libraries

Use effect. You think, sleep, breathe effect. If it isn't effect, you faint.

## Some commands

Format the code with `bunx @kjanat/fmt` from the project root.
