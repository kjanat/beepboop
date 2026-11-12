# Target descriptor compatibility fixtures

These fixtures were copied from the actual project files below. Formatting is
normalized; the descriptor fields and values are preserved. They exercise the
shared runtime contract and the generated JSON Schema together.

| Fixture             | Source checkout and path                    |
| ------------------- | ------------------------------------------- |
| `runner.json`       | `runner/packaging/npm/targets.json`         |
| `actionlint.json`   | `actionlint/distribution/npm/targets.json`  |
| `kprint.json`       | `dprint/dprint/deployment/npm/targets.json` |
| `overseer.json`     | `overseer/npm/scripts/platforms.json`       |
| `kprint-build.json` | `dprint/dprint/.github/build-matrix.json`   |

The original `$schema` fields are part of the captured input. Tests validate
against Beepboop's generated `schemas/targets.v1.json`, rather than fetching
those original schema references. Project-specific names stay in these fixtures;
the production reader uses descriptor fields and package manifests.
