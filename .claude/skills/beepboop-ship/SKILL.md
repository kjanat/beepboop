---
name: beepboop-ship
description: Take a finished Beepboop change from working tree to merged PR. Runs the gate, writes and lints the commit message, rebases, pushes, opens the PR, waits for CI and Codex, and merges. Use in a subagent whenever a Beepboop change is ready to ship, so the main agent only reviews.
---

# Ship a Beepboop change

Work in `/home/kjanat/projects/beepboop`. Bun is `/home/kjanat/.bun/bin/bun`.
Pipe every command that may print configuration through `envctl redact`.
Never hide output with `head`, `tail` or `>/dev/null`; write long output to a
file in the scratchpad and search it with `rg`.

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
- Gate: `run gate 2>&1 | envctl redact > <scratch>/gate.log`, then
  `rg -n "finished in|^\[test *\] +[0-9]+ (pass|fail)|\(fail\)|Ran [0-9]+ tests|exit [1-9]|×" <scratch>/gate.log`.
  Every task must exit 0 and `0 fail`.
- Worker build: `run deploy:dry` when `src/` changed.
- Browser: `run test:browser` when `src/components`, `src/ui` or styles changed.
- User-visible behaviour gets one entry in `CHANGELOG.md` under `[Unreleased]`
  (`Added`, `Changed` or `Fixed`). Refactors and tests get none.

## 3. Commit

Write the message to a scratch file. Subject at most 50 characters, imperative,
active voice. Body says what the change does in plain sentences. Then lint it:

```sh
node .claude/skills/beepboop-ship/cop/run.mjs <msgfile>
```

`[]` means clean. Fix every finding (stock words such as "Keep", "named",
"latest", "records", "no longer", and participial post-modifiers) and lint
again. Stage named files with `git add <files>` in its own command, then
`git commit --file <msgfile>` in its own command. The pre-commit hook reruns
the gate; send its output to a file. Never name an AI model in the commit.

## 4. Rebase and push

`git fetch origin master`. If `origin/master` moved, rebase with
`git rebase origin/master # scope-verified: <commits on branch> on <base>; master gained <PRs>`,
rerun `run check` and the tests, then push. First push:
`git push --set-upstream origin <branch>`. After a rebase:
`git push --force-with-lease # scope-verified: <what you checked>`.

## 5. Pull request

Body file in the scratchpad: the problem in one or two sentences, the fix, a
`Proof:` line naming the gate result and each test that fails without the
change, and a last line `Created with <model> in Claude Code.` No bare `@name`.
Open it with
`gh pr create --repo kjanat/beepboop --base master --head <branch> --title "<subject>" --body-file <file>`.

## 6. Wait

Run in the background and wait for its notification:

```sh
/home/kjanat/.bun/bin/bun .claude/skills/beepboop-ship/wait.ts <pr>
```

It exits 0 when `verify`, `CodeQL` and `browser` have completed and Codex has a
completed `code_review` for the head commit. It prints the check conclusions and
the Codex state.

## 7. Merge gate

Merge only when all hold on the head commit:

- `verify`, `CodeQL` and `browser` concluded `SUCCESS`.
- Codex `code_review.has_any_findings` is `false`. If it is `true`, read the
  inline review comments (`gh api repos/kjanat/beepboop/pulls/<pr>/comments`),
  fix each real finding with a failing test, push, and wait again. Reply to a
  finding you reject with evidence, prefixed by
  `> [!NOTE]\n> 🤖 **<model> responding on behalf of kjanat**`.
- `gh pr view <pr> --repo kjanat/beepboop --json reviewDecision,mergeStateStatus`
  shows no `CHANGES_REQUESTED` and `CLEAN`. CodeRabbit may be rate limited;
  that does not block.

Run the check and the merge as separate commands:
`gh pr merge <pr> --repo kjanat/beepboop --squash --match-head-commit <sha>`.

## 8. Report

Return the PR URL, the merge state, the test names that prove the change, and
any decision the caller must know about. Nothing else.
