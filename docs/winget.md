# Generate WinGet manifests

Beepboop generates the version, installer, and default-locale YAML files for a
Windows package. Supply package metadata, release checksums, Markdown release
notes, and the release date. The generator validates its output against its
WinGet 1.12.0 field schemas before writing files.

Start with [the package configuration example](../examples/winget/package.json).
Set your package identifier, publisher, description, executable metadata, and
installer assets. Each installer selects its architecture, checksum filename,
and download URL. ZIP packages specify their nested installer type and files.

The templates accept `{version}` and `{tag}`. Installer URLs also accept `{asset}`.
The tag defaults to `v` followed by the version. Installer URLs must use HTTPS.
Checksum input accepts SHA256 lines with two spaces or a space and `*` before the
filename; duplicate filenames and missing selected assets are errors.

## GitHub Action

```yaml
- uses: kjanat/beepboop/actions/generate-winget@PUBLISHED_SHA
  id: winget
  with:
    config: distribution/winget.json
    version: ${{ steps.release.outputs.version }}
    checksums: dist/checksums.txt
    release-notes: dist/release-notes.md
    release-date: ${{ steps.release.outputs.date }}
    out: dist/winget
```

Replace `PUBLISHED_SHA` with the distribution commit reported by the **Publish
Actions** workflow. That commit lives on the `actions` branch and includes the
bundled Node entrypoint. Source commits on `master` omit generated bundles.
The `release` step in this example supplies the release version and date.
The Action outputs `directory` and `files` (a JSON path array).
Attach those files as build artifacts or pass them to your submission operation.

## CLI

```sh
bun run winget \
  --config examples/winget/package.json \
  --version 1.2.3 \
  --checksums dist/checksums.txt \
  --release-notes dist/release-notes.md \
  --release-date 2026-10-22 \
  --out dist/winget
```

Generation writes:

- `<PackageIdentifier>.yaml`
- `<PackageIdentifier>.installer.yaml`
- `<PackageIdentifier>.locale.<locale>.yaml`

Use an empty output directory. Existing files are protected against overwrites.
The release date is explicit, so identical inputs produce identical YAML.

Markdown notes become plain text with lists, code, and table contents. Notes
longer than 10,000 characters are shortened and linked to the complete release.
Portable packages can provide launch arguments through `InstallationMetadata`;
installer success codes are only emitted when explicitly configured.

## Development

The generator is in `src/distribution/winget`. Build and test it locally with:

```sh
bun run build:winget
bun test test/winget.test.ts
```

`bun run test` also builds the Action before running the full test suite. Generated
bundles are ignored in source checkouts. CI tests a fresh build instead of comparing
generated JavaScript with a committed copy.

## Publish the Action

Run the **Publish Actions** workflow manually against `master`. It verifies the
selected source commit, rebuilds and tests the Node entrypoint, then publishes
the complete repository snapshot with the bundle to the `actions` branch. The
workflow summary records both the source SHA and the distribution SHA to pin in
consumer workflows. Other Actions and their shared runtime retain their paths.

Publication preserves the previous distribution commit as a parent and uses a
normal fast-forward push. It rejects an older source revision and concurrent
branch changes. Repeating publication with the same source and bundle reuses the
existing distribution commit. Repository branch rules apply to `actions`; the
workflow does not force-push or create tags or GitHub releases.

The generator performs no network requests and uses the checksums supplied by
the calling release workflow.

## Bot submissions

The **WinGet** dashboard page submits published stable GitHub releases to
`microsoft/winget-pkgs`. Select an enrolled repository and release, preview the
three manifests, and choose **Submit to WinGet**. The page tracks the PR link,
validation checks, change requests, closure and merge. A PR being open or its
checks passing is not reported as a completed publication: Microsoft controls
review and merge. The bot never merges or enables auto-merge.

Add this to the source repository's `.github/beepboop.json`:

```json
{
  "winget": {
    "config": "distribution/winget.json",
    "tagPrefix": "v",
    "automatic": false
  }
}
```

The referenced file has the same format as the package configuration example.
It is read from the exact release-tag commit, not the current branch. Installers
must be uploaded assets on that public GitHub release, and GitHub must expose
SHA-256 digests for them. Missing digests, mismatched URLs, drafts, prereleases,
and changed preview inputs block submission. Older assets without GitHub digests
remain usable with the standalone generator but cannot use this service.

After merging the configuration, refresh the repository in Beepboop. Set
`automatic: true` to submit future published stable releases. Automation starts
when Beepboop first refreshes the enabled configuration; it does not backfill
historical releases. Published-release webhooks and scheduled reconciliation
process the latest 30 releases. Historical releases in that list can also be
submitted manually. Refresh after disabling automatic submission before enabling
it again to reset its start time.

Service setup:

1. Apply `migrations/0003_winget.sql` through the normal D1 migration path.
2. Create a fork of `microsoft/winget-pkgs` owned by the submission identity.
3. Set `WINGET_FORK` to `owner/winget-pkgs` and store `WINGET_GITHUB_TOKEN` as a
   Worker secret. This must be a token for the intended bot/service account that
   can write the fork and open PRs against the public Microsoft repository
   (for example a classic token with `public_repo`). The source repository's
   ordinary Actions token does not provide that cross-repository access.
4. The source-repository GitHub App installation still provides read access for
   release metadata and source configuration. The submission credential stays
   on the Worker and is never sent to workflows or the browser.

The dashboard displays a setup notice and disables submission when the bot
bindings are missing. Generation and preview do not mutate GitHub. Submission
uses a durable record, a lease, and a deterministic branch. A retry after a lost
GitHub response recovers the existing branch or PR. Existing branches must contain
exactly the expected new manifests. Closed PRs are not automatically reopened;
reviewer-requested edits can be made on the linked PR's branch. Automatic runs
never overwrite those edits or create a replacement for a closed submission.

Administrator API endpoints (the normal session and origin checks apply):

- `GET /api/winget`: recent submissions.
- `POST /api/winget/releases`: `{ "repositoryId": 123 }`.
- `POST /api/winget/preview`: `{ "repositoryId": 123, "releaseId": 456 }`.
- `POST /api/winget/submit`: the same identifiers plus the preview's `digest`.
- `POST /api/winget/refresh`: refresh upstream checks and PR state.

Submission state and manifests are persisted in D1. Release selection is scoped
to enrolled repositories; the service validates the configured fork's upstream
and always targets `microsoft/winget-pkgs`.
