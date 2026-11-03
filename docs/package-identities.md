# Package identities

Packages and publication records carry a structured `identity`:

```json
{
  "type": "npm",
  "namespace": "@kjanat",
  "name": "changelog-feed",
  "version": "1.2.3",
  "qualifiers": { "repository_url": "https://registry.npmjs.org/" }
}
```

The standalone model supports the core syntax and every registered type in the pinned upstream definitions
and preserves namespace, version, qualifiers and subpath. `packageUrl` serializes
it as a purl. `packageId` removes only the version to produce a selection key;
registry, platform, and subpath distinctions remain significant. npm case is
preserved, while GitHub owner/repository and VS Code publisher/name follow their
type-specific case rules. Prohibited namespaces are rejected. Types without a
registered definition follow core syntax and receive a metadata warning, without
invented ecosystem rules.

`packageIdentity` validates components; `purl` serializes them. `normalizePackage`
explicitly repairs qualifier-key casing. `packageMetadata` supplies the full type
definition, effective repository and qualifier defaults, and advisory diagnostics.
Defaults are metadata, not additions to the stored identity. The release-specific
`packageId`/`packageKey` policy lives in the automation layer.

The release `manager` is a discovery/editing/verification adapter, not the purl
type. Go maps to `golang`. GoReleaser packages discovered in a repository map to
that GitHub repository and its release tag, not a fictitious GoReleaser registry.
Local packages lacking an ecosystem identity use `generic`. A registered purl
type does not imply that Beepboop can publish to or verify that ecosystem.

An explicit identity is authoritative. Reading or writing a record does not replace
its version, namespace or qualifiers with legacy adapter fields. The legacy adapter mapping
is used only for records that do not yet carry an identity. Discovery adapters
provide an identity explicitly; the registry validates it and rejects missing
identities instead of inferring an ecosystem from an adapter name. D1 repository and execution reads normalize
legacy documents; writes persist normalized identities. Durable Object reads and
writes normalize publication identities as well. This uses existing JSON
columns and requires no destructive database migration. Existing execution IDs,
workflow checkpoints and frozen configurations are unchanged.

New onboarding configurations, dependency ordering and monorepo plan selections
use versionless purls. Existing `manager:name` selections and workflow reports
remain accepted as aliases. Canonical and legacy aliases cannot select the same
package twice in a release set. Publication gates, subscriptions and dashboard
summaries recognize both representations. Reports still validate native package
identity, exact version, and existing verification requirements.

The core type definitions and their conformance tests are documented in
[`src/package-url/README.md`](../src/package-url/README.md).
