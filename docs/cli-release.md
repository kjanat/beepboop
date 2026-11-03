# Releasing Beepboop with Beepboop

The `cli` stream in `.github/beepboop.json` releases **@kjanat/beepboop** to
npm and JSR. The private Astro/Worker package stays private. The public package
contains only the Bun CLI bundle, its typed `run()` entrypoint, metadata and
README; DreamCLI is its only runtime dependency. Its license is `UNLICENSED`.

## One-time registry setup

Neither package existed when this integration was implemented. Before the first
release:

- Create/reserve `@kjanat/beepboop` on npm and configure its trusted publisher:
  GitHub owner `kjanat`, repository `beepboop`, workflow `publish-cli.yml`, no
  environment. If npm requires an initial authenticated publication before
  enabling trust, perform that bootstrap through an explicitly authorized
  release; the workflow does not silently fall back to a stored token.
- Create `@kjanat/beepboop` on JSR and link it to `kjanat/beepboop` in its package
  settings. GitHub OIDC supplies publishing credentials.
- Deploy this revision through the existing Cloudflare Builds path, then refresh
  the enrolled repository's inspection so it reads the `cli` stream and JSR
  adapter. The existing setup PR is unnecessary once this configuration is on
  the default branch.

These are registry/account operations; adding workflow files alone does not
perform them. Publication is never triggered just by pushing this change.

## Release flow

1. Open **Prepare a release**, select `kjanat/beepboop` and stream `cli`, and
   preview an explicit first version such as `0.1.0`. `0.0.0` is an unpublished
   baseline and the publishing workflow rejects it.
2. Prepare the reviewed plan. Beepboop dispatches `prepare-cli.yml`, which applies
   both manifest edits, installs dependencies, runs checks and package smoke
   tests, and submits the resulting files through `actions/prepare` for a PR.
3. Review and merge the PR. Start the release for that preparation and select
   the merged commit. Approve the promotion in Beepboop. Approval checks the
   exact commit's signature and CI results.
4. Beepboop dispatches `publish-cli.yml`. `actions/begin` authenticates the
   execution, then the workflow checks out its approved source SHA and checks
   that both package versions match the execution. The workflow commit must also
   match the approved source so provenance identifies the code actually built;
   if master moved, refresh and approve the current commit. It rebuilds and tests the
   installable package before publishing.
5. npm publishes with provenance and its trusted-publisher transport. Stable
   versions use `latest`; prereleases use `next`. JSR publishes via OIDC. Both
   results are reported even if one publisher fails. Beepboop independently
   checks npm's exact version/integrity/channel and JSR's exact unyanked version
   and immutable file metadata. Both are required for release completion.

The workflow uses Bun for the CLI, build and tests. Only npm's supported
OIDC/provenance publisher uses the npm CLI; `bun publish` does not support
provenance. A retry skips an existing npm version only if its tarball integrity
matches the newly built package. A conflicting version fails rather than
silently overwriting or accepting it.

JSR has no registered type in our pinned PURL definitions. Its adapter therefore
uses `pkg:generic/%40kjanat/beepboop?repository_url=https:%2F%2Fjsr.io`, distinct
from `pkg:npm/%40kjanat/beepboop`. No unofficial `jsr` PURL type is introduced.

## Local verification

```sh
bun run build:cli
bun run check:cli
bun run check:jsr
```

`check:cli` packs and installs the real tarball into a temporary directory outside
this repository, then runs its installed executable, version, help, completions,
release flag and module export. `check:jsr` performs JSR's publication dry run.
These checks also run in CI and the preparation/publication workflows.
