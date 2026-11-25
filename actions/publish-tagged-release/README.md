# Publish a tagged GitHub release

Use this action in a tag-triggered job that builds or downloads release assets.
It publishes the existing tag with a repository-scoped Beepboop App token.
It does not start a Beepboop release execution or create a tag.

The job needs `id-token: write` and the conditions in
[Repository token](../../../../docs/automation.md#repository-token) apply. The runner
needs Bash 4.4 or newer, AWK and the GitHub CLI, as provided by GitHub-hosted
Ubuntu runners.

```yaml
permissions:
  contents: read
  id-token: write
steps:
  - uses: actions/checkout@v7
    with:
      persist-credentials: false
  - uses: actions/download-artifact@v8
    with:
      path: build
      merge-multiple: true
  - uses: kjanat/beepboop/actions/publish-tagged-release@v1
    with:
      changelog: CHANGELOG.md
      asset-directory: build
      prerelease: ${{ contains(github.ref_name, '-pre') }}
```

When you set `changelog`, the action uses the exact `## [<tag>]` section
and fails if it is absent or empty. Alternatively, set `notes-file` to a file
your job generates or omit both inputs to use GitHub's generated notes.
The title defaults to the tag; set `title` to override it.
GitHub decides which stable release to mark Latest unless you set `latest`.
Prereleases are never marked Latest.

When you set `asset-directory`, the action sends the visible regular files
directly in that directory. An empty directory, subdirectory or symlink is an
error. Put only the intended release assets there. Omit it for a release with
no assets.

The action creates a release once. It does not edit or replace an existing
release. Use [publish-release](../publish-release/action.yml) to publish a
release that belongs to a tracked Beepboop execution.
