# Using Beepboop

## Add a repository

Install the GitHub App, then open the dashboard and select **Inspect**. Beepboop
reads the default branch and displays its packages and release workflows.

Select **Open onboarding PR** to create `.github/beepboop.json`. Review the
package list, split independently versioned packages into separate streams, and
choose the required publications. Initial workflow bindings use `mode: "observe"`
to track releases started by your existing triggers.

Merge the PR, then connect preparation and promotion workflows when you want to
start those operations from the dashboard.

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
          "publications": ["npm:example-package"]
        }
      },
      "required": ["npm:example-package"],
      "credentials": ["npm-bootstrap"],
      "channels": { "stable": "latest", "prerelease": "next" }
    }
  }
}
```

| Setting            | Use                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `versioning`       | `workspace`, `independent`, or `none` for maintenance operations.                                                                                |
| `packages`         | Select package IDs, such as `cargo:example-core` or `npm:@example/cli`. Independent streams can also select packages in the preparation request. |
| `prepare.strategy` | `managed` for Beepboop's version edits; `workflow` for your own preparation script.                                                              |
| `needs`            | Operation names that must complete before this workflow starts.                                                                                  |
| `publications`     | Report IDs required to complete this operation.                                                                                                  |
| `required`         | Publication IDs required for the stream's release gate. Also the default for an operation called `publish`.                                      |
| `credentials`      | Credential aliases requested by the stream; access also needs an administrator grant.                                                            |
| `concurrency`      | `queue` or `supersede-pending`, which cancels older undispatched operations.                                                                     |

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
    "main": { "required": ["cargo:example-core", "cargo:example-cli"] }
  }
}
```

Publish the [preset templates](../presets/) in your chosen preset repository
before referencing them. Presets merge in order, followed by local configuration.
Objects merge by key; arrays replace the inherited array. Each execution saves
the resolved preset commit SHAs. The full contract is in the
[configuration schema](../schemas/v1.json).

## Connect a workflow

Use `actions/begin` to register the operation and `actions/report` to submit its
publication results. Replace `IMPLEMENTATION_SHA` with the reviewed Beepboop
commit. This example observes tag-triggered publishing:

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
      - uses: kjanat/beepboop/actions/begin@IMPLEMENTATION_SHA
        id: release
        with:
          stream: main
          operation: publish
          version: ${{ github.ref_name }}
      # Build and publish here. Generate the report JSON from those results.
      - uses: kjanat/beepboop/actions/report@IMPLEMENTATION_SHA
        with:
          publications: >-
            [{"id":"npm:example-package","manager":"npm",
            "name":"example-package","version":"1.2.3",
            "digest":"sha512-EXPECTED_INTEGRITY",
            "outcome":"succeeded","required":true}]
```

Replace the sample report with your publisher's version and digest.

For dashboard dispatch, set the binding to `mode: "dispatch"` with an exact ref,
add this workflow input and run name, and pass the input to `begin` as
`execution-id`:

```yaml
run-name: Release operation ${{ inputs.beepboop_execution_id }}
on:
  workflow_dispatch:
    inputs:
      beepboop_execution_id:
        type: string
        required: true
```

`begin` outputs `execution-id` and JSON `context`, and sets
`BEEPBOOP_EXECUTION_ID` for subsequent steps. Call it in each participating job.
The context contains the requested version and source commit. Calls from the same
observed run, stream, and operation attach to the same execution.

## Prepare and promote

Choose the stream and version in the dashboard, then preview the plan.
Preparation has two approaches:

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
workflow dispatch offers reconciliation.

## Publication results

Reports contain `publications` and optional `artifacts` JSON arrays. The workflow's
OIDC identity binds reports to its repository, run, and attempt.

| Manager                  | Result fields and checks                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `cargo`                  | Crate name, version, optional expected archive checksum.                                                                 |
| `npm`                    | Package name, version, integrity, optional distribution channel.                                                         |
| `oci`                    | `ghcr.io/owner/image` or `docker.io/owner/image`, version tag, required `sha256:` digest, optional channel.              |
| `github-release`         | `owner/repository`, tag as version, release commit matching the source SHA.                                              |
| `manifest`               | Public `owner/repository/path.json` or `.rb`, version, required `sha256:` content digest. Checks default-branch content. |
| `workflow`, `goreleaser` | Authenticated workflow result with optional artifacts.                                                                   |

Artifact fields are `id`, `runId`, `name`, `digest`, and `expiresAt`. Beepboop
checks these against GitHub's API.

Every required publication must succeed. Missing or skipped required results
block completion; registry outages show an uncertain result. Optional failures
are displayed alongside required results.

## Credentials

In the dashboard, create a credential alias and grant access to a repository,
operation, workflow, ref, and optional environment. Credential changes require
a fresh touch of an enrolled security key.

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

Vermon supplies package events through a [service binding](deployment.md#connect-vermon).
The source is `<registry>:<package-name>`; event IDs deduplicate delivery.

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
