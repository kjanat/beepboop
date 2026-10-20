# Beepboop

One GitHub App routes verified releases to repository-owned publishing workflows.
The App key lives in one Cloudflare Worker. Source CI needs no cross-repository credentials.

## Operation

`routes.json` is the only routing authority. Every source and destination has a
repository ID and full name. Webhooks are HMAC-verified over their original bytes,
then only wake the reconciler. Payloads cannot supply workflow names, branches,
URLs, commands, or installation IDs.

A SQLite-backed Durable Object journals each source repository/release/route
operation before dispatch. Alarms retry pending work; a ten-minute cron recovers
missed webhooks. The service re-fetches the release, verifies its signed annotated tag, and records
asset IDs, sizes and SHA-256 digests. Changed tags or assets fail the operation.
Only stable semantic releases meeting a route's minimum version are eligible.

Readiness requires selected successful jobs from the configured source workflow,
release event, tag and commit. Overall workflow completion is deliberately not a
prerequisite: unrelated distribution jobs must not introduce circular waits.
Optional PyPI readiness checks the exact published version. Required Docker
publication must be included in the route's successful-job requirements.

Tokens are short-lived and restricted to one repository: source reads use
Contents read and Actions read; destination dispatch uses Contents read and
Actions write. Every token is followed by repository and owner identity checks.

The GitHub API's returned workflow run ID is journaled. Dispatch acceptance is not
publication success: only a successful downstream run completes the operation.
An ambiguous response is reconciled by exact workflow/ref/run title for ten
minutes before retrying. Consumers must be idempotent and reject downgrades.
Retries stop after five ambiguous dispatches. Destination failure stays visible; the service watches the same run ID for seven
days so a successful manual rerun can recover it. It never creates an automatic
retry of a failed destination job. A per-route
version watermark is reserved before dispatch to prevent older pending releases
from overtaking newer releases. Failed newer work therefore requires repair, not
fallback to an older package.

## Destination interface

```yaml
run-name: Beepboop ${{ inputs.operation_id }}
on:
  workflow_dispatch:
    inputs:
      source_repository_id: { type: string, required: true }
      release_id: { type: string, required: true }
      source_sha: { type: string, required: true }
      operation_id: { type: string, required: true }
      dry_run: { type: boolean, default: false }
```

The destination runs trusted code from its configured branch and uses its own
`GITHUB_TOKEN` for local writes. Inputs are claims, not authority. Independently
verify the allowed source ID, release/tag commit, prepared publication evidence
and exact asset bytes before writing. Existing plugin registry OIDC admission
remains separate; this service cannot admit registry submissions.

## Setup

1. Run `bun install --frozen-lockfile`.
2. Generate the GitHub App manifest: `bun run app:manifest`. Register the private
   App on the account and install it on selected source/destination repositories.
   It requests Contents read, Actions write and release/workflow_run webhooks.
3. Put `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PKCS8 PEM) and
   `GITHUB_WEBHOOK_SECRET` into Worker secrets. Never commit them or copy them into
   repository CI. Convert GitHub's PKCS1 key locally to PKCS8 if necessary.
4. Set the verified account ID and checked-in routes; leave `enabled: false`
   until consumers and App installation are ready. Update custom domain/account
   in `wrangler.jsonc` for a different account.
5. Run verification, then deploy with `bunx wrangler deploy`. Configure webhook URL
   `https://beepboop.kjanat.dev/webhooks/github`.

`GET /health` reports service enablement. `GET /operations` exposes public
repository/release identities and processing states; it exposes no tokens, keys,
API response bodies, or webhook payloads. This service is configured for public
repositories. Do not route private repositories without protecting that endpoint.

## Verification

```sh
bun run types
bun run typecheck
bun run lint
bun test
python3 -B -m unittest discover -s packages/consumer -p 'test_*.py'
bun run check:bundle
bun run test:runtime
```

Tests cover raw-body signature forgery, repository substitution, source evidence,
asset/tag mutation, durable restart semantics, ambiguous dispatch recovery,
downstream failures and anti-downgrade behavior. Tests use injected HTTP and
journal boundaries. A real workerd smoke test verifies SQLite persistence across
runtime restarts and alarm scheduling; dry-run bundling validates the Worker entry point.

API references: [workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event),
[installation token scoping](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
[Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).


## Downstream publication proof

`actions/publish-manifest` verifies actionlint's signed annotated release tag,
trusted successful prepare run and `release-candidate.json` build attestation.
The attestation must originate from the source release workflow at the exact
source commit and tag, on GitHub-hosted runners. Package bytes must match the
attested manifest. Scoop archive URLs/hashes must match prepared release assets;
Homebrew Ruby is syntax-checked with `ruby -c` without executing it. Release and
tag identities are checked again immediately before the compare-and-swap write.

Receivers need their own `GITHUB_TOKEN` with `contents: write` and
`attestations: read`; set workflow defaults to `contents: read` and grant write
only to the publishing job. The helper does not grant tokens to callers. `gh`
and Python 3 are required; Homebrew publication also requires Ruby. Public source
API/download requests intentionally carry no destination credentials. GitHub's
CLI uses the receiver token to retrieve and verify public attestations.

Release, workflow and job listing stop after 1,000 entries and fail closed if the
bound is exceeded. API JSON bodies are limited to 2 MiB; webhook bodies to 1 MiB.
