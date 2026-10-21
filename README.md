# Beepboop

<img src="assets/beepboop.png" alt="Beepboop robot" width="180">

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
By default only stable semantic releases meeting a route's minimum version are eligible;
prerelease observation uses a separate explicit channel.

Readiness requires selected successful jobs from the configured source workflow,
configured event (release by default), tag and commit. Overall workflow completion is deliberately not a
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

This deployment uses [Beepboop by kjanat](https://github.com/apps/beepboop-by-kjanat)
(App ID `5399528`), installed on `actionlint`, `actionlint-pre-commit`,
`scoop-bucket` and `homebrew-tap`. Reuse that App for this deployment.

The checked-in routes enable reconciliation for stable actionlint releases from
v2.0.0 onward. Before publishing the first eligible release, authorize the
[pre-commit signing identity](https://github.com/kjanat/actionlint-pre-commit#publication)
and run its `signing-probe.yml` workflow. Activation alone does not prove that
downstream signing or publication succeeds.

The pre-commit signing identity was authorized on 2026-10-20, and its
[live OIDC signing probe passed](https://github.com/kjanat/actionlint-pre-commit/actions/runs/39469327500/attempts/2).
Both commit and annotated-tag signatures were verified. The first actual v2
release delivery still requires the upstream release, wheels and image.

1. Run `bun install --frozen-lockfile`.
2. Generate the GitHub App manifest: `bun run app:manifest`. Register the private
   App on the account and install it on selected source/destination repositories.
   It requests Contents read, Actions write and release/workflow_run webhooks.
3. Put `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PKCS8 PEM) and
   `GITHUB_WEBHOOK_SECRET` into Worker secrets. Never commit them or copy them into
   repository CI. Convert GitHub's PKCS1 key locally to PKCS8 if necessary.
4. Set the verified account ID and checked-in routes; leave `enabled: false`
   until consumers, signing authorization and App installation are ready.
   Update custom domain/account in `wrangler.jsonc` for a different account.
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
The full runtime flow then exercises a signed webhook, readiness waits, all three
dispatches, restart recovery, downstream completion and duplicate delivery against
the shipped bundle. GitHub and PyPI responses are fixtures; no release is created.
This test also exercises the real Worker fetch path, whose invocation and redirect
semantics differ from Bun and Node.

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

## Actup release tracking and delivery

The root page (`GET /`) shows each configured route, discovery health, the latest
recorded publication checks, and links to source and destination runs. `/operations`
continues to expose the journal as JSON, now including per-job and per-registry
checks. A failed job is displayed as failed; an unavailable registry is unknown,
not successful. Refresh the page to retrieve the latest recorded state.

Routes may opt into these fields:

- `enabled: false` suspends discovery and processing for that route.
- `mode: "observe"` tracks publication without dispatching a destination workflow.
- `channel: "prerelease"` selects prereleases exclusively. The default is stable
  only; stable and prerelease routes have independent watermarks. SemVer comparison
  includes prerelease precedence and ignores build metadata.
- `readiness[].event: "push"` verifies tag-push runs. The default remains `release`.
  Repository, workflow, commit, tag, event and required successful jobs must match.
- `npm` names one package; `crates` lists required crates. Registry checks require
  the exact release version, and crates must not be yanked. No GitHub token is sent
  to a package registry. PyPI remains supported by the existing `pypi` field.

Optional defaults are omitted when parsing legacy routes, preserving their stored
route identities. Changing an existing route still requires a new route ID for
pending work. An observation is complete once all its checks succeed; this is a
publication snapshot, not continuous monitoring for later package withdrawal.

Actup has four initially disabled routes: stable publication, prerelease
publication, stable Scoop delivery, and stable Homebrew delivery. They require all
nine crate publishing jobs, npm, and the container job, plus exact npm/crates.io
versions. Alpha releases never enter the stable delivery routes.

`actions/publish-actup` independently verifies the fixed Actup repository ID,
signed annotated tag, exact source commit and successful tag-push publication
jobs. It verifies `SHA256SUMS.txt` using GitHub attestations from Actup's release
workflow on GitHub-hosted runners, then checks release archive digests against
those attested checksums. Fixed local templates generate `bucket/actup.json` or
`Formula/actup.rb`; no downloaded Ruby or package script is executed. Publication
supports a missing initial manifest, rejects downgrades and changed bytes for an
existing version, rechecks release/tag identity, and uses compare-and-swap updates.

### Activation order

1. Commit and publish the reviewed Beepboop implementation. Pin the new
   `actup-release.yml` receiver workflows in `kjanat/scoop-bucket` and
   `kjanat/homebrew-tap` to that exact implementation commit. Their local preparation
   uses `@master` only until that commit exists. Publish the receiver workflows.
2. Publish Actup's checksum attestation and `environment: npm` workflow changes.
   Existing release prerequisites, including its tracked lockfile and version
   agreement, must also be satisfied before creating a release.
3. Install the existing app on `kjanat/actup`, retaining the selected destination
   installations. The service continues to hold the private key centrally.
4. Enable the observation routes and deploy the Worker. Publish an authorized,
   signed Actup release through its normal release workflow.
5. While production delivery routes remain disabled, run explicitly authorized
   receiver dry runs (`dry_run: true`) with the production operation identity
   `<Actup repository ID>:<release ID>:actup-scoop` or `:actup-homebrew`. After both
   succeed, enable those routes, which have `dryRun: false`, and deploy. This avoids
   consuming the production journal operation with a dry run.

No app permissions, secrets, workflows, or deployments are changed by editing this
repository. These are separate activation operations. Existing Actionlint routes
continue to use their original contracts.
