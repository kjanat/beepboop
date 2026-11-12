# Generate Homebrew casks and Scoop manifests

Beepboop writes a Homebrew cask and a Scoop manifest from package metadata and
the release's SHA-256 checksums file. Each generator writes one file. The
metadata names the release assets; the checksums file supplies their digests.

## Homebrew cask

Start with [the cask example](../examples/homebrew/cask.json).

| Field         | Meaning                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| `token`       | Cask token and file name, `<token>.rb`.                                                     |
| `name`        | `name` stanza.                                                                              |
| `desc`        | `desc` stanza.                                                                              |
| `homepage`    | HTTPS homepage.                                                                             |
| `url`         | Download URL template. It accepts `{tag}`, `{version}` and `{asset}`.                       |
| `verified`    | Optional `verified:` value for a download host that differs from the homepage.              |
| `macos`       | `arm` and `intel` asset names, and optional platform `caveats`.                             |
| `linux`       | The same for Linux. A cask lists `macos`, `linux` or both.                                  |
| `naked`       | Optional `glob` and `name` for a raw binary: the cask moves the download and makes it 755.  |
| `binaries`    | `path` inside the staged download and optional `target`.                                    |
| `completions` | Optional `executable`, `arguments` and `shells` for `generate_completions_from_executable`. |
| `caveats`     | Optional caveats for every platform.                                                        |

Asset names accept `{version}`. Each architecture block carries its own
`version`, `sha256` and `url`, and the URL writes the version as `#{version}`.
The tag must contain the version. A tag with a prefix or suffix, such as
`tool-v1.2.3`, adds a matching `livecheck` regex. Completions create their
shell directories under the Homebrew prefix before installation. A cask with
macOS assets removes the quarantine attribute from the staged files.

```sh
bun run homebrew \
  --config examples/homebrew/cask.json \
  --version 1.2.3 \
  --checksums dist/SHASUMS256.txt \
  --out dist/homebrew
```

## Scoop manifest

Start with [the manifest example](../examples/scoop/manifest.json).

| Field          | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `name`         | Manifest file name, `<name>.json`.                                          |
| `description`  | `description` field.                                                        |
| `homepage`     | HTTPS homepage.                                                             |
| `license`      | `license` field.                                                            |
| `url`          | Download URL template. It accepts `{tag}`, `{version}` and `{asset}`.       |
| `architecture` | Asset name for `64bit`, `32bit` or `arm64`. Asset names accept `{version}`. |
| `bin`          | Executables, or `[executable, alias]` pairs, inside the archive.            |

```sh
bun run scoop \
  --config examples/scoop/manifest.json \
  --version 1.2.3 \
  --checksums dist/SHASUMS256.txt \
  --out dist/scoop
```

## GitHub Actions

```yaml
- uses: kjanat/beepboop/actions/generate-homebrew@v1
  id: cask
  with:
    config: distribution/homebrew.json
    version: ${{ steps.release.outputs.version }}
    tag: ${{ steps.release.outputs.tag }}
    checksums: dist/SHASUMS256.txt
    out: dist/homebrew
- uses: kjanat/beepboop/actions/generate-scoop@v1
  id: scoop
  with:
    config: distribution/scoop.json
    version: ${{ steps.release.outputs.version }}
    tag: ${{ steps.release.outputs.tag }}
    checksums: dist/SHASUMS256.txt
    out: dist/scoop
```

Each Action outputs `file`, the absolute path of the generated file. The tag
defaults to `v` followed by the version. Existing files are protected against
overwrites, so use an empty output directory.
