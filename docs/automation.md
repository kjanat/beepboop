# Using Beepboop

## Add a repository

Install the GitHub App, then open the dashboard and select **Inspect**. Beepboop
reads the default branch and displays its packages and release workflows.

For a repository without a configuration, the first proposal comes from its
existing release workflows. Beepboop reads the workflows, the local actions,
scripts and task recipes they run, and the repository's tags. It groups them
into release streams: one per tag family, manually dispatched release, or
scheduled channel. Each stream observes its existing workflows and keeps their
triggers, so adoption changes only `.github/beepboop.json`. The setup PR body
contains a **Release plan** section. For each stream it lists the starting
trigger, the workflows and their roles, the version source and carriers, the
publication order per destination, moving aliases and the start command. It
also names each grouping's evidence. Products that cannot publish yet (editor
extensions without a publishing workflow) appear under **Not ready to publish**
and stay out of the stream's required publications. Packages and workflows
that no release publishes appear under **Left out** with the reason.
Inspection reads the repository and never runs its code.

Select **Configure releases** (or **Edit release setup** for an existing
configuration). An inferred stream shows a checked **Keep … with their own
triggers** option; clear it to configure that stream's workflows instead. Select the packages and either create a publishing workflow or
use an existing one. New workflows get an editable filename based on the package
or repository name, a publishing job, and the required dispatch trigger. Existing
workflows with a single job or a recognized integration select that job automatically.
You only need to choose a job when its purpose is ambiguous.

Command boxes contain **Bash shell commands**, not GitHub Actions YAML. Suggested
Cargo and npm commands are editable. For an existing publishing job, you can select
its publishing steps instead of adding commands. Trigger replacement choices only
appear for existing workflows with automatic triggers.

Select **Beepboop opens the version PR (no preparation job)** when preparation only edits
versions stored in manifests or configured `versionFiles`. Repositories with
lockfiles need a preparation workflow to regenerate them. Tag-only packages
without a version file also need a preparation workflow.

For a new release workflow, preparation can run as a second job in the **same file**.
The dispatcher selects preparation or publication, and job conditions keep the
other job from running. Preparation runs before the release PR is merged, and
publication runs after approval. You can still choose a separate preparation
workflow when needed. Selecting managed PR preparation hides the unused job fields.

Versioning and release group settings are under **Versioning and group settings**.
Most repositories need one group. The Actions revision override is under
**Advanced settings**; leave it empty to use the current compatible `v1` release.

When adopting an existing integration, setup adds the approved-commit checkout
to a job with no checkout or one ordinary root checkout. Jobs with other steps
before `begin` need explicit integration: install dependencies and build artifacts
after checking out the approved commit, since checkout cleans the workspace.
Custom refs, other repositories, and multiple checkouts still need explicit integration.

Preview shows the inspected commit, configuration and workflow changes, and any
unresolved requirements. You must explicitly choose dispatch-only triggers before
an automatically triggered publishing workflow can move under Beepboop approval.
Existing build and publish commands stay in the proposal. Missing commands and
publication-step mappings require your choices. Matrix, reusable, dependent,
conditional and container jobs need explicit integration in a dedicated workflow.

The GitHub App needs **Workflows: write** in addition to contents and pull request
permissions to propose workflow changes. The app manifest includes it; existing
installations must approve the permission update. Preview blocks apply until it
is available. Configuration-only setup PRs do not request Workflows: write.
This does not change the live app automatically.

External integration actions use the compatible `v1` Actions release by default.
Advanced setups can override this with a release tag or full distribution commit SHA.
Local actions use `$/actions/...` when their definitions
exist in the repository. npm trusted-publisher setup remains separate; a setup PR
does not publish anything. When a promotion starts, Beepboop creates each JSR
package it publishes, links it to the repository and lets GitHub Actions runs
started by Beepboop publish to the scope, using the credential stored as
`jsr-token`.

Select **Open setup PR** after reviewing the preview. A changed source
commit or setup branch invalidates it. Refreshing a proposal incorporates current
default-branch files and refuses human changes on the setup branch. The dashboard
also links earlier proposals, including proposals superseded by configuration now
on the default branch. Merge the setup PR yourself, then refresh inspection.

The authenticated API exposes `POST /api/repositories/setup/preview` with
`repository` and optional `choices`, and `POST /api/repositories/setup/apply` with
those same choices plus the returned `planId`, `sourceSha`, and `setupHead`.
Preview does not persist inspection or create branches. Apply recomputes the plan
and checks those values before publishing the reviewed changes.

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

| Setting            | Use                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versioning`       | `workspace`, `independent`, or `none` for maintenance operations.                                                                                                                                                                                                           |
| `packages`         | Select package IDs, such as `pkg:cargo/example-core` or `pkg:npm/%40example/cli`. Independent streams can also select packages in the preparation request.                                                                                                                  |
| `prepare.strategy` | `managed` for Beepboop's version edits; `workflow` for your own preparation script.                                                                                                                                                                                         |
| `needs`            | Operation names that must complete before this workflow starts.                                                                                                                                                                                                             |
| `publications`     | Report IDs required to complete this operation.                                                                                                                                                                                                                             |
| `required`         | Publication IDs required for the stream's release gate. Also the default for an operation called `publish`.                                                                                                                                                                 |
| `credentials`      | Credential aliases requested by the stream; access also needs an administrator grant.                                                                                                                                                                                       |
| `concurrency`      | `queue` or `supersede-pending`, which cancels older undispatched operations.                                                                                                                                                                                                |
| `promote.approval` | `required` waits for your approval. `merge` releases the merge commit of a Beepboop preparation PR once it is verified and its checks pass. `push` releases any default-branch commit whose manifest version is not yet published, once it is verified and its checks pass. |

Versions are selected manually and use SemVer. Packages sharing a version source
must be selected together. Dependencies use operation names within the same
stream; configuration validation rejects cycles and missing operations.

Observation refs accept one trailing `*`. Dispatched workflows use exact refs.

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

Publish the [preset templates](../presets/) in your chosen preset repository
before referencing them. Presets merge in order, followed by local configuration.
Objects merge by key; arrays replace the inherited array. Each execution saves
the resolved preset commit SHAs. Refresh validates configuration with the schema
that generates [schemas/v1.json](../schemas/v1.json).

## Connect a workflow

Use `actions/begin` to register the operation and `actions/report` to submit its
publication results. `v1` follows the latest compatible Actions release; pin
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

For dashboard dispatch, set the binding to `mode: "dispatch"` with an exact ref,
add these workflow inputs and run name, and pass `beepboop_execution_id` to
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

Beepboop sends `beepboop_title` as the operation, package and version followed
by the first eight characters of the execution ID, for example
`Release 0.1.0 (f4feef47)`. A workflow without the `beepboop_title` input must
use the run name `Release operation ${{ inputs.beepboop_execution_id }}`.

`begin` outputs `execution-id` and JSON `context`, and sets
`BEEPBOOP_EXECUTION_ID` for subsequent steps. Call it in each participating job.
The context contains the requested version and source commit. Calls from the same
observed run, stream, and operation attach to the same execution.

## Prepare and promote

Choose the stream and version in the dashboard and select **Release**. When the
manifests already carry the version, Beepboop creates the promotion and waits
for your approval. Otherwise preparation has two approaches:

- **Managed:** Beepboop calculates manifest edits. A preparation workflow checks
  out `context.sourceSha`, calls `actions/prepare` with `mode: apply` and the
  `context` output, runs lockfile generators and checks, then calls the action
  with `mode: submit`. The service creates the release PR. Accepted changes are
  the planned manifests and existing lockfiles.
- **Workflow:** Set `prepare.strategy: "workflow"`. Your preparation script reads
  the version and source SHA from the context and creates its PR or candidate.
  Use this for custom generated files or dependency ranges that need project logic.

The dashboard can create the preparation PR directly when the plan requires no
lockfile regeneration. Updates to an existing preparation branch check its head
and generated file contents; manual edits produce a conflict for review.

Merge the preparation PR, choose the promotion commit, and approve it in the
dashboard. Repeating an operation for the same release attaches to its existing
execution. Failed jobs can be retried from the execution page; an ambiguous
workflow dispatch offers reconciliation. Retrying a promotion that was cancelled
before its first dispatch returns it to approval.

## Publication results

Reports contain `publications` and optional `artifacts` JSON arrays. The workflow's
OIDC identity binds reports to its repository, run, and attempt.

| Manager          | Result fields and checks                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cargo`          | Crate name, version, optional expected archive checksum.                                                                 |
| `npm`            | Package name, version, integrity, optional distribution channel.                                                         |
| `oci`            | `ghcr.io/owner/image` or `docker.io/owner/image`, version tag, required `sha256:` digest, optional channel.              |
| `github-release` | `owner/repository`, tag as version, release commit matching the source SHA.                                              |
| `manifest`       | Public `owner/repository/path.json` or `.rb`, version, required `sha256:` content digest. Checks default-branch content. |
| `go`             | Module path, version without `v`, optional expected origin commit. Checks `proxy.golang.org`.                            |
| `goreleaser`     | Project name, version without `v`. The `v<version>` GitHub release must be public with every asset uploaded.             |
| `vscode`         | Extension ID `publisher.name`, version. Checks the Visual Studio Marketplace.                                            |
| `workflow`       | Authenticated workflow result with optional artifacts.                                                                   |

Artifact fields are `id`, `runId`, `name`, `digest`, and `expiresAt`. Beepboop
checks these against GitHub's API.

Every required publication must succeed. Missing or skipped required results
block completion; registry outages show an uncertain result. Optional failures
are displayed alongside required results.

## Paced publishing

Set `"each": "package"` on a workflow binding to run it once per package in a
release. Beepboop dispatches one run for every required package of the release
group, limited to the binding's `publications` when set:

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
packages it depends on. Per-package bindings run only inside a release set and
cannot declare outputs, artifact inputs or refs.

Crates publish within crates.io's
[rate limits](https://github.com/rust-lang/crates.io/blob/main/src/rate_limiter.rs).
Beepboop keeps one budget per registry account:

| Publication                    | Burst | Then         |
| ------------------------------ | ----- | ------------ |
| A crate's first version        | 5     | 1 per 10 min |
| A new version of a known crate | 30    | 1 per minute |

A crate that Beepboop has never seen published counts as new. The Runs page
shows when a waiting crate will publish.

When the registry refuses a publish anyway, report the publication as
`rate-limited` with the registry's `Retry-After` time. Beepboop moves the
budget past that time and dispatches the package again afterwards; the refusal
does not count as a failed attempt.

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

`actions/report` converts a `Retry-After` value in `retryAfter`, either delay
seconds or an HTTP date, to ISO 8601. The report API itself accepts ISO 8601
timestamps.

## Credentials

Store a value under a credential alias, then grant access to a repository,
operation, workflow, ref, and optional environment. Overwriting an existing
alias asks for confirmation first. Setting and revealing a value, granting and
revoking access, and copying values to GitHub require a fresh touch of an
enrolled security key.

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

| Delivery      | How the workflow receives it                                                  |
| ------------- | ----------------------------------------------------------------------------- |
| `runtime`     | `actions/credentials`, using a JSON `aliases` input and JSON `values` output. |
| `repository`  | Synchronization to a GitHub repository secret.                                |
| `environment` | Synchronization to a GitHub environment secret.                               |

Runtime retrieval also requires the alias in the stream's `credentials` list.
Values are masked before the Action writes outputs. Synchronization displays
success or failure for each destination and credential version.

Revocation stops future access through the grant. Delete synchronized GitHub
secrets separately when removing access, and rotate credentials that were
previously issued.

See [deployment](deployment.md) for encryption keys, login, and security-key enrollment.

## Repository token

`actions/token` gives a workflow a Beepboop App installation token for its own
repository. Pushes and pull requests made with it start workflow runs, unlike
`GITHUB_TOKEN`. The job needs `id-token: write`, and the run must have been
started by the owner account or dispatched by a Beepboop operation. Push and
same-repository `pull_request` runs qualify, `pull_request_target` runs do not,
and the repository does not have to be enrolled. Other bots, apps and users get
no token.

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
`permission-metadata`, each `read` or `write`. Without any of them, the token
gets contents and pull requests write. The route refuses other permissions by
default.
The action also outputs `bot-login`, `bot-id` and `bot-email`, resolved from the
configured App and its GitHub bot user. Use those outputs for Git author and
committer identity; use the installation token for push authentication. The
`gitId` output holds the same identity as a JSON object of `GIT_AUTHOR_NAME`,
`GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`, ready to
insert into a step environment:

```yaml
env:
  "${{ insert }}": ${{ fromJSON(steps.beepboop.outputs.gitId) }}
```

Every issued token is recorded in the audit log.

A run that Beepboop dispatched passes its execution ID:

```yaml
- uses: kjanat/beepboop/actions/token@v1
  with:
    execution-id: ${{ inputs.beepboop_execution_id }}
```

Beepboop checks that the run is that execution's dispatch: same repository,
workflow file and ref, and the run ID GitHub returned for the dispatch. Without
a recorded run ID, the run name must match the title Beepboop sent.
Dispatched runs cannot request the `publish-actions` purpose.

Actions publication uses the explicit `purpose: publish-actions` with exactly
`contents: write` and `workflows: write` because the distribution tree includes
workflow files. The endpoint requires an owner-started `workflow_dispatch` of
`.github/workflows/publish-actions.yml` at the current default-branch SHA,
matching source and workflow SHAs, without a reusable workflow identity.
PR runs, other workflow files and stale revisions cannot obtain this token.
Deploy the service implementation through Cloudflare Builds before using the
updated action. The App installation must have approved Contents and Workflows
write access; the action does not alter installation permissions.

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
event once per new version; event IDs deduplicate delivery.

A `release` subscription uses a source repository name and fires after its
required publications succeed. A `workflow_run` subscription also specifies an
exact `workflow` filename and fires after successful completion.

For scheduled work, add a five-field UTC cron expression to a workflow binding:

```json
{
  "file": "refresh.yml",
  "ref": "master",
  "schedule": "17 6 * * *"
}
```

Scheduling starts at enrollment. Reconciliation processes up to 100 missed ticks
per pass and saves its position for the next pass.

## Watched packages

The Packages page lists every npm and JSR package an enrolled repository
publishes or subscribes to, plus packages added by hand. Beepboop checks each
one every ten minutes. The first check of an already published package records
its version. Later versions, and the first release of a package that was still
unpublished at its first check, start matching subscriptions and send
notifications.

## Notifications

A destination posts to a Slack Incoming Webhook or an HTTPS webhook. Its URL is
a [credential](#credentials); choose the credential name when adding the
destination. Saving a destination needs only the signed-in administrator
session, because the URL itself lives in the credential.

From a terminal:

```sh
beepboop notifications add --name "Slack #releases" --kind slack --secret slack-releases --subscribe-new
beepboop notifications subscribe <destination-id >npm:example-tool
beepboop notifications list
```

Turn on **Notify about newly watched packages** to subscribe a destination to
every package Beepboop starts watching. Toggle individual packages on the
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

Failed deliveries retry on each scheduled pass, up to five attempts. Client
errors other than rate limits fail immediately.

## Version selection and release refs

The preparation API accepts `version` as a string or a request object:
`{"bump":"patch"}`, `{"bump":"minor"}`, `{"bump":"major"}`,
`{"bump":"prerelease","base":"minor","identifier":"alpha"}`,
`{"bump":"next"}`, or `{"bump":"stable"}`. The dashboard exposes the same
choices. Increment requests require a synchronized selection. Select independent
version groups separately. A stream can derive its current version from tags
with `"versionSource":{"kind":"tags","prefix":"v"}`; the first release needs
an explicit version.

A workflow binding can declare `refs` with `phase: "version"` or `"aliases"`,
`prefix` (default `v`), `aliases: ["major", "minor"]`, and `signed` (default false).
Ref operations require promotion approval, either as the promotion operation or
through its dependencies. Use `actions/publish-refs` after `begin`, passing the
repository token as `token`. Signed version tags require a configured Git signer.
Alias operations should depend on the publication operations they distribute.

The Action publishes an authorized plan with atomic Git pushes and explicit
expected old object IDs. Version tags target one commit; stable aliases exclude
prereleases and reject downgrades. The service checks the resulting refs before
completing the operation. `refs:` report IDs are reserved for this verification.

When a dispatched operation lists `github-release:<owner>/<repo>` in its
`publications`, Beepboop creates a draft release before dispatching the run.
The draft has the tag `<prefix><version>`, targets the approved commit, carries
generated notes, and is marked as a prerelease for prerelease versions. The
run's `context.draftRelease` holds the draft's `id` and `tag`. Upload release
assets to the draft during the run:

```sh
gh release upload "$TAG" target/package/*.crate
```

Repositories with immutable releases accept assets only before publication.

After the version tag exists, `actions/publish-release` publishes the GitHub
release:

```yaml
- uses: kjanat/beepboop/actions/publish-release@v1
```

The operation must list `github-release:<owner>/<repo>` in its `publications`
and, like ref operations, requires promotion approval. Beepboop requires the
annotated tag `<prefix><version>` to target the approved commit. It then
publishes the operation's draft with its uploaded assets, and refuses while an
upload is unfinished. An operation without a draft creates
the release, or accepts an existing published release whose tag and prerelease
flag match. The release is recorded as the operation's `github-release`
publication.

## Downstream release context

Release subscriptions provide `context.upstreamRelease`, including repository
ID/name, source commit, version, optional tag/GitHub release ID, publications,
and artifacts. `context.sourceSha` identifies the destination checkout.
Release events and subscription deliveries are persisted independently of the
dashboard's execution-history limit.

Enable the `pre-commit` manager to discover remote hook references. The
`POST /api/releases/update-references` endpoint accepts `repositoryId`,
`releaseEventId`, and `preview` (default true). Preview returns edits; false opens
a PR. Updates use a verified release event, preserve SHA pins and YAML comments,
and skip `local` and `meta` hooks.

For Windows package files, use the [WinGet generation Action](winget.md).

Package selections and publication records use [structured PURL identities](package-identities.md). Existing `manager:name` references remain accepted for saved configurations and workflow reports.

### Automatic setup PR maintenance

For an enrolled repository with an existing open setup PR, default-branch push
webhooks and the scheduled repository refresh recompute the proposal from the
current source. Saved stream choices are reused while their source configuration
is unchanged. Older proposals without saved choices are rediscovered from the
current manifests and workflow integrations.

While every commit on the setup branch is Beepboop's, Beepboop rebuilds the
branch as one commit on the default branch and force-pushes it. Once anyone else
commits to the branch, Beepboop stops updating that PR, its branch and its
description. **Replace edited setup branch** on the Repositories page force-pushes
Beepboop's proposal and deletes those commits; maintenance then resumes. Missing permissions and unresolved workflow choices are shown on
the PR.
Unchanged proposals do not create commits. Closed and merged setup PRs are not
reopened, and maintenance never approves or dispatches a release.

### Edit the setup PR with checkboxes

The setup PR description lists each release stream with a checkbox for every
publishable package. Every ticked package must be published for a release to
succeed. Versioning, the preparation and publication workflows, and their
trigger handover are listed as text; change them under Repositories, Edit
release setup. Tick or untick boxes in the GitHub UI to change the proposal.
Beepboop waits until 5 seconds pass without another edit, then rebuilds the
proposal once from the boxes and rewrites the whole description.
Unresolved choices and edited setup-branch files appear on the PR, as with
automatic maintenance, and leave the branch as it is.

The GitHub App needs the **Pull request** event. The app manifest subscribes to
it; existing installations must tick the event in the App settings.
