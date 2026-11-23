---
name: beepboop-post-merge
description: Answer the CodeRabbit "Big if true" post-merge review of a merged Beepboop PR. Waits until 15 minutes after the merge, reads the review, checks each finding against master, ships the real ones through beepboop-ship, and replies on the reviewed PR. Use after a Beepboop PR merges, or when asked to check merged PRs for CodeRabbit follow-ups.
---

# Answer a post-merge review

CodeRabbit posts a post-merge review on a merged PR as an issue comment. The
comment starts with `<!-- post_merge_actions_result -->` and a
`## Post-Merge Actions` heading, and its `**Big if true**` entry holds the
review. Each `### P<n>: <title>` section is one finding. The
`### Validation and scope` section describes the review itself and holds no
finding.

CodeRabbit limits free reviews. A rate-limited PR may get no post-merge review
at all.

Work in `/home/kjanat/projects/beepboop`. Bun is `/home/kjanat/.bun/bin/bun`.
The commands below read the reviewed PR number from the shell variable `pr`.
Set it first, for example `pr=255`.

## 1. Find merged PRs

Take the PR numbers from the caller, or list recent merges:

```sh
gh pr list --repo kjanat/beepboop --state merged --limit 20 --json number,title,mergedAt,mergeCommit
```

An open PR waits until this command prints `MERGED`:

```sh
gh pr view "$pr" --repo kjanat/beepboop --json state --jq .state
```

## 2. Wait for the review

Run in the background and wait for its notification:

```sh
.claude/skills/beepboop-post-merge/wait.sh "$pr"
```

It sleeps until 15 minutes after the merge, then polls the PR comments until a
CodeRabbit post-merge comment with "Big if true" appears or 30 minutes have
passed since the merge. It prints each such comment as JSON with `id`,
`created_at`, `html_url` and `body`, and exits 0. It exits 3 when no review came
within 30 minutes; record "none" for that PR and move on. It exits 1 for an
unmerged PR. Foreground `sleep` is blocked, so run it with `run_in_background`
or under Monitor.

## 3. Skip a review someone already answered

A reply from `kjanat` that starts with the note below and was created after the
review comment means the review is already handled:

```sh
gh api --paginate "repos/kjanat/beepboop/issues/$pr/comments" --jq '.[] | select(.user.login == "kjanat" and (.body | test("^> \\[!NOTE\\]\n> 🤖 \\*\\*.+ responding on behalf of kjanat\\*\\*"))) | {created_at, html_url}'
```

Compare each `created_at` with the review's `created_at`. The same note also
answers pre-merge findings, and such a reply answers nothing in the post-merge
review.

## 4. Check each finding

Check every finding against current `origin/master`. Later PRs may have changed
the cited lines. A finding is a defect until evidence proves it wrong:

- Read the cited file and lines on `origin/master`, and the callers above and
  below them.
- Reproduce the scenario in a test. A test that fails on master proves the
  finding. A test that passes on master, or a line on master that rules the
  scenario out, rejects it.
- A finding about missing test coverage is real when reverting the guarded
  source leaves every test green. Show that by reverting the line with Edit,
  running the tests and restoring it with Edit.

## 5. Fix the real findings

Fix every real finding from one review in one PR, shipped with
`.claude/skills/beepboop-ship/SKILL.md`. The PR title names the fix. The body
names the reviewed PR by number without a closing keyword, and its `Proof:`
line names the test that fails without each fix.

## 6. Reply on the reviewed PR

After the fixing PR merges, post one issue comment on the reviewed PR. Write
the body to a scratch file whose name starts with your branch name, and set
`reply` to its path:

```markdown
> [!NOTE]
> 🤖 **<model> responding on behalf of kjanat**

- P1 <finding title>: fixed in #<fix PR> (<merge sha>).
- P2 <finding title>: rejected. `<path>:<line>` on master <evidence>.
```

Write one line per finding. A fixed finding names the fixing PR and its merge
commit. A rejected finding names the line or the test that disproves it. Post it
with:

```sh
gh api "repos/kjanat/beepboop/issues/$pr/comments" --field "body=@$reply"
```

Post no reply for a PR without a review.

## 7. Report

Per PR, return each finding in one line and its outcome: the fixing PR and its
merge commit, the evidence that rejects it, or "none" when no review came.
