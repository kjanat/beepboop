# Beepboop CLI

The `beepboop` CLI calls the same API as the dashboard and follows the same
repository policy. Run it from this checkout with `bun run beepboop`, or run
`bun link` once to put a `beepboop` executable on your `PATH`. The CLI needs
Bun.

```sh
bun run beepboop auth login
bun run beepboop auth status
bun run beepboop repositories list
bun run beepboop repositories show kjanat/actionlint
bun run beepboop repositories discover kjanat/actionlint
bun run beepboop repositories adopt kjanat/actionlint
bun run beepboop runs list
bun run beepboop secrets list
```

`auth login` asks for the server URL and whether to open your browser. It prints
a URL and a confirmation code. Open the URL, sign in through OpenAuth, check that
the code matches, and approve the terminal. The command waits up to five
minutes. The session lasts until `auth logout`, which revokes it on the server
and deletes the local credential. After a revocation you log in again.

The CLI keeps one credential per server. It writes the file atomically with mode
`0600` in a `0700` directory under `$XDG_STATE_HOME/beepboop`, which defaults to
`~/.local/state/beepboop`. The server stores only a hash of the session token.

Every command accepts `--server https://beepboop.kjanat.dev` and reads
`BEEPBOOP_SERVER`. Plain HTTP works only for localhost. The CLI refuses
redirects on requests that carry credentials.

Repository and run lists print tables. Add `--json` to get the full API records.
Plans and other structured responses print as JSON. Every command has `--help`.
When stdin is a terminal the CLI prompts for a missing repository, stream,
version, plan or approval. Arguments you pass skip their prompts, and scripts
must pass every required input. `auth login --server URL --no-browser` prints
the login link and leaves the browser closed.

Flags use camelCase, such as `--releaseVersion`, `--sourceSha` and `--planId`.
The root `--version` flag prints the CLI version.

The package is `@kjanat/beepboop` on npm and JSR. Install it with
`bun add --global @kjanat/beepboop`. [How Beepboop releases its CLI](cli-release.md)
walks through the preparation, approval and publication of that package.

## Release preparation and execution

From a repository checkout, start a version bump with:

```sh
beepboop release patch
beepboop release minor
beepboop release 0.1.0
```

`beepboop release` reads the GitHub repository from the checkout's `origin`
fetch remote. Without an `origin`, it uses the only GitHub remote. It accepts
HTTPS, SCP-style SSH and `ssh://` remotes. Pass `--repository owner/repository`
to override the remote or to run outside a checkout. The repository must be
enrolled already. The release preview skips discovery and leaves setup PRs
alone.

The server returns the configured release streams. When one stream can publish,
the CLI picks it. With several streams the CLI shows which packages each one
ships. Pass `--stream NAME` to choose. Without a version argument the CLI asks
for a patch, minor or major bump or an explicit version.

The preview shows the package versions, the file changes and the exact source
commit on the server. Beepboop releases the default branch as the server sees
it. Local commits and uncommitted files stay out. After you confirm, the CLI
passes the plan ID and source SHA to preparation. The server refuses a plan that
changed since the preview. The output names the preparation and lists the merge
and approval steps that follow.

When the stream lists `{ "via": "cli" }` in `start`, the confirmation starts the
release, and the start approves it. Beepboop then bumps the version, publishes
and tags without another approval. The command follows the release: a spinner
shows the version bump, the wait for checks and the dispatch. Progress bars
count the finished binary build legs, the publications and the uploaded release
assets, and tables list each package's and each binary's outcome with links to
the run and the GitHub release. Human output shortens commit SHAs and execution
IDs to 12 characters; `--json` and link targets keep the full values. With a version PR, the command links the PR and
stops, and merging it continues the release. A failing check or a refused bump
ends the command with exit code 1 and the reason. `--json` prints the started
release and returns at once. Spinners and progress bars stay off when the
output is not a terminal, and `NO_COLOR` turns off the colors and links. See [Start a release](automation.md#start-a-release). Without
that entry, `beepboop release` never approves or publishes.

The confirmation defaults to no. `--yes` skips only the confirmation; the
preview still prints. When stdin is not a terminal the CLI prints the preview
and starts without asking, as with `--yes`. Piped output alone still asks.
`--dry-run` plans on the server, prints the
preview, or JSON with `--json`, and starts nothing. `--json` on its own also
previews and stops. Pass the version, and `--stream` when the repository has
several streams. Add `--yes` to start with `--json`:

```sh
beepboop release patch --repository owner/repository --stream main --dry-run
beepboop release patch --repository owner/repository --stream main --yes --json
```

When the default branch already carries the version, a stream with the cli
start publishes it after the same single confirmation. A promotion that waits
for approval takes the start as its approval. Without the cli start,
`beepboop release` refuses a version that is prepared already. It handles only
shared-version streams. Independent package versions use `plan-set` and
`prepare-set` below.

For a stream whose `versionSource` reads tags, the flow ends at preparation.
Merging the preparation PR starts no publication run, and the CLI has no
shared-version counterpart to `releases start`.

The lower-level commands split preview, preparation and approval into separate
steps. Take stream names from `repositories show`. The CLI looks up the
repository by its enrolled name.

```sh
beepboop releases plan kjanat/actionlint --stream main --releaseVersion 2.1.0
beepboop releases prepare kjanat/actionlint --stream main --releaseVersion 2.1.0 \
  --sourceSha REVIEWED_SOURCE_SHA --planId REVIEWED_PLAN_ID
beepboop runs list
beepboop runs approve EXECUTION_ID --sourceSha REVIEWED_SOURCE_SHA
beepboop runs approve EXECUTION_ID --sourceSha REVIEWED_SOURCE_SHA --force
beepboop runs cancel EXECUTION_ID
beepboop runs recover EXECUTION_ID
beepboop runs recover EXECUTION_ID --action retry
```

Pass the exact `sourceSha` and `planId` from the preview. The server rejects a
preparation whose plan changed. An approval names one reviewed commit.
`--force` approves when the signature or checks fail, and the audit log records
each failure it overrode. `--force` cannot approve a version whose tag already
targets another commit. `runs cancel` cancels the operation and its running
workflow. `runs recover` reconciles by default. Pass
`--action retry` to retry. The server applies its usual approval and dispatch
rules.

Independent monorepo releases take a JSON plan, described in
[release planning](release-planning.md):

```sh
beepboop releases plan-set OWNER/REPO --stream main --plan release-plan.json
beepboop releases prepare-set OWNER/REPO --stream main --plan release-plan.json \
  --sourceSha REVIEWED_SOURCE_SHA --planId REVIEWED_PLAN_ID
beepboop releases start PREPARATION_ID --sourceSha MERGED_COMMIT_SHA
```

`releases start` accepts only preparations from `prepare-set`. Run it after
preparation finishes and the PR is reviewed and merged, with the merged commit.
Shared-version preparations follow the stream's publication policy instead.

## Secrets

```sh
beepboop secrets list
printf '%s' "$TOKEN" | beepboop secrets set crates-io
beepboop secrets grant owner/repository crates-io --operation promote
beepboop secrets revoke GRANT_ID
```

`secrets list` prints secret names, versions, grants and deliveries. Values stay
on the server. `secrets set` reads the value from stdin, or from a hidden prompt in a
terminal, and asks before it overwrites a stored version.

`set`, `grant` and `revoke` each need a touch of a registered security key. The
CLI talks to the key directly over HID on Linux and macOS and through Windows
WebAuthn on Windows. It asks for the key's PIN when the key has one. Revealing a
secret works only in the dashboard.

When the repository owner merges a Beepboop setup PR, Beepboop grants each
secret that the PR's workflows request, for runtime delivery to that operation's
workflow. It grants nothing when someone else merges the PR, when a generated
file changed before the merge, or when no value is stored under the name.

`secrets grant` lets one stream operation of a repository use a secret. The
alias must appear in that stream's `credentials` list in `.github/beepboop.json`.
`--stream` defaults to the only stream, and `--operation` defaults to `promote`.
`--delivery runtime`, the default, makes the credentials action fetch the value
during the run, for the granted workflow file, ref and environment. With
`--delivery repository` or `--delivery environment`, Beepboop copies the value
into the GitHub secret named by `--secretName` when you press **Copy latest
value to GitHub** in the dashboard. Environment delivery also needs
`--environment`.

## Notifications

```sh
beepboop notifications list
beepboop notifications add --name releases --kind slack --secret slack-webhook
beepboop notifications subscribe DESTINATION_ID npm:svgo
```

A destination posts to the webhook URL stored in a secret. `--kind` is `slack`
or `http`. `--subscribe-new` subscribes the destination to every package that
Beepboop starts watching later. `subscribe` takes a package as `npm:name` or
`jsr:@scope/name`.

## Shell completions

DreamCLI generates completions from the command definitions:

```sh
beepboop completions zsh
beepboop completions bash
beepboop completions fish
beepboop completions powershell
```

To load completions into the current zsh session:

```zsh
autoload -Uz compinit
compinit
source <(beepboop completions zsh)
```

To keep them, save the output as `_beepboop` in a directory on your `fpath`.
Your shell configuration must run `compinit` after that directory joins
`fpath`.

## Configure repository releases

Run `beepboop adopt` in a checkout to set up its releases. The CLI reads the
GitHub repository from the `origin` remote, enrolls it, prints the proposal and
opens or refreshes the setup PR. When stdin is a terminal it asks once before it
opens the PR, and the default answer is yes. Otherwise it opens the PR right
away. A proposal with unresolved requirements opens nothing and exits with
status 1. Install the Beepboop GitHub App on the repository first.

`beepboop adopt owner/repository` names the repository instead.
`beepboop repositories adopt owner/repository`, `beepboop repo adopt` and
`repositories setup` do the same. They also accept a bare repository name, a
GitHub URL or an SSH URL.

The proposal describes each stream: which workflow publishes which packages
where, which tags start it, and what runs in the version PR. A tag-triggered
workflow keeps its triggers. When crates in the repository have no publishing
workflow, the proposal adds one that publishes them and then pushes the version
tag and each Go module tag. That tag starts the existing workflow. The setup PR
body explains each stream, its publication order and anything setup left out.
A closed setup PR does not block a new one.

Answer no to choose the setup yourself in the guided flow below. A proposal
with unresolved requirements starts the guided flow directly.

The guided flow asks for packages and publishing workflows. Beepboop names new
workflows after the selected package or the repository and writes their jobs
and dispatch triggers. A Cargo release that updates a lockfile can use one
workflow with a preparation job and a publishing job. Managed version PRs need
no preparation job. For an existing workflow the CLI asks for a job only when
it cannot tell which one publishes. You map publishing steps to packages
explicitly.

Command prompts take Bash commands, and Beepboop writes them into one workflow
step. Cargo and plain npm packages get editable suggested commands, and a repository with
`uv.lock` gets `uv lock` at the end of its preparation commands. Generated npm
targets, VS Code extensions and other package types need your own commands.
Optional steps let you change filenames and versioning, add release groups and
pick the Actions revision. The default is the current compatible Actions
release.

In the guided flow the CLI prints the inspected commit and the current and
proposed files. It asks before it creates or refreshes the setup PR. Unresolved requirements block the
apply. Merge the setup PR yourself, then run `repositories discover` to inspect
the default branch again.

Every setup choice field also has a flag. With setup flags, `adopt` applies the
flags to the proposal, prints the plan and opens the setup PR without asking
anything. A field without a flag keeps its proposed value, and a release option
nobody chose stays unanswered in the setup PR:

```sh
beepboop adopt owner/repository --promote-file release.yml \
  --start cli --start dashboard --bump commit --approval merge \
  --binary tool --target linux-amd64 --target darwin-arm64
```

- `--stream` names the release group the other flags change. It is needed
  when the proposal has several groups, and a new name adds a group.
- `--package` and `--required` take a package name or PURL and repeat.
  `--required` defaults to the `--package` list.
- `--versioning`, `--start` (repeats), `--bump` and `--approval` take the values
  shown in completion and help.
- `--prepare-*` and `--promote-*` set the workflow fields: `file`, `job`,
  `triggers`, `commands`, `tag-prefix`, `publication-steps`, `credentials` and,
  for preparation, `binaries`. A new workflow gets the `prepare` or `publish`
  job and the suggested commands unless you give them.
- `--binary` (repeats) picks a discovered binary for the GitHub release.
  `--target` (repeats) picks its targets. Without `--target`, the saved targets
  stay. A release without saved targets gets the targets every chosen binary
  can build.
- `--version-source`, `--version-files`, `--observe`, `--needs`, `--operations`
  and `--actions-revision` take the JSON or text the choices file uses.

With `--choices`, a flag replaces that one field of the file. `--plan` refuses
setup flags.

For automation, pass a JSON choices file with `--choices choices.json` and save
the preview with `--output setup-plan.json`. That command only previews. After
you review the saved plan, apply it:

```sh
beepboop adopt owner/repository --choices choices.json --output setup-plan.json --json
beepboop adopt owner/repository --plan setup-plan.json --apply
```

`--json` prints the full preview without prompts. Without `--choices` it prints
the server's current proposal, unresolved requirements included. A preview
enrolls the repository and writes no repository files. `--apply` needs a saved
plan and refuses `--choices`. The server rejects the apply when the source,
choices, generated files, preset revisions or setup branch changed after the
preview. The dashboard goes through the same API and validation.

A choices file holds `streams` and an optional `actionsRevision`, which is a
release tag or a full commit of the published Actions. Each stream has these
fields:

- `name`, `packages` (PURLs), `versioning` (`workspace`, `independent` or
  `none`) and `required`.
- `versionSource`, such as `{ "kind": "tags", "prefix": "v" }`, to read the
  stream's version from its tags.
- `versionFiles`, extra files that carry the version, in `json`, `yaml`,
  `toml` or `text` format.
- `prepare` and `promote`, each a workflow choice.
- `observe`, a list of workflows that Beepboop watches. Each entry has `name`,
  `file`, an optional `ref` pattern and the `publications` that workflow
  produces. An observed stream needs no `prepare` or `promote`.

A workflow choice has these fields:

- `file` and an optional `job`.
- `triggers`: `review` keeps the existing triggers and reports conflicts.
  `dispatchOnly` replaces them with Beepboop dispatch. `preserve` keeps them
  and blocks any integration that conflicts with them. An existing workflow
  with push or tag triggers needs `dispatchOnly`, and when it has several jobs
  you first move the publishing job into its own workflow.
- `commands`, the Bash commands for the generated step.
- `publicationSteps`, which maps PURLs to the IDs of the steps that publish
  them. A workflow that already reports through Beepboop needs no new mappings.
- `credentials`, which maps environment variable names to secret aliases for
  the commands step.
- `tagPrefix`, the prefix of the version tag the workflow pushes, such as `v`.
- `binaries`, Go or Cargo builds for the release assets.

A preview with unresolved trigger conflicts stays blocked until you choose
`triggers` for that workflow.
