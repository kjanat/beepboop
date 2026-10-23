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
- uses: kjanat/beepboop/actions/generate-winget@IMPLEMENTATION_SHA
  id: winget
  with:
    config: distribution/winget.json
    version: ${{ steps.release.outputs.version }}
    checksums: dist/checksums.txt
    release-notes: dist/release-notes.md
    release-date: ${{ steps.release.outputs.date }}
    out: dist/winget
```

Replace `IMPLEMENTATION_SHA` with the reviewed Beepboop commit. The `release`
step in this example supplies the release version and date. The Action ships a
bundled Node entrypoint and outputs `directory` and `files` (a JSON path array).
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

The generator is in `src/distribution/winget`. Rebuild the Action after changing
it or its dependencies:

```sh
bun run build:winget
bun test test/winget.test.ts
```

CI rebuilds the bundled Action and checks for a diff. The generator performs no
network requests and uses the checksums supplied by the calling release workflow.
