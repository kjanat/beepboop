# Using Beepboop

## Add a repository

Install the GitHub App, open the dashboard and select **Inspect**. Beepboop
reads the default branch and lists its packages and release workflows.
Inspection reads the repository and never runs its code.

For a repository without a configuration, Beepboop builds the first proposal
from the existing release workflows. It reads the workflows, the local actions,
scripts and task recipes they run, and the repository's tags. It groups them
into release streams. Each tag family, manually dispatched release and scheduled
channel gets one stream. Each stream observes its existing workflows and keeps
their triggers. Adoption changes only `.github/beepboop.json`.

The setup PR body has a **Release plan** section. For each stream it lists:

- the starting trigger
- the workflows and their roles
- the version source and carriers
- the publication order per destination
- moving aliases
- the start command

It also names the evidence for each grouping. **Not ready to publish** lists
products that cannot publish yet, such as editor extensions without a publishing
workflow. Those products stay out of the stream's required publications. **Left
out** lists packages and workflows that no release publishes, with the reason.

Select **Configure releases**, or **Edit release setup** for an existing
configuration. Each inferred stream shows a checked **Keep … with their own
triggers** option. Clear it to configure that stream's workflows yourself.
Select the packages, then create a publishing workflow or pick an existing one.
A new workflow gets an editable filename based on the package or repository
name, a publishing job and the required dispatch trigger. Beepboop selects the
job in an existing workflow when the workflow has a single job or a recognized
integration. You choose a job only when its purpose is ambiguous.

When the repository has a `mise.toml`, `.mise.toml` or `.config/mise.toml`,
setup adds a `jdx/mise-action` step before the step that runs the commands. A
job that already uses `jdx/mise-action` keeps its own step.

Command boxes take Bash shell commands. For Cargo, npm and PyPI packages,
Beepboop suggests preparation commands, and `beepboop publish` as the
publication command. `beepboop publish` becomes an `actions/publish` step, as
[Publish through Beepboop](#publish-through-beepboop) describes. You can edit
every suggestion. For a publishing job in the repository's workflows, you can
map each package to one of its steps. Trigger replacement choices
appear only for existing workflows with automatic triggers.
[Adopt from the command line](#adopt-from-the-command-line) shows the same
choices as a JSON file.

Select **Beepboop opens the version PR (no preparation job)** when preparation
only edits versions in manifests or in configured `versionFiles`. Repositories
with lockfiles need a preparation workflow to regenerate them. See
[Release a shared version with lockfiles](#release-a-shared-version-with-lockfiles).
Tag-only packages
without a version file also need a preparation workflow.

For a new release workflow, preparation can run as a second job in the **same
file**. The dispatcher selects preparation or publication, and job conditions
keep the other job from running. Preparation runs before the release PR merges.
Publication runs after approval. You can still choose a separate preparation
workflow. Selecting managed PR preparation hides the unused job fields.

**Versioning and group settings** holds the versioning and release group
settings. Most repositories need one group. **Advanced settings** holds the
Actions revision override. Leave it empty to use the current compatible `v1`
release.

When you adopt an existing integration, setup adds the approved-commit checkout
to a job with no checkout or with one ordinary root checkout. A job with other
steps before `begin` needs explicit integration. In that job, install
dependencies and build artifacts after the approved-commit checkout. The
checkout cleans the workspace. Custom refs, other repositories and multiple
checkouts also need explicit integration.

Preview shows the inspected commit, the configuration and workflow changes, and
any unresolved requirements. An automatically triggered publishing workflow
moves under Beepboop approval only after you explicitly choose dispatch-only
triggers. The proposal keeps existing build and publish commands. You choose
missing commands and publication-step mappings. Matrix, reusable, dependent,
conditional and container jobs need explicit integration in a dedicated
workflow.

To propose workflow changes, the GitHub App needs **Workflows: write** as well
as contents and pull request permissions. The app manifest includes it.
Existing installations must approve the permission update, and preview blocks
apply until they do. A configuration-only setup PR works without Workflows:
write. Editing the manifest leaves the live app's permissions unchanged.

External integration actions use the compatible `v1` Actions release by
default. Advanced setups can override it with a release tag or a full
distribution commit SHA. When the repository contains
`actions/<name>/action.yml`, setup references that action as `$/actions/<name>`.

A setup PR publishes nothing. npm trusted-publisher setup is a separate step.
When the `begin` step of a promotion runs, Beepboop creates each JSR package the
promotion publishes and links it to the repository. It refuses a package that
is already linked to a different repository. It then turns off the JSR scope's
GitHub Actions actor verification, and runs that Beepboop starts can publish to
the scope. Beepboop makes these JSR calls with the credential stored as
`jsr-token`.

Select **Open setup PR** after you review the preview. A change to the source
commit or the setup branch invalidates the preview. Refreshing a proposal picks
up the current default-branch files and refuses human changes on the setup
branch. The dashboard also links earlier proposals. That list includes
proposals that the configuration on the default branch has replaced. Merge the
setup PR yourself, then refresh inspection.

The first setup PR uses the branch `automation/onboarding` and the title
`chore: configure release automation`. Once `.github/beepboop.json` exists on
the default branch, a setup PR uses `automation/setup-update`. Its title names
the kinds of change, such as `chore: update release setup (job timeouts)`, and
its description opens with each changed file and what changes in it against
the default branch.

The authenticated API has two setup routes.
`POST /api/repositories/setup/preview` takes `repository` and optional
`choices`. `POST /api/repositories/setup/apply` takes the same choices plus the
`planId`, `sourceSha` and `setupHead` that preview returned. Preview stores no
inspection and creates no branches. Apply recomputes the plan and checks those
values before it publishes the reviewed changes.

## Adopt from the command line

`beepboop repositories adopt` drives the same setup from a terminal. With
`--json` and no choices, it prints the inferred proposal, including its
`choices`, `blockers` and `notes`. Save `.choices` to a file, edit it, preview
it, and apply the saved preview:

```sh
beepboop repositories adopt owner/repo --json | jq .choices >choices.json
beepboop repositories adopt owner/repo --choices choices.json --output setup-plan.json
beepboop repositories adopt owner/repo --plan setup-plan.json --apply
```

The preview prints every file edit, blocker and note, and it exits with code 1
while a blocker remains. `--apply` opens or refreshes the setup PR from the
saved preview. Apply refuses the preview when the source commit, the choices or
the setup branch changed after it.

### Add crates.io publishing next to a tag-triggered workflow

Setup edits only the job that a workflow choice selects. It adds no publishing
job to an existing workflow. An existing workflow with `push` or tag triggers
blocks unless the choice sets `"triggers": "dispatchOnly"`. A dispatch-only
choice on a workflow with more than one job also blocks. Its blocker asks you to
split the selected job into a dedicated dispatch workflow first.

Setup leaves a large `release.yml` with a `push: tags` trigger as it is.
Observe it, and name a new file under `promote` for the crates. Setup creates
that file with a single `promote` job:

```json
{
  "streams": [
    {
      "name": "main",
      "packages": ["pkg:cargo/example-core", "pkg:cargo/example"],
      "versioning": "workspace",
      "required": ["pkg:cargo/example-core", "pkg:cargo/example"],
      "observe": [
        {
          "name": "release",
          "file": "release.yml",
          "ref": "refs/tags/v*",
          "publications": ["github-release:owner/repo"]
        }
      ],
      "prepare": {
        "file": "prepare-release.yml",
        "commands": "cargo check --workspace --all-targets\ncargo test --workspace"
      },
      "promote": {
        "file": "publish-crates.yml",
        "commands": "beepboop publish",
        "credentials": { "CARGO_REGISTRY_TOKEN": "crates-io" },
        "tagPrefix": "v"
      }
    }
  ]
}
```

- `packages` lists every package in the stream as a versionless PURL from
  `beepboop repositories show owner/repo`.
- `observe` leaves `release.yml` and its triggers unchanged. Beepboop tracks its
  runs from GitHub workflow-run events and attributes the listed
  `publications` to it. The promote workflow reports the remaining selected
  packages.
- `promote.file` names a new file. Setup creates it with
  `workflow_dispatch` inputs, `id-token: write`, the `begin` step and both
  checkouts. For `beepboop publish`, the `beepboop_publish` step runs
  `actions/publish`, which publishes every selected package and reports each
  outcome. Other `commands` run as Bash in that step, and a `report` step
  submits the results.
- `commands` is Bash for that one step, or `beepboop publish`. Setup suggests
  `beepboop publish` for a selection of only Cargo, npm and PyPI packages.
- `publicationSteps` maps a PURL to the `id` of the step that publishes it, for
  example `{"pkg:cargo/example-core": "publish_core"}`. In a new file the map
  can stay empty. Use it for a dispatch-only job that has its own `run` steps.
  The `report` step submits the outcome of each mapped step.
- `credentials` delivers a stored token to `beepboop_publish`. See
  [Publish a new crate for the first time](#publish-a-new-crate-for-the-first-time).
- `tagPrefix` adds `actions/token` and `actions/publish-refs` steps after
  `beepboop_publish`. They push the tag `v<version>` with a Beepboop App token.
  The `gitId` output of `actions/token` sets the App bot as the tagger. That
  push starts `release.yml`, and Beepboop observes the run. Setup adds the same
  identity to a kept `actions/publish-refs` step whose token comes from
  `actions/token`.

Setup never writes `"each": "package"`. A promotion from `beepboop release`
dispatches `publish-crates.yml` once, and `actions/publish` publishes every
crate in that run. Each crate claims a slot from the crates.io budget. Bash
`commands` claim no slots. A Bash run that publishes more than five new crates
can hit the crates.io burst limit.
`each` applies only to operations of a release set, which
`beepboop releases plan-set`, `prepare-set` and `start` run. Use it for an
`independent` stream whose crates release separately. Each run then publishes
one crate after the crates it depends on. For that case, add
`"each": "package"` to the binding in `.github/beepboop.json` by hand and add
the `package` input from [Paced publishing](#paced-publishing).

## Configure release streams

A stream groups operations and packages for a release. This example prepares
and promotes through branch workflows and observes publication from a tag:

```json
{
  "$schema": "https://beepboop.kjanat.dev/schema/v1.json",
  "streams": {
    "main": {
      "versioning": "workspace",
      "prepare": {
        "version": "manual",
        "workflow": { "file": "prepare.yml", "ref": "master" }
      },
      "promote": {
        "approval": "required",
        "workflow": { "file": "promote.yml", "ref": "master" }
      },
      "workflows": {
        "publish": {
          "file": "release.yml",
          "mode": "observe",
          "ref": "refs/tags/v*",
          "publications": ["pkg:npm/example-package"]
        }
      },
      "required": ["pkg:npm/example-package"],
      "credentials": ["npm-bootstrap"],
      "channels": { "stable": "latest", "prerelease": "next" }
    }
  }
}
```

| Setting            | Use                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versioning`       | `workspace`, `independent`, or `none` for maintenance operations.                                                                                                                                                                                                                                                                         |
| `packages`         | Package IDs to select, such as `pkg:cargo/example-core` or `pkg:npm/%40example/cli`. Independent streams can also select packages in the preparation request.                                                                                                                                                                             |
| `prepare.strategy` | `managed` lets Beepboop edit the versions. `workflow` runs your own preparation script.                                                                                                                                                                                                                                                   |
| `needs`            | Operation names that must complete before this workflow starts.                                                                                                                                                                                                                                                                           |
| `publications`     | Report IDs that this operation needs to complete.                                                                                                                                                                                                                                                                                         |
| `required`         | Publication IDs that the stream's release gate requires. An operation named `publish` uses this list by default.                                                                                                                                                                                                                          |
| `credentials`      | Credential aliases that the stream requests. Access also needs an administrator grant.                                                                                                                                                                                                                                                    |
| `concurrency`      | `queue`, or `supersede-pending` to cancel older undispatched operations.                                                                                                                                                                                                                                                                  |
| `promote.approval` | For a version raised without a start: `required` waits for your approval. `merge` releases the merge commit of a verified Beepboop preparation PR after its checks pass. `push` releases a verified default-branch commit with an unpublished manifest version after its checks pass. Without a value, a release waits for your approval. |
| `start`            | Where a release can start: `{ "via": "action", "workflow": "start-release.yml" }`, `{ "via": "dashboard" }` and `{ "via": "cli" }`, in any combination. See [Start a release](#start-a-release).                                                                                                                                          |
| `prepare.bump`     | `commit` pushes the version bump to the default branch as a signed Beepboop commit. `pr` opens a version PR. Without a value, Beepboop opens a version PR.                                                                                                                                                                                |

You select versions manually, and they follow SemVer. Select packages that
share a version source together. Dependencies name operations in the same
stream. Configuration validation rejects cycles and missing operations.

Observation refs accept one trailing `*`. Dispatched workflows need exact refs.

### Presets

Use `extends` to share configuration:

```json
{
  "extends": ["github>owner/release-presets:rust-workspace"],
  "streams": {
    "main": { "required": ["pkg:cargo/example-core", "pkg:cargo/example-cli"] }
  }
}
```

Publish the [preset templates](../presets/) in your preset repository before you
reference them. Presets merge in order, and the local configuration merges last.
Objects merge by key. Arrays replace the inherited array. Each execution saves
the resolved preset commit SHAs. On refresh, Beepboop validates the
configuration with the schema that generates
[schemas/v1.json](../schemas/v1.json).

## Connect a workflow

`actions/begin` registers the operation, and `actions/report` submits its
publication results. `v1` follows the latest compatible Actions release. Pin
`vX.Y.Z` or a distribution commit for a fixed version. This example observes
tag-triggered publishing:

```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: kjanat/beepboop/actions/begin@v1
        id: release
        with:
          stream: main
          operation: publish
          version: ${{ github.ref_name }}
      # Build and publish here. Generate the report JSON from those results.
      - uses: kjanat/beepboop/actions/report@v1
        with:
          publications: >-
            [{"id":"pkg:npm/example-package","manager":"npm",
            "name":"example-package","version":"1.2.3",
            "digest":"sha512-EXPECTED_INTEGRITY",
            "outcome":"succeeded","required":true}]
```

Replace the sample report with your publisher's version and digest.

For dashboard dispatch, set the binding to `mode: "dispatch"` with an exact ref.
Add these workflow inputs and the run name, and pass `beepboop_execution_id` to
`begin` as `execution-id`:

```yaml
run-name: ${{ inputs.beepboop_title || github.workflow }}
on:
  workflow_dispatch:
    inputs:
      beepboop_execution_id:
        type: string
        required: true
      beepboop_title:
        type: string
        required: false
```

Beepboop sends `beepboop_title` as the operation, package and version, followed
by the first eight characters of the execution ID. An example is
`Release 0.1.0 (f4feef47)`. A workflow without the `beepboop_title` input must
use the run name `Release operation ${{ inputs.beepboop_execution_id }}`.

`begin` outputs `execution-id` and a JSON `context`, and it sets
`BEEPBOOP_EXECUTION_ID` for later steps. Call `begin` in each participating
job. The context holds the requested version and the source commit. Calls from
the same observed run, stream and operation attach to the same execution.

## Publish through Beepboop

`actions/publish` publishes an execution's Cargo, PyPI and npm packages and
tracks each one in Beepboop's publication ledger. Call it after `begin` and the
checkout of `context.sourceSha`:

```yaml
- uses: kjanat/beepboop/actions/publish@v1
  with:
    execution-id: ${{ steps.beepboop.outputs.execution-id }}
    credentials: '{"CARGO_REGISTRY_TOKEN":"crates-io"}'
```

Beepboop plans the binding's `publications`, or the stream's `packages` when
the binding lists none. It hands out each package after the packages it depends
on in the repository have published, also when another stream releases them
from the same commit. A promotion whose workflow calls `actions/publish` starts
right away, and its packages wait for those streams in the ledger.

For each package the action:

1. builds the artifact with `cargo package --locked`, `uv build` or `npm pack`,
2. checks the package contents and metadata,
3. claims the package with the artifact's digest,
4. runs `cargo publish --locked --no-verify`,
   `uv publish --check-url https://pypi.org/simple/` or
   `npm publish --access public --tag <channel>`,
5. reports the outcome.

The contents check needs these items in each package:

| Manager | README                                      | License file                                                                      | Metadata                                                                      |
| ------- | ------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `cargo` | `cargo package --list` lists one            | `cargo package --list` lists `LICENSE*`, `LICENCE*`, `COPYING*` or `license-file` | `cargo metadata` has `description`, `license` or `license-file`, `repository` |
| `npm`   | the `npm pack --json` file list has one     | the `npm pack --json` file list has `LICENSE*`, `LICENCE*` or `COPYING*`          | the packed `package.json` has `description`, `license`, `repository`          |
| `pypi`  | the sdist `PKG-INFO` has a long description | the sdist root or `LICENSES/`, or the wheel `.dist-info/licenses/`, has one       | `PKG-INFO` has a license and a `Project-URL` or `Home-page`                   |

File name patterns ignore case.

A package that lacks an item fails before its claim. The failure names the
package and each missing item, and the action publishes nothing for it.

Before the first Cargo build, the action runs `rustup toolchain install` when
the checkout has a `rust-toolchain.toml` or `rust-toolchain` file. It reads
`cargo metadata` and `npm pack --json` from standard output only.

npm publishes with `--provenance` when the workflow event names a public
repository. The channel is the stream's `channels.stable`, or
`channels.prerelease` for a prerelease version.

Beepboop checks the registry before each claim and after each report. It
compares the crates.io checksum, the PyPI sha256 or the npm integrity with the
claimed digest. Only a 404 response proves that a version is missing. Beepboop
treats any other registry error as unknown and asks again.

| State              | Meaning                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| `planned`          | Waits for its turn.                                                             |
| `claimed`          | A run holds a 15-minute lease and publishes it.                                 |
| `published`        | The registry lists the claimed digest after the publish.                        |
| `reused`           | The registry already listed the claimed digest.                                 |
| `rate-limited`     | The registry refused it until the `Retry-After` time.                           |
| `failed-retryable` | The build, the publish or a dependency failed. The next run attempt retries it. |
| `failed-permanent` | The registry lists a different digest.                                          |

`credentials` maps environment variables to granted aliases. The action fetches
the values through the grant check and passes them to the publish command only.
`NODE_AUTH_TOKEN` or `NPM_TOKEN` also authenticates npm to registry.npmjs.org.
Without a credential, uv and npm use trusted publishing.

Claims for crates draw from the crates.io budget in
[Paced publishing](#paced-publishing). The action waits for its crates.io slot.
A 429 response moves that budget past its `Retry-After` time, and the action
waits for that time too. A wait longer than 30 minutes ends the run. Beepboop
dispatches a new run at the end of the wait, and that run publishes the package.
After five rate limits in one run, the package fails for that run.

The action exits nonzero when a required package did not publish, after every
package has its outcome. Beepboop stores each outcome on the execution. The
workflow needs no `actions/report` step for these packages.

## Start a release

A start approves the whole release. After it, Beepboop runs the version bump,
the publication, the binaries, the tags and the GitHub release without asking
again. Failing checks or package metadata problems stop the release with a
reason on the runs page. Each stream enables its starts in `start`:

```json
{
  "streams": {
    "main": {
      "start": [
        { "via": "action", "workflow": "start-release.yml" },
        { "via": "dashboard" },
        { "via": "cli" }
      ],
      "prepare": { "strategy": "managed", "bump": "commit" },
      "promote": { "approval": "required", "workflow": { "file": "release.yml" } }
    }
  }
}
```

- **GitHub Actions.** Run the **Start release** workflow, `start-release.yml`,
  from the Actions tab. Pick a stream and a `patch`, `minor` or `major` bump,
  or type a version, which replaces the bump. Setup generates the workflow when
  you tick `action`. Its one step
  runs `kjanat/beepboop/actions/release@v1`. The action proves the run with
  GitHub OIDC and asks Beepboop to start the release. Beepboop accepts only a
  `workflow_dispatch` run of the named file on the default branch, at the
  commit Beepboop knows as the branch head.
- **Dashboard.** Choose the stream and version on the Releases page and select
  **Release**.
- **CLI.** Run `beepboop release [patch|minor|major|VERSION]` in a checkout, or
  pass `--repository owner/repo` and `--stream main`.

With `"bump": "commit"`, Beepboop pushes `chore(release): <version>` to the
default branch as a signed bot commit, and the release publishes that commit
once its checks pass. When branch protection refuses the push, the
preparation fails with GitHub's reason. Let the Beepboop app push to the
branch, or set `"bump": "pr"`. With `"bump": "pr"`, Beepboop opens the version
PR, and merging it continues the release without another approval.

A start through a channel the stream does not list prepares the release as
before, and the version follows `promote.approval`. A version raised on the
default branch without a start also follows `promote.approval`.

## Prepare and promote

Choose the stream and version in the dashboard and select **Release**. When the
manifests already carry the version, Beepboop creates the promotion and waits
for your approval. Otherwise preparation runs in one of two ways:

- **Managed.** Beepboop calculates the manifest edits. A preparation workflow
  checks out `context.sourceSha` and calls `actions/prepare` with `mode: apply`
  and the `context` output. The workflow then runs lockfile generators and
  checks, and calls the action again with `mode: submit`. Beepboop creates the
  release PR. It accepts changes to the planned manifests and to existing
  lockfiles.
- **Workflow.** Set `prepare.strategy: "workflow"`. Your preparation script
  reads the version and source SHA from the context and creates its own PR or
  candidate. Use this strategy for custom generated files or for dependency
  ranges that need project logic.

[Release a shared version with lockfiles](#release-a-shared-version-with-lockfiles)
follows a managed preparation from the CLI command to the signed tag.

The dashboard can create the preparation PR directly when the plan needs no
lockfile regeneration. When Beepboop updates an existing preparation branch, it
checks the branch head and the generated file contents. Manual edits produce a
conflict for review.

Merge the preparation PR, choose the promotion commit and approve it in the
dashboard. Repeating an operation for the same release attaches to its existing
execution. You can retry failed jobs from the execution page. An ambiguous
workflow dispatch offers reconciliation. If a promotion was cancelled before
its first dispatch, retrying it returns it to approval.

### Release a shared version with lockfiles

This walkthrough releases a `workspace` stream in a repository with
`Cargo.lock`, `package-lock.json` and `uv.lock`. Beepboop treats `Cargo.lock`,
`package-lock.json`, `bun.lock`, `pnpm-lock.yaml`, `yarn.lock` and `uv.lock`
as lockfiles. Unless the stream observes a workflow, setup blocks the proposal
until the stream has a `prepare` workflow choice.

Setup suggests preparation commands only when every selected package is a Cargo
crate or every one is an npm package:

- For Cargo it suggests `cargo check --workspace --all-targets` and
  `cargo test --workspace`. `cargo check` rewrites the workspace versions in
  `Cargo.lock`.
- For npm with a `package-lock.json` it suggests
  `npm install --package-lock-only`, `npm ci` and `npm run test --if-present`.
  With `bun.lock`, `pnpm-lock.yaml` or `yarn.lock`, it suggests that manager's
  install command instead.
- It appends `uv lock` to either suggestion when the repository has a
  `uv.lock`.

A mixed workspace needs its own commands.
Beepboop edits versions in `Cargo.toml` and `package.json` and has no Python
manager. Add `pyproject.toml` as a version file to carry the version there.
These fields go in the stream's entry in the choices file:

```json
{
  "versionFiles": [{ "path": "pyproject.toml", "format": "toml", "key": ["project", "version"] }],
  "prepare": {
    "file": "prepare-release.yml",
    "commands": "cargo update --workspace\nnpm install --package-lock-only\nuv lock\ncargo test --workspace --locked\nnpm ci\nnpm test"
  }
}
```

With a mise configuration, the `jdx/mise-action` step installs `uv` and the
other tools before the commands run. Without one, the commands must install
any tool that the runner lacks.

1. Run `beepboop release minor` in a checkout of the repository. The command
   resolves the GitHub repository from the `origin` remote. Pass
   `--repository owner/repo` or `--stream main` to choose them explicitly.
2. The server plans from the default branch. Local commits and uncommitted
   files have no effect on the plan. The command prints the current and new
   version of each package and every planned manifest edit. Confirm the prompt,
   or pass `--yes`.
3. Beepboop dispatches `prepare-release.yml`. After `begin` and the
   approved-commit checkout, `actions/prepare` with `mode: apply` writes the
   planned manifest edits. It refuses when a manifest changed after planning.
4. The `Prepare and validate` step runs the commands, which regenerate the
   lockfiles and run the tests.
5. `actions/prepare` with `mode: submit` sends the planned manifests, every
   lockfile and every other changed tracked file to Beepboop. Beepboop refuses
   the submission when a lockfile from the source commit is missing, when a
   planned manifest differs from the plan, or when any other file changed. It
   then opens the release PR.
6. Review and merge the release PR.
7. After the merge, Beepboop creates a promotion when the manifests carry an
   unreleased version. A release that a start approved continues by itself.
   Otherwise the promotion follows `promote.approval`, which setup writes only
   when you tick it. With `"approval": "push"`, Beepboop approves the promotion
   itself once the commit has a verified signature and passing checks. With
   `"approval": "required"`, approve the promotion in the dashboard, or run
   `beepboop runs approve <execution-id> --sourceSha <merge-commit-sha>`.
   `beepboop runs list` prints the execution ID.
8. Approval requires a verified commit signature, passing checks and a branch
   head that still points at that commit. `--force` approves despite a failed
   signature or check. Approval also requires complete package metadata, as
   described in [Package metadata](#package-metadata). `--force` does not
   override that check.
9. Beepboop dispatches the promote workflow on the default branch, and the job
   checks out the merge commit. Its `beepboop_publish` step runs
   `actions/publish`, which publishes the packages and reports each outcome.
   `actions/token` then issues an App token, and `actions/publish-refs` pushes
   the version tag. When the Worker has the `SIGNER` binding, Beepboop signs
   that tag. Beepboop completes the release after the run, once it has verified
   every required publication.
10. In a new promote workflow with a `tagPrefix`, setup adds
    `actions/publish-release` after `actions/publish-refs`. It publishes the
    GitHub release for the tag. A promote choice with `binaries` also uploads
    the assets to the draft release first. See [Binary builds](#binary-builds).

## Package metadata

Discovery checks each publishable Cargo crate, npm package and Python project
in the default branch:

- A crate needs a README, `description`, `license` or `license-file`, a
  license file and `repository`. Cargo's `readme` field names the README.
  Without that field, the crate directory needs `README.md`, `README.txt` or
  `README`. The license file is the `license-file` path, or a `LICENSE*`,
  `LICENCE*` or `COPYING*` file in the crate directory. Beepboop follows
  `field.workspace = true` to `[workspace.package]`.
- An npm package needs a `README` file and a license file next to
  `package.json`, and `description`, `license` and `repository` in
  `package.json`.
- A Python project needs `readme`, `license` or `license-files`, and `urls` in
  `[project]`, or the field in `dynamic`. Its license file is `license.file`, a
  `license-files` match, a file in `LICENSES/`, or a license file next to
  `pyproject.toml`.

A symlink counts as the file it names. A missing license file reads `lacks a
license file`.

A promotion for a stream with an incomplete package waits in
`awaiting-approval`. Its reason on the runs page starts with `Fix the package
metadata before this release:` and names each package, its manifest and the
missing items. Approval refuses it, also with `--force`. A push that completes
the metadata creates a promotion for the new commit.

The setup PR lists the same problems for every selected package. The setup
PR stays mergeable. `actions/publish` checks the built package again before it
claims it. See [Publish through Beepboop](#publish-through-beepboop).

## Publication results

Reports contain a `publications` JSON array and an optional `artifacts` JSON
array. The workflow's OIDC identity binds each report to its repository, run
and attempt.

| Manager          | Result fields and checks                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `cargo`          | Crate name, version, optional expected archive checksum.                                                                           |
| `npm`            | Package name, version, integrity, optional distribution channel.                                                                   |
| `oci`            | `ghcr.io/owner/image` or `docker.io/owner/image`, version tag, required `sha256:` digest, optional channel.                        |
| `github-release` | `owner/repository`, tag as version, release commit matching the source SHA.                                                        |
| `manifest`       | Public `owner/repository/path.json` or `.rb`, version, required `sha256:` content digest. Beepboop checks the default-branch file. |
| `go`             | Module path, version without `v`, optional expected origin commit. Beepboop checks `proxy.golang.org`.                             |
| `goreleaser`     | Project name, version without `v`. The `v<version>` GitHub release must be public with every asset uploaded.                       |
| `vscode`         | Extension ID `publisher.name`, version. Beepboop checks the Visual Studio Marketplace.                                             |
| `workflow`       | Authenticated workflow result with optional artifacts.                                                                             |

Artifact fields are `id`, `runId`, `name`, `digest` and `expiresAt`. Beepboop
checks them against GitHub's API.

Every required publication must succeed. Missing or skipped required results
block completion. A registry outage produces an uncertain result. Beepboop
shows optional failures next to the required results.

## Paced publishing

Set `"each": "package"` on a workflow binding to run it once per package in a
release set. [Add crates.io publishing next to a tag-triggered
workflow](#add-cratesio-publishing-next-to-a-tag-triggered-workflow) compares it
with a single publishing run. Beepboop dispatches one run for every required
package of the release group. When the binding sets `publications`, Beepboop
dispatches runs only for those packages:

```json
{
  "workflows": {
    "publish": { "file": "publish-crate.yml", "ref": "master", "each": "package" }
  }
}
```

Each run receives the package ID, such as `pkg:cargo/example-core`, as the
`package` input next to `beepboop_execution_id`:

```yaml
on:
  workflow_dispatch:
    inputs:
      beepboop_execution_id: { type: string, required: true }
      package: { type: string, required: true }
```

Runs follow the repository's publication order. A package waits for the
packages it depends on. Per-package bindings run only inside a release set.
They cannot declare outputs, artifact inputs or refs.

Beepboop schedules per-package crate runs within crates.io's
[rate limits](https://github.com/rust-lang/crates.io/blob/main/src/rate_limiter.rs).
It keeps one crates.io budget for all of its repositories:

| Publication                    | Burst | Then         |
| ------------------------------ | ----- | ------------ |
| A crate's first version        | 5     | 1 per 10 min |
| A new version of a known crate | 30    | 1 per minute |

Beepboop counts a crate as new until it has seen a published version of it. The
Runs page shows when a waiting crate will publish.

If the registry still refuses a publish, report the publication as
`rate-limited` with the registry's `Retry-After` time. Beepboop moves the
budget past that time and dispatches the package again afterwards. Beepboop
leaves the refusal out of the failed-attempt count.

```json
[{
  "id": "pkg:cargo/example-core",
  "manager": "cargo",
  "name": "example-core",
  "version": "1.2.3",
  "outcome": "rate-limited",
  "retryAfter": "Tue, 03 Nov 2026 10:20:00 GMT",
  "required": true
}]
```

`actions/report` converts a `Retry-After` value in `retryAfter` to ISO 8601.
The value can be delay seconds or an HTTP date. The report API itself accepts
ISO 8601 timestamps.

## Credentials

Store a value under a credential alias, then grant access to a repository,
operation, workflow, ref and optional environment. Beepboop asks for
confirmation before it overwrites an existing alias. These actions need a fresh
touch of an enrolled security key:

- setting a value
- revealing a value
- granting and revoking access
- copying values to GitHub

From a terminal, pipe the value in or type it at the hidden prompt:

```sh
printf %s "$TOKEN" | beepboop secrets set npm-token
beepboop secrets set npm-token
```

An interactive overwrite asks `Overwrite secret <alias> (version N)?` and stops
unless you answer yes. A piped value overwrites without asking. The command
prints the saved version. `beepboop secrets list` shows aliases, versions and
grants.

Choose a delivery method:

| Delivery      | How the workflow receives it                                                   |
| ------------- | ------------------------------------------------------------------------------ |
| `runtime`     | `actions/credentials`, with a JSON `aliases` input and a JSON `values` output. |
| `repository`  | Beepboop copies the value to a GitHub repository secret.                       |
| `environment` | Beepboop copies the value to a GitHub environment secret.                      |

Runtime retrieval also requires the alias in the stream's `credentials` list.
`actions/credentials` masks the values before it writes its outputs.

A workflow setup choice can map environment variables to aliases, for example
`"credentials": { "CARGO_REGISTRY_TOKEN": "crates-io" }`. Setup then makes
three changes:

- It adds the aliases to the stream's `credentials`.
- It adds a `beepboop_credentials` step that runs `actions/credentials`.
- It sets the variables on the step that runs the setup commands.

[Publish a new crate for the first time](#publish-a-new-crate-for-the-first-time)
walks through this mapping for a crates.io token.

The preview names the `beepboop secrets grant` command for each alias. The
dashboard shows the synchronization result for each destination and credential
version.

Revoking a grant stops future access through it. When you remove access, delete
the synchronized GitHub secrets separately and rotate any credential that a
workflow already received.

See [deployment](deployment.md) for encryption keys, login and security-key
enrollment.

### Publish a new crate for the first time

crates.io trusted publishing works only for a crate that already exists. The
first version of a new crate needs an API token. Create a crates.io API token
with the `publish-new` and `publish-update` scopes, then follow these steps:

1. Store the token with
   `printf %s "$TOKEN" | beepboop secrets set crates-io`.
2. Add `"credentials": { "CARGO_REGISTRY_TOKEN": "crates-io" }` to the
   `promote` workflow choice. Setup adds this mapping for generated crate
   publishing itself. It adds `crates-io` to the stream's `credentials` list.
   With `beepboop publish`, setup passes the mapping to `actions/publish` as
   its `credentials` input. With Bash `commands`, setup inserts a
   `beepboop_credentials` step that runs `actions/credentials` before
   `beepboop_publish`, and sets `CARGO_REGISTRY_TOKEN` on `beepboop_publish`
   from that step's `values` output. The preview notes print the grant command.
3. Merge the setup PR. A runtime grant requires the alias in the merged
   `credentials` list.
4. Grant the promote workflow access:

   ```sh
   beepboop secrets grant owner/repo crates-io --stream main --operation promote
   ```

`--operation` defaults to `promote`, and `--stream` defaults to the only
configured stream. `--delivery` defaults to `runtime`. A runtime grant covers
the operation's workflow file and ref, and the job's GitHub environment. Pass
`--environment <name>` when the publishing job sets `environment:`.
`actions/publish` or `actions/credentials` then fetches the value during the
run.

The other two deliveries copy the value into a GitHub secret:

- `--delivery repository --secretName CARGO_REGISTRY_TOKEN` targets a
  repository secret.
- `--delivery environment --environment release --secretName CARGO_REGISTRY_TOKEN`
  targets an environment secret.

Copy the value with **Copy latest value to GitHub** on the Secrets page.
`actions/publish` and the generated `beepboop_credentials` step read only
runtime grants. A workflow with a copied secret reads
`${{ secrets.CARGO_REGISTRY_TOKEN }}` itself.

After the first release, set up trusted publishing on crates.io. Open the
crate's **Settings**, then **Trusted Publishing**, and add a GitHub publisher:

- the repository owner and the repository name
- the workflow filename, such as `publish-crates.yml`
- the job's environment, if the job sets one

Then edit the promote workflow. Add a `rust-lang/crates-io-auth-action@v1`
step before `beepboop_publish`, remove the `credentials` input, and set
`CARGO_REGISTRY_TOKEN` from the auth step's `token` output:

```yaml
- uses: rust-lang/crates-io-auth-action@v1
  id: auth
- id: beepboop_publish
  name: Publish selected packages
  uses: kjanat/beepboop/actions/publish@v1
  with:
    execution-id: ${{ steps.beepboop.outputs.execution-id }}
  env:
    CARGO_REGISTRY_TOKEN: ${{ steps.auth.outputs.token }}
```

The build commands of `actions/publish` see this variable too.

The generated job already has `id-token: write`. `beepboop secrets list` prints
the grant ID. Remove the grant with `beepboop secrets revoke <grant-id>`, and
revoke the API token on crates.io. A crate that you add later needs a token for
its first version again.

## Repository token

`actions/token` gives a workflow a Beepboop App installation token for its own
repository. Pushes and pull requests that use this token start workflow runs.
Pushes and pull requests that use `GITHUB_TOKEN` start none.

The job needs `id-token: write`. The repository must belong to the owner
account. The owner account must have started the run, or a Beepboop operation
must have dispatched it. Push runs and same-repository `pull_request` runs
qualify. Beepboop refuses `pull_request_target` runs. Unenrolled repositories
qualify too. Other bots, apps and users get no token.

```yaml
- uses: kjanat/beepboop/actions/token@v1
  id: beepboop
  with:
    permission-contents: write
    permission-pull-requests: write
- run: gh pr comment "$PR" --body "Done."
  env:
    GH_TOKEN: ${{ steps.beepboop.outputs.token }}
```

The action takes `permission-contents`, `permission-pull-requests`,
`permission-issues`, `permission-checks`, `permission-statuses` and
`permission-metadata`, each `read` or `write`. It also takes the same
permissions as one `permissions` JSON object, such as
`{"contents":"write","pull_requests":"write"}`. The action refuses a step that
sets both forms. Without either form, the token gets contents and pull requests
write. Outside the `publish-actions` purpose, the token route refuses every
other permission.

The action also outputs `bot-login`, `bot-id` and `bot-email`. Beepboop
resolves them from the configured App and its GitHub bot user. Use those outputs
for the Git author and committer identity, and use the installation token to
authenticate the push. The `gitId` output holds the same identity as a JSON
object of `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and
`GIT_COMMITTER_EMAIL`. Insert it into a step environment. GitHub evaluates a
step's `env` even when an earlier failure skips the step, so fall back to an
empty object:

```yaml
env:
  "${{ insert }}": ${{ fromJSON(steps.beepboop.outputs.gitId || '{}') }}
```

The audit log records every token that Beepboop issues.

A run that Beepboop dispatched passes its execution ID:

```yaml
- uses: kjanat/beepboop/actions/token@v1
  with:
    execution-id: ${{ inputs.beepboop_execution_id }}
```

Beepboop checks that the run is that execution's dispatch. The repository,
workflow file and ref must match, and so must the run ID that GitHub returned
for the dispatch. Without a recorded run ID, the run name must match the title
that Beepboop sent. Dispatched runs cannot request the `publish-actions`
purpose.

Actions publication uses `purpose: publish-actions` and requests exactly
`contents: write` and `workflows: write`. Set `permission-workflows: write` for
this purpose. The distribution tree includes workflow files. The token route
requires an owner-started `workflow_dispatch` or `push` run of
`.github/workflows/publish-actions.yml` at the current default-branch SHA. The
source and workflow SHAs must match, and the run must have no reusable workflow
identity. PR runs, other workflow files and stale revisions cannot obtain this
token. Deploy the service through Cloudflare Builds before you use the updated
action. The App installation must have approved Contents and Workflows write
access. The action leaves installation permissions unchanged.

## Subscriptions

Start an operation when a package changes:

```json
{
  "subscriptions": [
    {
      "id": "refresh-tool",
      "source": "npm:example-tool",
      "event": "package.version.changed",
      "stream": "maintenance",
      "operation": "refresh"
    }
  ]
}
```

The source is `<registry>:<package-name>` for an npm or JSR package. Beepboop
polls every [watched package](#watched-packages) on its schedule and fires the
event once per new version. Event IDs deduplicate delivery.

A `release` subscription names a source repository. It fires after the
repository's required publications succeed. A `workflow_run` subscription also
names an exact `workflow` filename. It fires after that workflow completes
successfully.

For scheduled work, add a five-field UTC cron expression to a workflow binding:

```json
{
  "file": "refresh.yml",
  "ref": "master",
  "schedule": "17 6 * * *"
}
```

Scheduling starts at enrollment. Each reconciliation pass processes up to 100
missed ticks per schedule and saves its position for the next pass.

## Watched packages

The Packages page lists every npm and JSR package that an enrolled repository
publishes or subscribes to, plus packages you add by hand. Beepboop checks each
package every ten minutes. The first check of an already published package
records its version. Later versions start matching subscriptions and send
notifications. The first release of a package that was still unpublished at its
first check does the same.

## Notifications

A destination posts to a Slack Incoming Webhook or to an HTTPS webhook. Its URL
is a [credential](#credentials). Choose the credential name when you add the
destination. Saving a destination needs only the signed-in administrator
session. The URL itself stays in the credential.

From a terminal:

```sh
beepboop notifications add --name "Slack #releases" --kind slack --secret slack-releases --subscribe-new
beepboop notifications subscribe "$DESTINATION_ID" npm:example-tool
beepboop notifications list
```

Turn on **Notify about newly watched packages** to subscribe a destination to
every package that Beepboop starts watching. Toggle individual packages on the
Packages page.

HTTP destinations receive this JSON with an `Idempotency-Key` header equal to
`id`:

```json
{
  "id": "package:npm:example-tool@1.3.0",
  "type": "package.version.changed",
  "package": { "registry": "npm", "name": "example-tool" },
  "version": { "previous": "1.2.0", "current": "1.3.0" },
  "url": "https://www.npmjs.com/package/example-tool"
}
```

Beepboop retries a failed delivery on each scheduled pass, up to five attempts.
It retries network failures and responses with status 408, 425, 429 or 5xx. Any
other unsuccessful response fails immediately.

## Version selection and release refs

The preparation API accepts `version` as a string or as one of these request
objects: `{"bump":"patch"}`, `{"bump":"minor"}`, `{"bump":"major"}`,
`{"bump":"prerelease","base":"minor","identifier":"alpha"}`,
`{"bump":"next"}` or `{"bump":"stable"}`. The dashboard offers the same
choices. Increment requests require a synchronized selection. Select
independent version groups separately. A stream can derive its current version
from tags with `"versionSource":{"kind":"tags","prefix":"v"}`. The first
release needs an explicit version.

A workflow binding can declare `refs` with `phase` set to `"version"` or
`"aliases"`, a `prefix` (default `v`), `aliases: ["major", "minor"]` and
`signed` (default false). Ref operations require promotion approval. A ref
operation must be the promotion operation or depend on it. Use
`actions/publish-refs` after `begin`, and pass the repository token as `token`.
Git needs a tagger identity for an annotated tag. Insert the `gitId` output of
`actions/token` into the step environment.

When the Worker has the `SIGNER` service binding to the `Signer` entrypoint of
gpg-signing-service, Beepboop signs every new version tag regardless of
`signed`. It signs the planned tag object with that key's primary user ID as
tagger. The action writes the tag with `git mktag` and checks it with
`git verify-tag`. Without the binding, `signed: true` makes the action run
`git tag -s` with the runner's own Git signing key. GitHub must report a signed
version tag as verified. For that, the key's email must belong to the repository
owner's GitHub account. Alias operations should depend on the publication
operations they distribute.

A version operation also tags every Go module that the stream lists in
`packages`. Each tag uses the module's own prefix, such as `go/v1.2.3` for a
module in `go/`.

Setup writes `refs` with `phase: "version"` for binary releases and for a
promote setup choice with `tagPrefix`, such as `"tagPrefix": "cli-v"`. The
generated `publish-refs` step pushes with a Beepboop App token from
`actions/token`. A push with `github.token` starts no other workflows, and a
workflow that the version tag triggers would never run.

The action publishes an authorized plan with atomic Git pushes and explicit
expected old object IDs. Version tags target one commit. Stable aliases exclude
prereleases and reject downgrades. Beepboop checks the resulting refs before it
completes the operation. Beepboop reserves `refs:` report IDs for this check.

When a dispatched operation lists `github-release:<owner>/<repo>` in its
`publications`, Beepboop creates a draft release before it dispatches the run.
The draft has the tag `<prefix><version>` and targets the approved commit.
Beepboop marks the draft as a prerelease for prerelease versions. The run's
`context.draftRelease` holds the draft's `id` and `tag`. Upload release assets
to the draft during the run:

```sh
gh release upload "$TAG" target/package/*.crate
```

Repositories with immutable releases accept assets only before publication.

After the version tag exists, `actions/publish-release` publishes the GitHub
release:

```yaml
- uses: kjanat/beepboop/actions/publish-release@v1
```

The operation must list `github-release:<owner>/<repo>` in its `publications`.
Like ref operations, it requires promotion approval. Beepboop requires the
annotated tag `<prefix><version>` to target the approved commit. It then
publishes the operation's draft with its uploaded assets. It refuses while an
upload is unfinished. For an operation without a draft, Beepboop creates the
release, or accepts an existing published release whose tag and prerelease flag
match. Beepboop records the release as the operation's `github-release`
publication.

Beepboop writes the release notes when it publishes or creates the release. It
asks GitHub to generate them, then drops each `by @<name>[bot]` attribution and
each bot entry under `New Contributors`. The notes replace the whole release
body. A retried publication leaves one copy.

### Binary builds

A publication workflow can build binaries for its GitHub release. Setup
proposes a build for each binary target of a discovered Cargo crate, `src/main.rs`
or a `[[bin]]` entry, and for each Go `main.go` at a module root or below it.
It skips Go directories named `internal`, `testdata`, `vendor` or `examples` and
nested modules. The setup PR lists every build and every target as a checkbox
under the publication workflow.

Setup proposes all six targets unless the crate needs Unix. A crate needs Unix
when its unconditional `[dependencies]`, followed through workspace path
dependencies, include `nix`, `uzers`, `users`, `termios`, `daemonize`, `fork`,
`pty-process`, or `rustix` with a feature other than `std`, `alloc`, `core`,
`net`, `event`, `use-libc` or `rustc-dep-of-std`. Setup then leaves out the
Windows targets and names the dependencies in the PR. A ticked target stays
ticked. When a build is expected to fail on it, the box reads
`windows-amd64 (tool expected to fail)` and a note names the dependencies.
Setup never unticks a target and never blocks on one. Target-specific
dependencies such as `[target.'cfg(unix)'.dependencies]` do not count. Setup
proposes builds only for a workflow whose binding has no `setup` object yet. A
binding with one keeps its builds, including none.

The builds live in the binding's `setup.binaries`:

```json
{
  "binaries": {
    "builds": [
      { "toolchain": "go", "name": "gpg-sign", "module": "client", "package": "./cmd/gpg-sign" },
      { "toolchain": "cargo", "name": "tool", "manifest": "tool/Cargo.toml" }
    ],
    "targets": [
      "linux-amd64",
      "linux-arm64",
      "darwin-amd64",
      "darwin-arm64",
      "windows-amd64",
      "windows-arm64"
    ]
  }
}
```

`targets` defaults to all six platforms. Setup generates a `begin` job and one
matrix job per build. The `begin` job alone holds `id-token: write`. It runs
`begin` and outputs the approved commit and version. Go builds cross-compile on
`ubuntu-latest` with `CGO_ENABLED=0` and set `main.version`. Cargo builds run on
a native runner for each target. Each build job has only `contents: read`. It
checks out the approved commit, builds it and uploads its file as an artifact.

The publication job publishes its packages first, then runs these steps:

1. It downloads every artifact and writes `checksums.txt`.
2. It generates an SPDX SBOM named `<repository>.spdx.json` with
   `anchore/sbom-action`.
3. It attests build provenance and the SBOM for every checksummed file with
   `actions/attest`.
4. It uploads the files to the draft release.
5. It publishes the version tag with `actions/publish-refs` and the release
   with `actions/publish-release`.

The workflow binding lists `github-release:<owner>/<repo>` in `publications`
and declares `refs` with `phase: "version"`.

In an existing workflow, setup adds the `begin` and build jobs and makes the
selected job wait for the builds. It inserts the upload steps before the job's
first `token`, `publish-refs` or `publish-release` step. Without those, it adds
the release steps before the `report` step, or after the `actions/publish`
step. In a workflow that shares preparation and publication, the `begin` and
build jobs run only for `beepboop_operation: publish`. A job that already
carries the name `begin` or a build job's name must be a Beepboop binary build.
When the job already uploads binaries, setup replaces its generated release
steps, from the artifact download through `publish-release`. Unticking every
build removes the `begin` and build jobs and the upload steps.

Setup pins every third-party action it writes to a full commit SHA and adds the
release version as a comment, for example
`actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`. The
pinned `anchore/sbom-action` installs the Syft release that its commit names.

Each build names its files with `asset`. The default is
`{name}-{go.os}-{go.arch}{ext}` for Go and `{name}-{rust.target}{ext}` for
Cargo. The placeholders resolve as follows:

| Placeholder       | linux-amd64                | darwin-arm64           | windows-amd64            |
| ----------------- | -------------------------- | ---------------------- | ------------------------ |
| `{go.os}`         | `linux`                    | `darwin`               | `windows`                |
| `{go.arch}`       | `amd64`                    | `arm64`                | `amd64`                  |
| `{rust.target}`   | `x86_64-unknown-linux-gnu` | `aarch64-apple-darwin` | `x86_64-pc-windows-msvc` |
| `{node.platform}` | `linux`                    | `darwin`               | `win32`                  |
| `{node.arch}`     | `x64`                      | `arm64`                | `x64`                    |
| `{uname.os}`      | `Linux`                    | `Darwin`               | `Windows`                |
| `{uname.arch}`    | `x86_64`                   | `arm64`                | `x86_64`                 |
| `{ext}`           | (empty)                    | (empty)                | `.exe`                   |

`{name}` is the build name, and `{version}` is the released version. Setup
blocks the proposal when two files would get the same name.

## Downstream release context

Release subscriptions provide `context.upstreamRelease`. It holds the repository
ID and name, the source commit, the version, the optional tag and GitHub release
ID, the publications and the artifacts. `context.sourceSha` identifies the
destination checkout. The dashboard's execution-history limit leaves release
events and subscription deliveries in place.

Enable the `pre-commit` manager to discover remote hook references. The
`POST /api/releases/update-references` endpoint accepts `repositoryId`,
`releaseEventId` and `preview` (default true). With `preview` true, the
endpoint returns the edits. With `preview` false, it opens a PR. Updates use a
verified release event, keep SHA pins and YAML comments, and skip `local` and
`meta` hooks.

For Windows package files, use the [WinGet generation Action](winget.md).

Package selections and publication records use
[structured PURL identities](package-identities.md). Beepboop also accepts
`manager:name` references in saved configurations and workflow reports.

### Setup input in beepboop.json

`.github/beepboop.json` holds the complete setup. Each workflow binding that
setup generates carries a `setup` object with the input that generates its
file: `job`, `triggers`, `commands`, `publicationSteps`, `credentials`,
`tagPrefix` and `binaries`. A top-level `actionsRevision` records an Actions
revision override. `schemas/v1.json` validates both.

```json
{
  "streams": {
    "main": {
      "promote": {
        "workflow": {
          "file": "release.yml",
          "setup": {
            "job": "publish",
            "binaries": {
              "builds": [{ "toolchain": "cargo", "name": "tool", "manifest": "Cargo.toml" }],
              "targets": ["linux-amd64", "darwin-arm64"]
            }
          }
        }
      }
    }
  }
}
```

Setup reads these objects from the default branch. A preview without new
choices proposes no change while the generated files match them. After an edit
to a `setup` object on the default branch, the next preview regenerates the
workflow from it. Every change goes through a setup PR.

**Edit release setup** on the Repositories page and the interactive
`beepboop adopt` edit every field of the setup choices. The starts, the version
bump, the approval policy, the tag prefix and the binary builds and targets
have their own controls. The CLI asks for the starts, the bump and the approval
when `.github/beepboop.json` holds none, and for the rest after **Customize**. Fields without a dedicated control,
`versionSource`, `versionFiles`, `needs`, `operations` and `credentials`, take
JSON and are checked against the same schema. A new schema field fails the
type check until both editors declare a control or a JSON field for it.

Repositories set up before this change keep their choices on the Beepboop
server. On the next refresh without an open setup PR, Beepboop opens one setup
update PR that writes those choices into the bindings. Beepboop opens that PR
once. A closed migration PR stays closed.

### Automatic setup PR maintenance

For an enrolled repository with an open setup PR, Beepboop recomputes the
proposal from the current source on each default-branch push webhook and on the
scheduled repository refresh. Beepboop reuses saved stream choices while their
source configuration stays the same. For older proposals without saved choices,
Beepboop rediscovers the choices from the current manifests and workflow
integrations.

While Beepboop wrote every commit on the setup branch, it rebuilds the branch
as one commit on the default branch and force-pushes it. Once anyone else
commits to the branch, Beepboop stops updating that PR, its branch and its
description. **Replace edited setup branch** on the Repositories page
force-pushes Beepboop's proposal and deletes those commits. Maintenance then
resumes. Beepboop shows missing permissions and unresolved workflow choices on
the PR. An unchanged proposal creates no commit. Beepboop never reopens closed
or merged setup PRs, and maintenance never approves or dispatches a release.

### Edit the setup PR with checkboxes

The setup PR description names the inspected default-branch head. A setup
update PR then lists what changes in release behaviour, each change with its
old and new value. Packages that Beepboop holds for missing files follow, then
the choices. Every changed file and configuration path sits in a folded list at
the end.

The setup PR description lists each release stream with a checkbox for every
publishable package, and for every proposed binary build and target. A release succeeds only when every ticked package
publishes. Each stream also lists its starts (`action`, `dashboard`, `cli`, tick
any), its version bump (`commit` or `pr`, tick one) and its approval for a
version raised without a start (`required`, `merge` or `push`, tick one). A
stream that takes its version from tags, or versions packages independently,
says why it offers no start or bump.
Beepboop ticks only what `.github/beepboop.json` already holds. A question
without a tick gets a note that says what Beepboop does until you answer it,
and setup writes no value for it. The description lists versioning, the preparation and publication
workflows, and their trigger handover as text. Change those under
Repositories, **Edit release setup**. Tick or untick boxes in the GitHub UI to
change the proposal. Beepboop waits until 5 seconds pass without another edit.
It then rebuilds the proposal once from the boxes and rewrites the text between
`<!-- beepboop:setup:start -->` and `<!-- beepboop:setup:end -->`. Text above
and below those markers stays as you wrote it, so a closing keyword such as
`Closes #26` belongs there. A description from before the markers keeps every
line that Beepboop's last version of it did not contain, below the end marker. As with automatic maintenance, unresolved choices and edited
setup-branch files appear on the PR, and Beepboop leaves the branch as it is.

The choices end with an unticked **Release after merge** box. Beepboop
reads it from the merged PR. Ticked, the merge commit releases its unpublished
version under the configured approval. Unticked, Beepboop starts no release for
the merge commit. Later default-branch commits release under the configured
approval.

The GitHub App needs the **Pull request** event. The app manifest subscribes to
it. Existing installations must tick the event in the App settings.
