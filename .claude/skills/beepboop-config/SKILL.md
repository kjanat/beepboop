---
name: beepboop-config
description: Write or review Beepboop release configuration, meaning a repository's `.github/beepboop.json` and the choices JSON for `beepboop repositories adopt --choices`. Use when onboarding a repository to Beepboop, adding a stream, package, workflow, credential or signed tag, wiring an existing release workflow into Beepboop, or debugging a setup preview blocker or a "Configuration invalid" plan error.
---

# Beepboop configuration

Beepboop reads `.github/beepboop.json` from the default branch. Setup writes
that file through a setup PR. Write choices for `repositories adopt` first, and
edit `.github/beepboop.json` by hand only for fields that setup has no choice
for.

These files in this repository define the behaviour:

- `src/domain/configuration.ts` holds the zod schema for `.github/beepboop.json`.
  `schemas/v1.json` is generated from it and is served at
  `https://beepboop.kjanat.dev/schema/v1.json`.
- `src/contract/setup.ts` holds `setupChoicesSchema` for the choices file.
- `docs/automation.md`, `docs/cli.md` and `docs/release-planning.md` explain
  the behaviour.

Read the schema file when a field here looks stale. The code wins over this
skill. Read config files through `envctl redact`.

## Onboarding flow

1. The Beepboop GitHub App must be installed on the repository.
2. `beepboop repositories discover owner/repo` inspects the default branch.
   `beepboop repositories show owner/repo` prints packages, workflows and the
   stored configuration.
3. `beepboop repositories adopt owner/repo --json` prints the server's proposal
   with its choices and blockers. Start a choices file from `.choices` in that
   output.
4. `beepboop repositories adopt owner/repo --choices choices.json --output
   setup-plan.json --json` previews. Fix every entry in `.blockers` and read
   `.notes`. The preview enrolls the repository and writes no files.
5. Apply only when the user asks:
   `beepboop repositories adopt owner/repo --plan setup-plan.json --apply`.
   Apply opens or refreshes the setup PR. The user merges it.
6. After the merge, run `beepboop repositories discover owner/repo` again.

Apply returns 409 when the source, choices, generated files, preset revisions
or setup branch changed after the preview. Preview again and apply the new
plan. Beepboop keeps maintaining the setup branch only while every commit on it
is Beepboop's. A human commit on the setup branch stops that maintenance.

## Choices file

```json
{
  "actionsRevision": "v1",
  "streams": [
    {
      "name": "main",
      "packages": ["pkg:cargo/example-core", "pkg:cargo/example"],
      "versioning": "workspace",
      "required": ["pkg:cargo/example-core", "pkg:cargo/example"],
      "prepare": {
        "file": "prepare-release.yml",
        "triggers": "dispatchOnly",
        "commands": "cargo update --workspace\ncargo test --workspace --locked"
      },
      "promote": {
        "file": "publish-crates.yml",
        "triggers": "dispatchOnly",
        "commands": "cargo publish --package example-core\ncargo publish --package example",
        "credentials": { "CARGO_REGISTRY_TOKEN": "crates-io" },
        "tagPrefix": "v"
      }
    }
  ]
}
```

`actionsRevision` is optional. It takes a release tag like `v1` or a full
40-character commit of the published Actions.

Stream fields:

- `name` matches `^[a-z][a-z0-9-]{0,63}$`.
- `packages` and `required` are versionless PURLs from `repositories show`.
  Scoped npm names are percent-encoded, as in `pkg:npm/%40scope/name`.
- `versioning` is `workspace` (one shared version), `independent` or `none`.
- `versionSource: { "kind": "tags", "prefix": "v" }` reads the version from Git
  tags. Without a version file, a tag-only stream needs a preparation workflow.
- `versionFiles` lists extra version carriers. Each entry has `path`, an
  optional `group`, a `template` (default `{version}`) and a `format`. `json`
  and `yaml` take `key` as a path array of strings and indexes. `toml` takes
  `key` as an array of bare keys. `text` takes `prefix` and `suffix` around the
  version.
- `companionModules` lists Go modules (versionless PURLs) whose tag, such as
  `go/v1.2.3`, the stream's release also pushes on the release commit. The
  module keeps its own stream.
- `prepare` and `promote` are workflow choices. Leave out `prepare` for a
  managed version PR. Lockfiles (`Cargo.lock`, `package-lock.json`,
  `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `uv.lock`) need a `prepare`
  workflow that regenerates them.
- `observe` lists workflows that Beepboop watches without dispatching. Each
  entry has `name`, `file`, an optional `ref` pattern such as
  `refs/tags/v*` and `publications`. An observed stream needs no `prepare` or
  `promote`.

Workflow choice fields:

- `file` is a filename in `.github/workflows`. `job` picks a job when the
  workflow has several.
- `triggers` is `review`, `dispatchOnly` or `preserve`. A workflow with push or
  tag triggers needs `dispatchOnly`. When that workflow has several jobs, move
  the publishing job into its own workflow first, or observe the workflow.
- `commands` is Bash for one generated step. Setup suggests commands for Cargo
  and plain npm packages and adds `uv lock` for preparation when `uv.lock`
  exists. Everything else needs explicit commands.
- `publicationSteps` maps a PURL to the ID of the step that publishes it in an
  existing workflow.
- `credentials` maps an environment variable name to a stored secret alias.
  Setup adds a `beepboop_credentials` step and exposes each alias to the
  commands step as that variable. The alias also lands in the stream's
  `credentials` list.
- `tagPrefix` makes the workflow push a version tag with that prefix through
  the `publish-refs` action after the commands. Beepboop signs the tag.
- `binaries` adds build jobs for release assets. `builds` holds Go entries
  (`toolchain`, `name`, `module`, `package`, `asset`) or Cargo entries
  (`toolchain`, `name`, `manifest`, `asset`). `targets` defaults to all six of
  `linux|darwin|windows` crossed with `amd64|arm64`. Asset placeholders are
  `{name}`, `{version}`, `{ext}`, `{go.os}`, `{go.arch}`, `{rust.target}`,
  `{node.platform}`, `{node.arch}`, `{uname.os}` and `{uname.arch}`. The
  generated release job writes checksums, an SPDX SBOM and attestations, then
  publishes refs and the GitHub release.

When the repository has `mise.toml`, `.mise.toml` or `.config/mise.toml`,
setup adds `jdx/mise-action` before the commands step. Tools such as `uv` then
come from mise.

## Secrets

A credential reaches a workflow only after it is granted. When the repository
owner merges a Beepboop setup PR, Beepboop grants the credentials that the PR's
generated workflows request, as long as the generated files are unchanged and a
value is stored. Other grants need these commands, and each needs a
security-key touch from the user, so leave them to the user:

```sh
printf '%s' "$TOKEN" | beepboop secrets set crates-io
beepboop secrets grant owner/repo crates-io --stream main --operation promote
```

`--delivery runtime` is the default and lets the credentials action fetch the
value during the run. The run must match the granted workflow file, ref and
job environment. `repository` and `environment` delivery copy the value into
the GitHub secret named by `--secretName` when the user presses **Copy latest
value to GitHub** in the dashboard. The alias must already be in the stream's
`credentials` list, which means the setup PR is merged.

Trusted publishing on crates.io works only for a crate that exists, so the
first publish of a new crate uses a token. After the first release, configure
trusted publishing on crates.io for the workflow file.

## `.github/beepboop.json`

```json
{
  "$schema": "https://beepboop.kjanat.dev/schema/v1.json",
  "extends": ["github>owner/presets:rust-workspace"],
  "managers": ["cargo", "workflow"],
  "streams": {
    "main": {
      "packages": ["pkg:cargo/example"],
      "versioning": "workspace",
      "required": ["pkg:cargo/example"],
      "credentials": ["crates-io"],
      "prepare": {
        "strategy": "workflow",
        "workflow": { "file": "prepare-release.yml", "ref": "main" }
      },
      "promote": {
        "approval": "required",
        "workflow": {
          "file": "publish-crates.yml",
          "ref": "main",
          "publications": ["pkg:cargo/example"],
          "refs": { "phase": "version", "prefix": "v", "signed": true }
        }
      }
    }
  }
}
```

Top-level fields:

- `extends` takes presets as `github>owner/repo:preset` with an optional
  `#ref`. This repository ships presets in `presets/`.
- `managers` limits discovery. Names are `pre-commit`, `cargo`, `npm`, `jsr`, `pypi`,
  `github-release`, `oci`, `goreleaser`, `go`, `vscode`, `manifest` and
  `workflow`. The default is all of them.
- `streams` maps a stream name to a stream.
- `subscriptions` start an operation on another event. `event` is `release`,
  `package.version.changed` or `workflow_run`, and `operation` must name an
  entry in that stream's `workflows`.
- `winget` takes `config` (a JSON path), `tagPrefix` and `automatic`.

Stream fields:

- `versioning`, `versionSource`, `versionFiles`, `packages` and `required`
  match the choices file.
- `prepare.strategy` is `managed` or `workflow`. `workflow` needs
  `prepare.workflow`.
- `promote.approval` is `required`, `merge` or `push`. `required` waits for
  the user's approval. `merge` releases the verified merge commit of a
  Beepboop preparation PR after its checks pass. `push` releases any
  default-branch commit whose manifest version is unpublished.
- `workflows` maps extra operation names to workflow bindings. The names
  `prepare` and `promote` are reserved.
- `credentials` lists secret aliases that the stream may request.
- `needs` maps a publication to the publications that must finish first. Setup
  derives it from Cargo dependencies, from the order of the generated publish
  and tag steps, and from the job order of an observed workflow. The setup PR
  body and the CLI summary show it as numbered stages.
- `channels` names the stable and prerelease channels, `latest` and `next` by
  default.
- `concurrency` is `queue` or `supersede-pending`.

Workflow binding fields:

- `file` is required. `ref` pins the workflow ref.
- `inputs` passes dispatch inputs. Beepboop sets `beepboop_execution_id`, and
  `package` when `each` is set.
- `needs` lists operations that run first. `required` defaults to `true`.
- `publications` lists the PURLs this workflow publishes.
- `mode` is `observe` or `dispatch`.
- `each: "package"` dispatches one run per required package. Such a binding
  cannot declare `outputs`, `artifactInputs` or `refs`.
- `refs` creates tags. `phase` is `version` or `aliases`, `prefix` defaults to
  `v`, and `aliases` takes `major` and `minor`. Beepboop signs each new
  annotated tag itself. With `signed: true`, the ref step fails unless GitHub
  reports the tag as verified. A `refs` binding must be `promote` or depend
  on `promote` through `needs`.
- `schedule` is a five-field UTC cron.
- `platform`, `outputs` and `artifactInputs` describe platform builds. See
  `docs/release-planning.md`.

## Checks

- A "Configuration invalid" plan error lists each issue as `path: message`.
  Compare the path against `src/domain/configuration.ts`.
- `bun run discover ../repo` prints the inventory,
  streams and plan for the committed HEAD of a local checkout.
  `bun run discover --github owner/repo@ref` does the same for GitHub.
- `beepboop release patch --repository owner/repo --stream main --json`
  previews a release without starting one.
