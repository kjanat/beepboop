---
name: beepboop-ship
description: Take a finished Beepboop change from working tree to merged PR. Runs the gate, writes and lints the commit message, rebases, pushes, opens the PR, waits for CI and Codex, and merges. Use in a subagent whenever a Beepboop change is ready to ship, so the main agent only reviews.
---

# Ship a Beepboop change

Work in `/home/kjanat/projects/beepboop`. Bun is `/home/kjanat/.bun/bin/bun`.
Pipe every command that may print configuration through `envctl redact`.
Never hide output with `head`, `tail` or `>/dev/null`; write long output to a
file in the scratchpad and search it with `rg`.

Every agent shares the scratchpad. Start the name of every scratch file with
the branch name, with each `/` replaced by `-`: branch `fix/release-status`
writes `fix-release-status-msg.txt`, `fix-release-status-gate.log` and
`fix-release-status-pr.md`.

## 1. Branch

Start from `origin/master` on a new branch named for the change:
`git fetch origin master`, then `git switch -c <topic>/<name> origin/master`.
Never stash. Never use `git checkout --` or `git restore`.

## 2. Prove the change

- Every new branch of logic gets a test that fails without the change. Show the
  failure by temporarily reverting the source line with Edit, running the test,
  and restoring it with Edit.
- Format: `bunx @kjanat/fmt`. Organize imports: `bunx biome check --write <files>`.
  Unused imports: `bunx biome check --write --unsafe <files>`.
- Gate: `run gate 2>&1 | envctl redact > <scratch>/<branch>-gate.log`, then
  `rg -n "finished in|^\[test *\] +[0-9]+ (pass|fail)|\(fail\)|Ran [0-9]+ tests|exit [1-9]|×" <scratch>/<branch>-gate.log`.
  Every task must exit 0 and `0 fail`.
- Worker build: `run deploy:dry` when `src/` changed.
- Browser: `run test:browser` when `src/components`, `src/ui` or styles changed.
- User-visible behaviour gets one entry in `CHANGELOG.md` under `[Unreleased]`
  (`Added`, `Changed` or `Fixed`). Refactors and tests get none.

## 3. Commit

Write the message to `<scratch>/<branch>-msg.txt`. Subject at most 50
characters, imperative, active voice. Body says what the change does in plain
sentences. Set `msg` to that path, then lint it:

```sh
node .claude/skills/beepboop-ship/cop/run.mjs "$msg"
```

`[]` means clean. Fix every finding (stock words such as "Keep", "named",
"latest", "records", "no longer", and participial post-modifiers) and lint
again. Stage named files with `git add <files>` in its own command, then
`git commit --file <scratch>/<branch>-msg.txt` in its own command. The
pre-commit hook reruns the gate; send its output to a file. Never name an AI
model in the commit.

Run `git log -1` and compare its subject and body with your message file. If
the commit carries another message, amend it with
`git commit --amend --file <scratch>/<branch>-msg.txt` before you push.

## 4. Rebase and push

`git fetch origin master`. If `origin/master` moved, rebase with
`git rebase origin/master # scope-verified: <commits on branch> on <base>; master gained <PRs>`,
rerun `run check` and the tests, then push. First push:
`git push --set-upstream origin <branch>`. After a rebase:
`git push --force-with-lease # scope-verified: <what you checked>`.

## 5. Pull request

Body file `<scratch>/<branch>-pr.md`: the problem in one or two sentences, the fix, a
`Proof:` line naming the gate result and each test that fails without the
change, and a last line `Created with <model> in Claude Code.` No bare `@name`.
Open it with
`gh pr create --repo kjanat/beepboop --base master --head <branch> --title "<subject>" --body-file <scratch>/<branch>-pr.md`.

## 6. Wait

Set `pr` to the PR number. Run in the background and wait for its notification:

```sh
/home/kjanat/.bun/bin/bun .claude/skills/beepboop-ship/wait.ts "$pr"
```

It reads Codex state only from comments by `chatgpt-codex-connector[bot]`. When
`verify`, `CodeQL` and `browser` have completed and Codex has a completed
`code_review` for the head commit, it prints the check conclusions and the Codex
state. It exits 0 when `code_review.has_any_findings` is `false` and 3
otherwise. It exits 1 when a check failed before Codex finished, and 2 after an
hour without a result. It exits 4 and prints `conflicting` as soon as GitHub
reports `mergeable` as `CONFLICTING`, because GitHub runs no CI on a
conflicting PR. `UNKNOWN` keeps polling.

## 7. Merge gate

Merge only when all hold on the head commit:

- `verify`, `CodeQL` and `browser` concluded `SUCCESS`.
- `wait.ts` exited 0. On exit 4, `git fetch origin master`, rebase onto
  `origin/master`, rerun the gate, force-push with lease, and wait again. On exit 3, read the inline review comments
  (`gh api repos/kjanat/beepboop/pulls/<pr>/comments`), fix each real finding
  with a failing test, push, and wait again. Reply to each finding, prefixed by
  `> [!NOTE]\n> 🤖 **<model> responding on behalf of kjanat**`, naming the
  fixing commit or giving the evidence for rejecting it, then resolve its thread
  with the GraphQL `resolveReviewThread` mutation.
- `gh pr view <pr> --repo kjanat/beepboop --json reviewDecision,mergeStateStatus`
  shows no `CHANGES_REQUESTED` and `CLEAN`. `UNSTABLE` also passes when the
  CodeRabbit check, pending or `NEUTRAL`, is its only cause and the required
  checks and the Codex `code_review` are clean. Never wait for CodeRabbit. A
  Codex `security_review` that is still running does not block either.

Run the check and the merge as separate commands:
`gh pr merge <pr> --repo kjanat/beepboop --squash --match-head-commit <sha>`.

## 8. Report

Return the PR URL, the merge state, the merge time, the test names that prove
the change, and any decision the caller must know about. Nothing else.

The caller owns the CodeRabbit follow-up and runs
`.claude/skills/beepboop-post-merge/SKILL.md` after the merge.
