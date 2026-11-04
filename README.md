# Beepboop

<img align="right" src="assets/beepboop.png" alt="Beepboop robot" width="130">

Release automation for ~~your~~ *my* GitHub repositories.

Beepboop discovers packages, opens release preparation PRs, starts publishing workflows,
and tracks their results. Configure each repository in `.github/beepboop.json`,
share defaults through presets, and manage releases from one dashboard.

## Release a project

1. Install the [GitHub App](https://github.com/apps/beepboop-by-kjanat) on the repository.
2. Open the dashboard and select **Inspect** to discover its packages and workflows.
3. Open and review the onboarding PR. Assign packages to release streams and choose the publications required for each release.
4. Connect preparation and promotion workflows using the [Actions integration](docs/automation.md#connect-a-workflow).
5. Choose a version, review the preparation PR, and merge it.
6. Approve promotion of the chosen commit. Follow builds and publications in the dashboard; retry failed jobs from the execution page.

Discovery covers Cargo and npm packages, generated npm targets, GitHub workflows,
GoReleaser configuration, and container publishing. Build commands, signing, and
package generation run in your repository's GitHub Actions workflows.

## Configure and operate

- [User guide](docs/automation.md): onboarding, release streams, Actions, credentials, and subscriptions.
- [Release planning](docs/release-planning.md): independent versions, platform outputs,
  managed and workflow preparation, and declarative version files.
- [Ecosystem managers](docs/managers.md): discovery, editing, and verification adapters.
- [Deployment](docs/deployment.md): Cloudflare, GitHub App, login, and security keys.
- [WinGet manifests and bot submissions](docs/winget.md): configurable package metadata,
  installer assets, checksums, and release notes.
- [Configuration schema](schemas/v1.json) and [preset templates](presets/).
- [Architecture](docs/adr-001-repository-automation.md): execution storage, authentication, and recovery.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run lint
bun run test
bun run deploy:dry
```

Start the dashboard with `bun run dev` at `http://localhost:4321`. This applies
pending migrations to the local D1 database before starting Astro. Local login
requires the exact `http://localhost:4321/auth/callback` URL to be registered for
the `beepboop` client at the configured OpenAuth issuer. Production registration
alone does not enable localhost login. See [local development](docs/deployment.md#local-development).

Astro pages, components, and layouts live in `src/pages`, `src/components`, and
`src/layouts`. Browser interactions live in `src/ui/browser`; styles live in
`src/styles`. Import paths are defined in `tsconfig.json`. `bun run build`
builds the Cloudflare Worker and browser assets into `dist/`. The custom Worker
entrypoint also exports the release coordinator and scheduled reconciliation.
API routes preserve the existing GitHub Actions contracts.

Astro's checker currently needs the TypeScript 6 language-service API. `bun run check` uses Astro to check the project;
`typescript-native` remains available as a separate dependency.

Preview discovery from a checkout's committed HEAD or a GitHub repository:

```sh
bun run discover ../my-project
bun run discover --github owner/repository
```

Both commands print the package inventory and proposed configuration as JSON.

<!-- markdownlint-disable-file -->

## Authenticated CLI

Run `bun run beepboop auth login` to authorize your terminal, then
`bun run beepboop --help` to explore repository and release commands.
See [CLI usage and authentication](docs/cli.md) and the
[Beepboop-managed npm and JSR release flow](docs/cli-release.md) for `@kjanat/beepboop`.
