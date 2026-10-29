# Beepboop

<img src="assets/beepboop.png" alt="Beepboop robot" width="180">

Release automation for your GitHub repositories.

Beepboop discovers packages, opens release preparation PRs, starts publishing workflows,
and tracks their results. Configure each repository in `.github/beepboop.json`,
share defaults through presets, and manage releases from one dashboard.

## Release a project

1. Install the GitHub App on the repository.
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
- [WinGet manifest generation](docs/winget.md): configurable package metadata,
  installer assets, checksums, and release notes.
- [Configuration schema](schemas/v1.json) and [preset templates](presets/).
- [Architecture](docs/adr-001-repository-automation.md): execution storage, authentication, and recovery.

## Development

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run check:bundle
bun run test:runtime
```

Dashboard sources live in `src/ui`: server templates in `templates/`, browser
TypeScript in `browser/`, and styles in `dashboard.css`. `bun run build:ui` uses
Bun to bundle and minify assets into ignored `dist/` output. Wrangler runs this
build for development and deployment; `typecheck` and `test` also build first.
The browser has its own DOM-only TypeScript configuration.

Preview discovery from a checkout's committed HEAD or a GitHub repository:

```sh
bun run discover ../my-project
bun run discover --github owner/repository
```

Both commands print the package inventory and proposed configuration as JSON.

<!-- markdownlint-disable-file -->
