# PURL reference data

`definitions/*-definition.json` contains all 42 separate type definitions from
https://github.com/package-url/purl-spec at commit
`856b0939f0a5636bb67c5bb67fec99be079bda84`, without changing the definition data. Local JSON formatting may differ.
`definitions/index.ts` registers every file in filename order. The upstream license is in `LICENSE`. Corresponding
upstream type tests are copied unchanged into `test/fixtures/purl`.

`source.json` pins the upstream repository and revision. `type-definition.schema.json`
contains its schema 1.1. `definition.generated.ts` is generated from that schema
with `json-schema-to-typescript`, including the upstream field descriptions.
`identity.generated.ts` is generated from all type definitions: it exposes the
registered type union and a discriminated identity union with required/prohibited
namespaces and required qualifiers for each type. Extra qualifiers remain allowed.
`definition.ts` validates data directly against the original JSON schema using a
Worker-compatible validator; there is no hand-maintained copy of its rules.

`index.ts` implements core parsing and serialization with `packageurl-js` and
checks registered type rules. Syntactically valid future types can be represented
without inventing ecosystem rules. `metadata.ts` exposes the registered definition,
effective repository and qualifier defaults, and advisory diagnostics. Defaults
never mutate identity. Additional qualifiers survive round trips.

`normalize.ts` provides explicit input repair. Strict parsing rejects uppercase,
encoded or duplicate qualifier keys. Normalization can lowercase keys, but rejects
collisions rather than silently losing one of the values. Type-specific
normalization uses the library plus compatibility corrections for the pinned data
(including npm case preservation, Git paths, CPAN names and canonical colon encoding).
Textual normalization rules remain accessible as part of the definition; they are
not executable expressions. In particular, a version-comparison algorithm such as
ALPM vercmp is not a license to rewrite a package version.

There are no release adapters or versionless selection rules in this module.
Those belong to `src/automation/package-identity.ts`.

The test runner executes **all required and recommended** upstream cases, including
`tests/spec/specification-test.json`. Required cases use strict parsing;
recommended cases use explicit normalization. Two inconsistent upstream expectations
have executable, documented corrections rather than skipped tests:

- Maven case 13 expects strict parsing to accept `repositorY_url`, while the standard
  and required RPM/Gem cases reject uppercase keys. Assert strict rejection and
  the expected normalized components and round-trip.
- Recommended Git case 0 lowercases the repository path although its definition
  declares that path case-sensitive. Assert preservation to avoid naming a different
  repository.

Original fixtures stay unchanged. Assertions pin the discrepant inputs so upstream
updates cannot silently inherit these corrections. These are deviations from the
fixture expectations, not claims of passing them unchanged. See
[ECMA-427 §5.6.6](https://github.com/package-url/purl-spec/blob/856b0939f0a5636bb67c5bb67fec99be079bda84/docs/specification/standard/Clause-5-Package-URL-Specification.md#566-qualifiers).

Regenerate deterministically without network access:

```sh
bun run purl:generate
bun run purl:check
```

Fetch the pinned upstream data and regenerate:

```sh
bun run purl:update
```

To advance the source, change the full revision in `source.json` first. Fetching
uses Git in a temporary checkout, verifies the revision, copies every definition,
the schema, license and both test groups, and removes files no longer present
upstream. `bun run purl:fetch --source /path/to/purl-spec` uses an existing checkout
at the pinned revision. Generation reads all definition files, so a new upstream
type automatically enters the registry and generated identity union. CI runs
`purl:check` to reject stale generated output.
