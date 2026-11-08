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

The `jsr` adapter reads `jsr.json`, `jsr.jsonc`, `deno.json` and
`deno.jsonc`. A directory contributes one manifest, preferred in that order. A
`deno.json` or `deno.jsonc` without `name` is a Deno project and adds no
package. Version edits keep comments and formatting.

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

`src/contract/catalog.ts` declares every manager name and its purl type,
manifest patterns, marker patterns, lockfile names, destinations and version
policy. Snapshots fetch the content of manifest paths and record marker and
lockfile paths with empty content. `projectLockfiles` in the same file lists
lockfiles that no manager reads, such as `uv.lock`. Setup suggests `uv lock` as
the last preparation command when the repository has one. To add an ecosystem,
add its name and catalog entry, implement its adapter, and register it in `builtins.ts`. The typecheck
fails until the catalog and `builtins.ts` cover the same names. Run
`run schema:generate` to add the name to `schemas/v1.json`. Include fixtures for
discovery, version edits, dependency ranges, and verification failures for every
capability the adapter provides.

## Destinations

`src/contract/catalog.ts` lists where packages are published. Beepboop
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

Homebrew, Scoop, and AUR destinations are channels with parameters. The
`goreleaser` adapter reads them from `homebrew_casks`, `brews`, `scoops`,
`aurs`, and `aur_sources`, and attaches them to its package. Entries with a
templated name or repository produce a diagnostic. Discovery also reads
`pkgname` from every `PKGBUILD` and lists those AUR packages as repository
rows. Beepboop reads the cask or formula `version` line, or the version in a
formula `url`, from the tap, the manifest `version` from the bucket, and the
AUR RPC version without epoch or `pkgrel`. AUR packages ending in `-git` track
the default branch, and Beepboop skips their version check. The repository's
own workflows publish to these channels.
