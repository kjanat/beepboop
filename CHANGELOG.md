# Changelog

All notable changes to Beepboop are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The runs page has a repository filter, `/runs?repository=<owner>/<name>`, and folds the publications and operations of each release. A release that waits, runs or needs attention starts unfolded.
- `beepboop runs list` shows the current checkout's repository by default and takes `--repository`, `--all`, `--stream`, `--operation`, `--state`, `--releaseVersion` and `--limit`. Its `--json` output is a per-run summary; `--full` prints whole records. https://github.com/kjanat/beepboop/issues/40
- A stream can list `companionModules`, Go modules whose version tag its release pushes on the release commit beside its own tag, such as `go/v1.2.3` beside `rshellcheck-v1.2.3`. The module keeps its own stream. Setup takes the setting as a choices field, the `--companion-module` flag and a JSON editor in the dashboard. Discovery blocks an entry that matches no package and warns about one that is not a Go module versioned by tags.
- Adoption notes a Go module whose tags carry the same versions as another stream's tags, or whose tag name a file builds beside that stream's tag name. The note names both options, `companionModules` and moving the module into the stream's `packages`, and changes nothing until you choose.

### Fixed

- An earlier run that still needs you, such as one with an unknown outcome, decides its stage's colour and stays unfolded beside a newer succeeded run.
- The runs page remembers which releases, operations and run details you folded or unfolded when it reloads after a run changes.
- A failed or cancelled run stops asking for attention once a higher version of the same stream has every required publication after it.
- A stage's attempt count leaves out runs that never started.
- The run card links a release only for the operation that creates it, shows `Started on GitHub` as the workflow commit of an observed run, and shortens operation and session IDs in a reason to 12 characters.
- An operation whose workflow run fails after every required publication succeeded ends as succeeded, and its card and stage say that the workflow run failed. An already failed operation changes at the next reconcile, also when a registry shows the publication later.
- The runs page shows each release version as one card: a row of stages (prepare, promote and each extra operation) with a status dot per stage, the attempt count and a link to the workflow run, and one table of every publication of that release. The operations sit below it, opened when they run or need you. Each operation used to be its own card that listed the other operations' packages under "Still to publish".
- PyPI publications link to the project page of the published version, and a GitHub release whose version is a tag such as `rshellcheck-v1.1.0` links to that release.
- Run lists, release summaries and the overview list unfinished runs (pending, ready, dispatching, running, verifying, awaiting approval) before finished ones, newest created first within each group. Cancelling or failing an old run no longer lists it above a newer release, and the 200-run list limit now keeps unfinished runs.
- Retrying a failed observed release whose workflow ref is a tag pattern, such as `refs/tags/rshellcheck-v*`, re-runs the failed jobs of its run. The retry failed with `GitHub HTTP 422 on GET /repos/<owner>/<name>/commits/rshellcheck-v*`.
- `beepboop runs publish`, `cancel` and `recover` accept the 12-character ID that `beepboop runs list` prints, or any unique prefix of 8 characters or more.
- Retrying an observed release whose workflow ref is a shorthand pattern, such as `widget-v*`, checks the tag or the branch the run was observed on. A deleted tag refuses the retry even when a branch has its name, and a tag created later with the name of a branch leaves a branch run retryable.
- Retrying a release whose workflow ref is an exact ref, such as `refs/tags/widget-v1.2.0`, reads that tag or branch itself. A branch with the tag's name no longer stands in for a deleted tag or reports the tag as moved.
- A release pushes the companion module tags that discovery knew when the release was created. A discovery refresh that removes or renames the module during the release no longer drops or renames its tag, and a release whose `companionModules` entry discovery did not find is refused with the module's name.
- Adoption offers `companionModules` only for a stream whose promotion pushes a version tag, and names the prefix that promotion pushes. For a stream that only observes tags it says so.
- A setup rewrite of an already integrated workflow keeps the trailing comments of the steps it does not change, such as `# v5.2.7` after a pinned `uses`, and ends the file with the same final newline as the original.
- Generated release workflows build Cargo binaries with `cargo auditable build`, so the SBOM lists the crates each binary was built with. The SBOM names the repository and release version, gives every file SHA1 and SHA256 digests, and lists no packages or CPEs guessed from asset file names. https://github.com/kjanat/beepboop/pull/72
- A setup rebuild replaces the per-crate `cargo publish --locked --package 'name'` lines an earlier generator wrote with `beepboop publish`, so a rerun skips published crates, retries rate limits and reports each crate. Commands that differ from those lines stay as written.
- A setup rebuild refreshes the commands of every extra operation workflow, not only the preparation and publishing ones. Plain per-crate `cargo publish --locked --package 'name'` lines in such a workflow, for example shellcheck-rs's `publish-crates.yml`, become `beepboop publish` with the crates.io credential.
- A setup rebuild rewrites an already integrated workflow whose publish step runs plain per-crate `cargo publish --locked --package 'name'` lines when the saved command becomes `beepboop publish`. The step becomes the `beepboop publish` action with the crates.io credential, and the report entries for the crates it records are dropped.
- The rewrite carries the publish step's `if`, `env`, `continue-on-error` and `timeout-minutes` onto the `beepboop publish` step, drops only the credential variables, removes the `beepboop_credentials` step only when no other step reads its outputs, and leaves the workflow as written when the step has a setting an action step cannot take, such as `working-directory`.
- The adoption text states each stream's own `publishWhen`, including one a preset supplies, instead of `approved-in-beepboop` for every stream. A stream that pushes a direct version commit is described without a version PR.
- `beepboop adopt` no longer offers workflow jobs that setup cannot patch, such as reusable, matrix, dependent, conditional or container jobs, the job that already publishes, or workflows whose automatic triggers other jobs share. It names why each is left out and asks again, so the choice ends in a generated workflow instead of a blocker at the end.
- A setup rewrite that replaces a step holding a YAML anchor writes the aliased value into each untouched step that used it, also when another step reuses the anchor name. Such a workflow failed to render with `Unresolved alias`, or the untouched step took the other step's value.
- The rewrite to `beepboop publish` keeps the `beepboop_credentials` step when a remaining step or the job's `outputs` reads it in any spelling, such as `steps['beepboop_credentials']`, and leaves the workflow as written when the publish step passes such a credential under a name setup does not manage.
- The rewrite to `beepboop publish` drops report entries only from report steps that carry the begin step's `execution-id` and no `service`. A report for another execution or service stays as written.
- The rewrite to `beepboop publish` keeps a report step it emptied when a later step or the job's `outputs` reads that step's `result`.
