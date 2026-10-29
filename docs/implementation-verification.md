# Release engine verification

The implementation is repository-configured. Ecosystem adapters own discovery,
version edits, dependency updates, and public registry verification. The execution
journal runs managed preparation and repository workflows; reusable Actions apply
plans, report outputs, publish guarded refs, and generate WinGet manifests.

| Requirement                                         | Implementation                                                                      | Verification                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Immutable release identity and durable delivery     | `types.ts`, `store.ts`, coordinator release outbox                                  | `events.test.ts`; Worker restart fixture                                         |
| Preview binds preparation to the reviewed plan      | source and plan fingerprints, including configuration/preset revisions              | `managed.test.ts`; Chromium preview/prepare checks                               |
| Upstream and destination revisions stay separate    | execution context and subscription deliveries                                       | `precommit.test.ts`, `distribution.test.ts`                                      |
| Manager extension boundary                          | `managers/registry.ts`; Cargo/npm adapters; OCI verifier                            | `managers.test.ts` includes an injected editor                                   |
| Explicit, incremented, prerelease, and tag versions | `version.ts`; stream tag source                                                     | `version.test.ts`, `refs.test.ts`                                                |
| Workspace and independent versions                  | `planRelease`, `planReleaseSet`, `compileReleaseSet`                                | `automation.test.ts`, `planning.test.ts`, `release-set.test.ts`                  |
| Managed preparation without workflow                | immutable plan and checkpointed PR journal                                          | `managed.test.ts`; Worker interruption/restart fixture                           |
| Workflow preparation and lockfiles                  | prepare Action and coordinator submission journal                                   | `preparation-action.test.ts`; Worker interruption/restart fixture                |
| Platform operation graph and declared outputs       | output contracts and atomic release-set enqueue                                     | `outputs.test.ts`, `release-set.test.ts`; Worker replay fixture                  |
| Promotion and publication gates                     | dependency checks, approval endpoint, publication identity checks                   | `release-set.test.ts`; Worker signature/check/registration fixtures              |
| Signed version tags and guarded aliases             | `publish-refs` Action, leases, atomic push                                          | `refs.test.ts` uses temporary Git remotes and an ephemeral SSH signing key       |
| Declarative JSON/YAML/TOML/text version files       | `editors.ts`, stream `versionFiles`                                                 | `editors.test.ts`                                                                |
| Pre-commit revisions and distribution consumers     | hook manager and upstream release context                                           | `precommit.test.ts`, `distribution.test.ts`                                      |
| Configurable WinGet generation                      | library, CLI, bundled Action                                                        | `winget.test.ts` includes two package identities and standalone Node execution   |
| Combined distribution contracts                     | preparation → platform outputs → registry result → WinGet → aliases → hook consumer | `distribution.test.ts` uses synthetic repositories and mocked registry responses |
| Dashboard release sets                              | preview gating, preparation, merged-revision start, execution context               | `ui.test.ts`; Chromium interaction check against a local fixture API             |

The combined contract fixture supplies promotion and producer outcomes. Separate
fixtures exercise cryptographic Git signing, coordinator approval gates, artifact
contracts, and durable recovery. Builds and registry publication commands execute
in repository workflows. WinGet generates manifest files; submission to the
Microsoft manifest repository is a separate publication operation.

## Repeatable checks

```sh
bun run typecheck
bun run lint
bun test
bun run build:winget
bun run check:bundle
bun run test:runtime
git diff --check
```

The Chromium check exercised prepare-before-preview rejection, rejection after a
plan edit, forwarding the preview revision into preparation, filling the preparation
ID, and sending the merged revision to release-set start. It reported no page
JavaScript errors. The fixture API performed no remote operations.
