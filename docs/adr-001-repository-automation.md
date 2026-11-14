# ADR 001: Repository-owned release automation

## Responsibilities

Repositories declare release streams in `.github/beepboop.json`. Ecosystem
managers discover packages and calculate version edits. Shared presets provide
common defaults. GitHub Actions runs builds, generators, signing, and publishers.
The TypeScript Worker coordinates these operations and serves the dashboard.

## Storage

A Durable Object per repository serializes execution changes and journals
outbound mutations before sending them. Alarms resume work after interruption.
D1 stores repository configuration, the execution index, audit history, and
encrypted credentials. Reconciliation repairs the index from the execution journal.

Each execution captures its configuration and preset revisions, source commit,
workflow revision, and producing run. These fields identify the code used at each
stage of preparation and promotion.

## Authentication

GitHub Actions uses OIDC. The dashboard uses OpenAuth. Credential changes require
a single-use WebAuthn assertion from an enrolled physical security key.
Administrator grants scope credential access to a repository, operation,
workflow, ref, and optional environment.

## Recovery

An ambiguous dispatch response triggers a search for the matching workflow run.
An administrator can retry failed jobs. Publication reports identify package
versions and digests; subsequent reports must agree with that identity.
Successful publication results survive job retries.

## Publication checks

Registry queries check Cargo and npm versions, OCI manifests, GitHub releases,
and distribution manifests. Workflow and GoReleaser reports use the authenticated
producer's result, with artifact metadata checked against GitHub's API.

## Interface

Astro serves the dashboard pages and API endpoints through its Cloudflare adapter.
A small browser client handles forms and security-key prompts. The custom Worker
entrypoint retains scheduled events, Durable Objects, and service bindings. Physical-key
registration uses the browser's WebAuthn APIs. Generic Actions connect repository
workflows to the service.

Deployment instructions are in [deployment.md](deployment.md).

## State transition boundaries

Observed workflow completion and the creation of its dependent executions share
one journal transaction. A failed write leaves the observed execution unfinished
and retryable. Reconciliation also fills missing continuations for successful
executions written by older Workers. Continuation identifiers are deterministic,
so reconciliation preserves existing children and their progress.

Repository access lives in D1's `access` and `suspended_at` columns. Discovery
updates inventory and configuration without writing access, and returns the
current persisted access state. Coordinators read that authority before advancing
work; missing enrollment or a failed access read prevents execution. Database
constraints reject active access with a suspension time and suspended access
without one. Legacy document flags and Durable Object access copies no longer
participate in authorization.

Security challenges have three modes: authentication, initial enrollment, and
additional enrollment. Challenge creation reads credentials once. Additional
enrollment consumes a fresh proof before issuing its challenge. Initial enrollment
commits only if the subject still has no key. A concurrent first enrollment
therefore forces the other attempt to restart with proof. Old challenges with
boolean enrollment flags expire during the upgrade.

Notification delivery moves from pending to sending through an atomic database
claim. A sending row requires an owner token, expiry, and incremented attempt
count. Only the current, unexpired owner can settle it. An abandoned claim becomes
eligible again after 60 seconds; five claims exhaust the retry budget. Delivered
rows cannot carry errors, failed rows require errors, and only sending rows may
carry ownership. Removing a destination invalidates outstanding claims.

The claim prevents overlapping passes from sending the same live attempt. A
remote endpoint can accept a request before a Worker loses its response or crashes;
retrying that ambiguous attempt can still deliver again. Requests retain their
stable event ID in `Idempotency-Key` so receivers can deduplicate them.
