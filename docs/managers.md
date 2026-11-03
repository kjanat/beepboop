# Ecosystem managers

The release planner uses `ManagerRegistry` in
`src/automation/managers/registry.ts`. Built-in adapters are registered in
`src/automation/managers/builtins.ts`.

A manager implements discovery and can supply these capabilities:

- `ownsVersionSource` and `editVersion`: select and edit a version carrier.
- `updateDependencies`: update consumers of selected packages, including
  unpublished consumers.
- `verifyPublication`: confirm registry identity, version, digest, and channel.
- `latest` and `secondaryLatest`: read the latest published version from the
  manager's primary and secondary destinations.

The registry merges discovery results, rejects duplicate manager registrations,
reports duplicate package identities, and calculates publication order. Exactly
one adapter must claim a version source. An absent verifier produces an uncertain
result; a workflow's success does not supply registry verification.

Cargo and npm each own discovery, editing, and verification in their adapter.
OCI supplies publication verification. Workflow discovery identifies release and
container capabilities; GoReleaser, manifest, and pre-commit adapters provide
discovery. GitHub release and manifest verification currently require the
coordinator's authenticated gateway and remain separate from public registry
verification.

The `vscode` adapter discovers `package.json` files with a string
`engines.vscode`. Its package name is the extension ID `publisher.name`, with
purl type `vscode-extension`. It verifies publications against the Visual
Studio Marketplace. The npm adapter skips these manifests and still edits their
`version` field.

Version selection, shared-source selection checks, and composing edits belong to
the planner. Lockfile regeneration belongs to the configured preparation
workflow. Managers do not run repository commands.

Preparation without a workflow runs as a managed execution. Its journal stores
the immutable edit plan, branch, commit checkpoint, and resulting PR. Managed
executions have no workflow binding and cannot register or report through the
workflow OIDC endpoints. Both single-version and independent-version plans can
use managed preparation when no generated lockfiles need refreshing.

To add an ecosystem, implement its adapter, register it in `builtins.ts`, and add
its public name to the configuration type, validator, and schema. Include fixtures
for discovery, version edits, dependency ranges, and verification failures for
every capability the adapter provides.

## Destinations

`src/automation/destinations.ts` lists where packages are published. Beepboop
reads the latest version from a registry destination; the repository's own
workflows publish there. Each inspection records one result per destination:
`published`, `missing`, `failed`, or `unchecked`.

| Manager                        | Destinations                        |
| ------------------------------ | ----------------------------------- |
| `npm`                          | npm                                 |
| `cargo`                        | crates.io                           |
| `jsr`                          | JSR                                 |
| `go`                           | Go module proxy                     |
| `goreleaser`, `github-release` | GitHub release                      |
| `oci`                          | Container registry                  |
| `vscode`                       | Visual Studio Marketplace, Open VSX |

The first destination is primary and supplies the package's `published`
version. WinGet is a manifest destination. Beepboop submits its manifests
itself. The Repositories page lists every destination per package and shows
the latest WinGet submission for repositories that configure `winget`.
