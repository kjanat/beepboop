# Publish release refs

Use this action after `actions/begin`, with the repository token issued by
`actions/token`. The configured distribution paths can be passed through `files`
or uploaded as a GitHub Actions artifact.

## Uploading a distribution artifact

An artifact must contain the configured files at their exact repository-relative
paths and a root `beepboop-distribution.json` manifest. The manifest lists every
configured file exactly once, with its Git mode (`100644` or `100755`). Beepboop
validates the manifest and restores those modes when creating the distribution
commit. The manifest is transport metadata and is not committed.

Artifact transport supports 1–64 distinct configured files and at most 128 parent
directories. The manifest and optional attestation have their own two-file
allowance, so they do not consume the configured-file budget. ZIPs can contain up
to 128 directory entries, for at most 194 entries total. The repository-root name
`beepboop-distribution.json` is reserved for the manifest when using artifact
transport; configured files cannot use it as their filename or parent directory.
Direct-file transport through `files` can publish that filename and
does not use these artifact-specific entry limits.

`actions/upload-artifact` normalizes file permissions and roots uploads at the
common ancestor of the selected paths. Include the manifest from the repository
root alongside the files: this preserves paths such as `dist/main.mjs` even when
all distribution files share the `dist` directory. Uploading only the two files
would produce `main.mjs` and `post.mjs` and is rejected. No attestation file is
needed to establish the archive root.

Run these steps from the repository root, after building the distribution. The
paths must match the distribution configuration. `token` below is the existing
`actions/token` step's ID.

```yaml
- uses: kjanat/actions-shells@v0.2.1
- name: Describe distribution files
  shell: actions-shell node {0}
  run: |
    const { lstatSync, writeFileSync } = require('node:fs');
    const paths = ['dist/main.mjs', 'dist/post.mjs'];
    if (!paths.length || paths.length > 64 || new Set(paths).size !== paths.length) {
      throw new Error('Artifact distribution requires 1 to 64 distinct files');
    }
    if (paths.some(path => path === 'beepboop-distribution.json' || path.startsWith('beepboop-distribution.json/'))) {
      throw new Error('Reserved artifact manifest path');
    }
    const directories = new Set(paths.flatMap(path => {
      const parts = path.split('/');
      return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
    }));
    if (directories.size > 128) throw new Error('Artifact distribution exceeds 128 directories');
    const files = paths.map(path => {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size === 0) throw new Error(`Invalid distribution file: ${path}`);
      return { path, mode: stat.mode & 0o111 ? '100755' : '100644' };
    });
    const manifest = JSON.stringify({ version: 1, files });
    if (Buffer.byteLength(manifest) > 65536) throw new Error('Artifact manifest exceeds 64 KiB');
    writeFileSync('beepboop-distribution.json', manifest);
- uses: actions/upload-artifact@v7
  id: distribution
  with:
    name: distribution
    if-no-files-found: error
    path: |
      beepboop-distribution.json
      dist/main.mjs
      dist/post.mjs
- uses: kjanat/beepboop/actions/publish-refs@v1
  with:
    token: ${{ steps.token.outputs.token }}
    artifact-id: ${{ steps.distribution.outputs.artifact-id }}
    artifact-digest: ${{ steps.distribution.outputs.artifact-digest }}
```

The artifact must belong to the current workflow run and attempt. The downloaded
ZIP is limited to 8 MiB, unpacked files to 16 MiB, and the manifest to 64 KiB.
Only configured files, the manifest, and an optional `attestation.json` are
accepted; the optional attestation is not used as a provenance check.
