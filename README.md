# Beepboop

<img align="right" src="assets/beepboop.png" alt="Beepboop robot" width="130">

Release automation for ~~your~~ *my* GitHub repositories.

Beepboop finds the packages in a repository, opens a PR that bumps their
versions, and starts your publishing workflows after you approve the merged
commit. It signs the release tags, tracks every publication, and lets you retry
failed jobs from one dashboard. Each repository keeps its settings in
`.github/beepboop.json`. Presets share defaults across repositories.

## Release a project

1. Install the [GitHub App](https://github.com/apps/beepboop-by-kjanat) on the
   repository.
2. Open the dashboard and select **Inspect**. Beepboop lists the packages and
   workflows it found.
3. Select **Configure releases**. Choose the packages and the publishing
   workflow, preview the setup, and open the setup PR. Beepboop names new
   workflows and writes their jobs.
4. Connect your preparation and promotion workflows with the
   [Actions integration](docs/automation.md#connect-a-workflow).
5. Choose a version. Review the preparation PR and merge it.
6. Approve promotion of the merged commit. The dashboard shows each build and
   publication. Retry a failed job from its execution page.

Beepboop discovers Cargo, npm, JSR, Go and VS Code extension packages,
generated npm targets, GitHub workflows, GoReleaser configuration, Homebrew and
Scoop manifests, pre-commit hooks and container publishing. Your GitHub Actions
workflows run the builds and package generation.

## Configure and operate

- [User guide](docs/automation.md) covers onboarding, release streams, Actions,
  credentials and subscriptions.
- [Release planning](docs/release-planning.md) covers independent versions,
  platform outputs, managed and workflow preparation, and version files.
- [Ecosystem managers](docs/managers.md) describes the discovery, editing and
  verification adapters.
- [Deployment](docs/deployment.md) covers Cloudflare, the GitHub App, login and
  security keys.
- [WinGet](docs/winget.md) covers package metadata, installer assets, checksums,
  release notes and bot submissions.
- [Configuration schema](schemas/v1.json) and [preset templates](presets/).
- [Architecture](docs/adr-001-repository-automation.md) covers execution
  storage, authentication and recovery.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run lint
bun run test
bun run deploy:dry
```

CI runs `bun run gate` and `bun run deploy:dry`.

`bun run dev` applies pending migrations to the local D1 database and starts the
dashboard at `http://localhost:4321`. Local login works only when the OpenAuth
issuer has `http://localhost:4321/auth/callback` registered for the `beepboop`
client. See [local development](docs/deployment.md#local-development).

Astro pages, components and layouts live in `src/pages`, `src/components` and
`src/layouts`. Browser code lives in `src/ui/browser` and styles in
`src/styles`. `tsconfig.json` defines the import paths. `bun run build` writes
the Cloudflare Worker and browser assets to `dist/`. The Worker entrypoint also
exports the release coordinator and the scheduled reconciliation.

To preview discovery from a checkout's committed HEAD or from GitHub:

```sh
bun run discover ../my-project
bun run discover --github owner/repository
```

Both commands print the package inventory, the inferred release streams and the
release plan as JSON. Append `@ref` to the GitHub repository to inspect another
revision. `--snapshot` prints the inspected files instead.

<!-- markdownlint-disable-file -->

## Authenticated CLI

Run `bun run beepboop auth login` to authorize your terminal, then
`bun run beepboop --help` to list the repository and release commands. See
[CLI usage and authentication](docs/cli.md) and
[how Beepboop releases its CLI](docs/cli-release.md) for `@kjanat/beepboop`.
