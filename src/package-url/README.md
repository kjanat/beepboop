# PURL reference data

`definitions.json` contains all 42 type definitions from
https://github.com/package-url/purl-spec at commit
`856b0939f0a5636bb67c5bb67fec99be079bda84`, sorted by filename, without changing
individual definitions. The upstream license is in `LICENSE`. Corresponding
upstream type tests are copied unchanged into `test/fixtures/purl`.

`index.ts` uses these definitions for registered types, component requirements,
case rules, permitted-character expressions, and qualifier requirements. Core
parsing and type-specific normalization use `packageurl-js`, with compatibility
corrections for the newer reference data (including npm case preservation, Git
repository paths, CPAN distribution names, and canonical colon encoding).
Default qualifier values describe omitted values; they are not inserted into
identifiers. Unknown qualifiers survive round trips.

The test runner executes the upstream **required** cases. Recommended input
repair cases are deliberately separate from required conformance. One upstream
fixture is contradictory: Maven case 13 accepts `repositorY_url`, while RPM case
1 and Gem case 1 require rejecting uppercase qualifier keys. Maven case 13 is
executed with an explicit standards correction: its original input must fail,
then the same input with `repository_url` must produce the expected components
and round-trip. The fixture itself stays unchanged; an assertion pins its input
so an upstream change cannot silently inherit the correction. No required case
is skipped or marked TODO. This is one documented deviation from the upstream
expected result, following
[ECMA-427 §5.6.6](https://github.com/package-url/purl-spec/blob/856b0939f0a5636bb67c5bb67fec99be079bda84/docs/specification/standard/Clause-5-Package-URL-Specification.md#566-qualifiers).

Updating: clone the upstream repository, record its exact commit, aggregate the
sorted `types/*-definition.json` files, copy `tests/types/*-test.json` without
editing their contents, and run `bun test test/purl-conformance.test.ts`.
