# PURL reference data

`definitions/*-definition.json` contains all 42 separate type definitions from
https://github.com/package-url/purl-spec at commit
`856b0939f0a5636bb67c5bb67fec99be079bda84`, without changing the definition data. Local JSON formatting may differ.
`definitions/index.ts` registers every file in filename order. The upstream license is in `LICENSE`. Corresponding
upstream type tests are copied unchanged into `test/fixtures/purl`.

`type-definition.schema.json` contains upstream schema 1.1; repository formatting
orders its unordered `required` lists.
`definition.ts` models its complete field structure with runtime validation and
inferred TypeScript types. Loading a definition preserves its repository data,
component rules, registered namespace values, qualifier defaults, explanatory
notes, examples and reference URLs.

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

Updating: clone the upstream repository, record its exact commit, copy every
`types/*-definition.json` file and update `definitions/index.ts`, then copy `tests/types/*-test.json` without
editing their contents, include `tests/spec/specification-test.json`, and run `bun test test/purl-conformance.test.ts`.
