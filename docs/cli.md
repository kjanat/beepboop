# Beepboop CLI

The Bun CLI uses DreamCLI and the same API and repository policy as the dashboard.
Run it from this checkout with `bun run beepboop`, or run `bun link` once to install
its `beepboop` executable locally. Bun must be installed; no generated `dist/`
CLI is needed.

```sh
bun run beepboop auth login
bun run beepboop auth status
bun run beepboop repositories list
bun run beepboop repositories show kjanat/actionlint
bun run beepboop repositories discover kjanat/actionlint
bun run beepboop repositories adopt kjanat/actionlint
bun run beepboop runs list
bun run beepboop secrets
```

`auth login` prompts for the server URL and whether to open your browser. It also
prints the URL and a confirmation code. Open the URL, sign in through
OpenAuth if needed, compare the code, and approve your terminal. The command waits
up to five minutes. Approval is exchanged once for a session that lasts until
`auth logout` revokes it on the server and deletes the local credential. A
revoked session requires another login.

Credentials are separate for each server. They are written atomically with mode
`0600` under `$XDG_STATE_HOME/beepboop` (default `~/.local/state/beepboop`), in a
`0700` directory. The server stores only a hash of the session token. Server-side
sessions use the existing `sessions` table and expiry checks.

Every command accepts `--server https://beepboop.kjanat.dev`, or reads
`BEEPBOOP_SERVER`. HTTP is allowed only for localhost development. The CLI refuses
redirects when sending credentials. The new authentication endpoints must be
deployed before using this CLI against a server.

Repository and run lists display tables; add `--json` for their full API records.
Plans and other structured responses are JSON. Use `--help` on any command.
Missing repository, stream, version, plan, and approval inputs are prompted for in
an interactive terminal. Explicit arguments skip their prompts; scripts must
supply required inputs. Use `auth login --server URL --no-browser` to print the
login link without opening a browser.

Flags use camelCase, including `--releaseVersion`, `--sourceSha` and `--planId`.
The root `--version` prints the installed CLI version.

The publishable package is `@kjanat/beepboop` on npm and JSR. After its first
release, install it with `bun add --global @kjanat/beepboop`.
See [how Beepboop releases itself](cli-release.md) for the preparation, approval
and publication flow.

## Release preparation and execution

Use stream names from `repositories show`. Repository numbers are resolved from
the enrolled repository name.

```sh
beepboop releases plan kjanat/actionlint --stream main --releaseVersion 2.1.0
beepboop releases prepare kjanat/actionlint --stream main --releaseVersion 2.1.0 \
  --sourceSha REVIEWED_SOURCE_SHA --planId REVIEWED_PLAN_ID
beepboop releases start PREPARATION_ID --sourceSha REVIEWED_SOURCE_SHA
beepboop runs list
beepboop runs approve EXECUTION_ID --sourceSha REVIEWED_SOURCE_SHA
beepboop runs approve EXECUTION_ID --sourceSha REVIEWED_SOURCE_SHA --force
beepboop runs recover EXECUTION_ID
beepboop runs recover EXECUTION_ID --action retry
```

Use the exact `sourceSha` and `planId` returned by the preview. Preparation rejects
changed plans on the server. Start a release set after its preparation has
completed and the repository's required review/merge steps are done. Approval is
bound to the exact reviewed commit. `--force` approves even when the signature
or checks fail, and the audit log records the problems it overrode. Recovery defaults to reconciliation; retry
must be selected explicitly. Existing server approval and dispatch rules apply.

Independent monorepo releases use the JSON plan format documented in
[release planning](release-planning.md):

```sh
beepboop releases plan-set OWNER/REPO --stream main --plan release-plan.json
beepboop releases prepare-set OWNER/REPO --stream main --plan release-plan.json \
  --sourceSha REVIEWED_SOURCE_SHA --planId REVIEWED_PLAN_ID
```

The `secrets` command returns metadata and grants, never secret values. Secret
writes, reveals, grant changes, and security-key management use the dashboard's
fresh WebAuthn verification. A CLI session does not remove that requirement.

## Shell completions

DreamCLI generates completions directly from the command schema:

```sh
beepboop completions zsh
beepboop completions bash
beepboop completions fish
beepboop completions powershell
```

For the current zsh session, enable completion and load the generated script:

```zsh
autoload -Uz compinit
compinit
source <(beepboop completions zsh)
```

For persistent zsh setup, save the output as `_beepboop` in a directory on your
`fpath` before running `compinit` in your shell configuration.

## Configure repository releases

Run `beepboop repositories adopt owner/repository` to enroll a repository and
configure its releases from the terminal. The Beepboop GitHub App must already
be installed on that repository. You can also pass a repository name, GitHub URL
or SSH URL. `repositories setup` remains an alias of `repositories adopt`.

The guided flow selects packages and publishing workflows. New workflows get
filenames based on the selected package or repository, with jobs and dispatch
triggers generated automatically. A Cargo release that updates a lockfile can
use one workflow with separate preparation and publishing jobs. Managed version
PRs need no preparation job. Existing workflows only ask for a job when it cannot
be inferred, and publishing-step mappings are explicit for each package.

Command prompts accept Bash shell commands, not GitHub Actions YAML. Cargo and
ordinary npm packages get editable suggestions; generated npm targets, VS Code
extensions and other unsupported package types require your own commands.
Optional customization covers filenames, versioning, additional release groups
and the Actions revision. The current compatible Actions release is the default.

The CLI prints the inspected commit and current/proposed files, then asks before
creating or refreshing a setup PR. Unresolved requirements block apply. Merge
that PR yourself, then run `repositories discover` to refresh inspection of the
default branch.

For automation, pass a JSON choices file with `--choices choices.json` and save
the preview with `--output setup-plan.json`. That invocation only previews.
After reviewing the file, apply it with:

```sh
beepboop repositories adopt owner/repository --choices choices.json --output setup-plan.json --json
beepboop repositories adopt owner/repository --plan setup-plan.json --apply
```

`--json` prints the full preview without interactive prompts; without `--choices`
it returns the server's current proposal, including unresolved requirements.
Previewing enrolls the repository but does not write repository files.
`--apply` requires a
saved plan; it cannot skip review by combining it with new choices. The server
rejects changes to the source, choices, generated files, preset revisions or setup
branch since preview. The dashboard uses the same API and validation rules.

A choices file contains `streams` and optional `actionsRevision` (a release tag
or full published Actions commit). Each stream selects `name`,
`packages` (PURLs), `versioning`, `required`, `prepare` and `promote`. Workflow
choices contain `file`, optional `job`, `triggers` (`review`, `dispatchOnly`, or
`preserve`), `commands`, and `publicationSteps` mapping PURLs to publishing step
IDs. Existing integrated reporting needs no new mappings. Leaving trigger
conflicts unresolved produces a blocked preview rather than an implicit handover.
