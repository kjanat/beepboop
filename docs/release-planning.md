# Independent releases and platform planning

The dashboard's Releases tab offers release-set preview, preparation, and start
controls. Paste a plan containing `groups` and `operations`, review the returned
edits, and prepare that reviewed plan. Changing the request requires another
preview. Once the preparation PR is merged, enter its merge revision to start.

`POST /api/releases/plan-set` previews multiple version groups against one repository
revision. It uses the administrator authentication required by the release API.
Select a stream configured with `versioning: "independent"`.

```json
{
  "repositoryId": 123,
  "stream": "tools",
  "plan": {
    "groups": [
      { "id": "cli", "packages": ["npm:cli"], "version": { "bump": "patch" } },
      { "id": "core", "packages": ["npm:core"], "version": { "bump": "minor" } }
    ],
    "operations": [
      {
        "id": "windows-x64",
        "group": "cli",
        "platform": { "os": "windows", "arch": "x64" },
        "outputs": [{ "id": "archive", "kind": "archive" }]
      },
      {
        "id": "winget",
        "group": "cli",
        "inputs": [{ "operation": "windows-x64", "output": "archive" }],
        "outputs": [{ "id": "manifests", "kind": "manifest" }]
      }
    ]
  }
}
```

The response includes the source SHA, resolved group versions, combined manifest
edits, publication order, and operations in dependency order. Inputs identify a
producer and one of its declared outputs; these automatically become dependencies.
Explicit `needs` adds ordering without an artifact input. Platform descriptors
accept `os`, `arch`, and optional `abi`; they do not select or provision runners.

All versions resolve from the same input revision. Changes to shared files are
combined, including internal dependency updates. Shared workspace version sources
must stay in the same group. Duplicate selections, unknown packages or outputs,
cycles, and packages outside the configured stream are rejected. Lockfiles still
require a preparation workflow.

To prepare the combined changes, send the same request to
`POST /api/releases/prepare-set`, adding `sourceSha` and `planId` from the preview
response alongside `repositoryId`, `stream`, and `plan`. A revision or plan
mismatch is rejected. The fingerprint covers the resolved versions, edits,
operation graph, configuration, and preset revisions. Single-release preparation
also requires its preview's `sourceSha` and `planId`; the dashboard supplies them.
The response is a preparation execution. Its immutable plan includes all groups
and the operation graph. With `prepare.workflow`, the repository workflow applies
the plan and regenerates lockfiles. Otherwise, Beepboop prepares the PR directly.
The PR URL and commit appear in `prepared.result` for workflow preparation or
`managed.result` for direct preparation.

Managed preparation journals the proposed commit before publishing its branch.
After interruption it resumes that exact commit. A changed branch or closed PR
requires review. It never replaces a changed branch or opens another PR after
the original was closed. Lockfile regeneration requires a preparation workflow.

For workflow preparation, check out `context.sourceSha`, run the prepare action
in `apply` mode, regenerate lockfiles and run the repository's checks, then run
the action in `submit` mode. This works with both single-version and release-set
plans. The submission includes every lockfile, even when regeneration leaves its
contents unchanged. Only planned edits and existing lockfiles are accepted.

Workflow submissions use the same commit checkpoint and interruption recovery as
direct preparation. A changed submission is rejected after it has been journaled.
Preparation is successful only after the PR result is recorded and the workflow
completes successfully. Starting a release set verifies all submitted generated
files against the merged revision as well as the planned version edits.

Preparation opens the combined version-change PR. After it is merged, start the
operation graph with `POST /api/releases/start-set`:

```json
{
  "preparationId": "<execution ID returned by prepare-set>",
  "sourceSha": "<40-character merge commit SHA>"
}
```

Each planned operation ID must match a configured operation in the stream.
Operations receive their group's version and the merged source SHA. Configured
workflow dependencies are combined with the plan's dependencies; the plan cannot
remove a promotion gate. Include every configured dependency in the plan, including
`promote` where required. Promotion stays blocked until explicitly approved.

Beepboop verifies the preparation PR's merged status, head, target branch, and
merge commit. The target must contain every planned file edit and package version.
It then journals the complete operation graph atomically before dispatch. Repeating
`start-set` returns the same execution IDs; a different target is rejected.

Required publication IDs must belong to exactly one group, either through that
group's packages or its operations' `publications` declarations. Release events
are emitted per group after those publications succeed. Report IDs use
`<manager>:<name>`, and npm/Cargo publication versions must match their execution's
version.

Consumers can filter subscriptions by `sourceStream`, `sourceGroup`, and
`publication`. These refer to the upstream release; `stream` still selects the
destination stream. For example, `sourceGroup: "cli"` and `publication: "npm:cli"`
prevent a CLI wrapper from reacting to a different package group's release.
The publication filter requires a successful result in the release event.

## Workflow output contracts

Configured workflow operations can already exchange verified artifacts. For
example, this stream builds a Windows archive before generating WinGet manifests:

```json
{
  "streams": {
    "main": {
      "workflows": {
        "windows-arm64": {
          "file": "build.yml",
          "platform": { "os": "windows", "arch": "arm64" },
          "outputs": [{ "id": "windows-arm64-zip", "kind": "archive" }]
        },
        "winget": {
          "file": "winget.yml",
          "artifactInputs": [
            { "operation": "windows-arm64", "output": "windows-arm64-zip" }
          ],
          "outputs": [{ "id": "winget-manifests", "kind": "manifest" }]
        }
      }
    }
  }
}
```

Upload each output as a GitHub Actions artifact whose name equals its declared
output ID. Report its `id`, `runId`, `name`, `digest` (the `sha256:` digest), and
`expiresAt` through the report action. Beepboop checks these values against GitHub
and the authenticated producer run. A successful workflow with a missing output
stays blocked. Reporting a changed identity or two artifacts for one output fails.

`artifactInputs` adds producer operations to `needs` automatically. Before dispatch
and registration, Beepboop requires the producer to have succeeded against the same
repository, stream, event, configuration revision, and source revision. The begin
action's `context.resolvedInputs` contains the exact producer execution, version,
platform, and verified artifact identity. Download that artifact by its ID and run;
do not search for the newest artifact with a matching name. Expired artifacts block
consumption.

The `platform` field describes an output's target. The repository workflow still
selects its runner and build commands. Output `kind` declares the expected format;
Beepboop verifies the artifact container identity and digest, not its file contents.

## Additional version files

Declare additional version carriers under a stream's `versionFiles`:

```json
{
  "streams": {
    "main": {
      "versionFiles": [
        { "path": "extension.json", "format": "json", "key": ["version"] },
        { "path": "extension.yaml", "format": "yaml", "key": ["release", "version"] },
        { "path": "extension.toml", "format": "toml", "key": ["extension", "version"] },
        { "path": "version.txt", "format": "text", "prefix": "VERSION=\"", "suffix": "\"" }
      ]
    }
  }
}
```

For release sets with multiple groups, add `group` to each rule. `template`
defaults to `{version}`; for example, `v{version}` adds a tag prefix. Single-version
plans use the implicit group `release`. Streams that take their version from tags
can use these files without a Cargo or npm package.

JSON and YAML rules select existing string values; array indices are numbers in
`key`. TOML supports bare and dotted keys in ordinary tables, with single-line
string values. Unsupported TOML layouts fail explicitly. YAML anchors, explicit
tags, and block scalars are rejected to avoid changing other fields indirectly.
Text rules require one occurrence of `prefix` and replace the content up to the
following `suffix`.

Edits preserve surrounding content and comments. Paths must identify existing
regular files inside the repository; symbolic links are rejected during snapshot
loading. Duplicate rules and conflicts with ecosystem version edits fail instead
of silently overwriting a different version. Rules become part of the immutable
preparation plan. Lockfile regeneration still runs in a preparation workflow.
