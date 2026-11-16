# Sigstore compatibility patch

`@sigstore%2Fcore@4.0.1.patch` mirrors the explicit signature-digest selection in [upstream Sigstore commit 3154029799fe44e6a037fc634e175abe091521b3](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/packages/core/src/crypto.ts).

Node defaults to SHA-256 when verifying EC or RSA signatures without an explicit algorithm. Workers requires the digest to be specified. The patch chooses SHA-256 for those key types and retains the existing defaults for EdDSA and restricted RSA-PSS keys. It preserves the upstream source and license.

Bun applies the patch through `patchedDependencies` during installation. The attestation regression uses Wrangler's production bundler and workerd to verify both public Sigstore and GitHub private-instance signatures. Remove the patch when upgrading to a published Sigstore core version containing the upstream fix.
