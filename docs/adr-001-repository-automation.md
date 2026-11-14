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
so reconciliation preserves existing children and their progress. Legacy repair
retains the parent's configuration and source commit but requires the currently
discovered workflow and package inventory to derive missing children. It does not
reconstruct historical discovery. If that inventory no longer supports a binding,
repair fails closed and quarantines the parent with a diagnostic. Restore a
compatible discovered inventory and explicitly reconcile the parent to retry;
existing children remain unchanged.

Repository access lives in D1's `access` and `suspended_at` columns. Discovery
updates inventory and configuration without writing access, and returns the
current persisted access state. Coordinators read that authority before each
execution advances during reconciliation; missing enrollment or a failed access
read prevents execution. Suspension stops subsequent executions in the pass.
An execution already advancing may finish its current work, including external
requests. The access read authorizes that execution advance. Database
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

Each attempt reads fresh destination settings. Changes to its enabled state,
kind, or credential alias increment a persisted revision. After secret retrieval,
a single database read checks both the lease and that enabled destination's
revision before starting HTTP. A changed revision leaves the attempt retryable;
the next claim reads the replacement settings, or fails if the destination stays
disabled. Disable followed by enable also invalidates the old snapshot. Cosmetic
name/subscription changes do not invalidate it. Claims consumed before HTTP still
count toward the five-claim budget.

This final database read is the send authorization boundary. A change or removal
that commits after it may race with an HTTP request already authorized to start;
an in-flight request cannot be revoked at its receiver. Its lease still controls
settlement. Malformed payloads fail without HTTP and remain visible in API and
dashboard history with their delivery identity, attempt count, and error; their
payload is null rather than preventing other deliveries from being read.

The claim prevents overlapping passes from sending the same live attempt. A
remote endpoint can accept a request before a Worker loses its response or crashes;
retrying that ambiguous attempt can still deliver again. Requests retain their
stable event ID in `Idempotency-Key` so receivers can deduplicate them.

## Bounded recovery and completion evidence

A reconciliation pass indexes successful executions by release identity once.
Completion results are shared within each group. Only successful journal commits
update the index; detached snapshots prevent uncommitted execution changes from
altering its receipts. The coordinator lock owns the index for the pass, and
cleanup releases it on every exit. Terminal ledger and continuation repair still
run, and fresh repository access still authorizes each advance.

Migration `0019_release_completion.sql` adds validated, compact completion
metadata and a frontier of release proofs for each repository, stream and group.
A proof dominates another when its version and completion time are both at least
as high. Keeping only non-dominated points makes completion times strictly
fall as versions rise. A visible failed run therefore needs one indexed lookup:
find the lowest version above its own, then check the returned completion time.
The query returns at most one compact proof per candidate, including when no
proof qualifies; it never loads historical artifact payloads.

Binary version keys preserve SemVer precedence, including arbitrary-precision
numeric identifiers, prereleases and ignored build metadata. Database triggers
maintain the frontier in the same transaction as its release metadata. New points
use indexed dominance and pruning boundaries. A material update or deletion of
a frontier point rebuilds its affected group so previously dominated proofs can
reappear. Reindexing unchanged metadata skips that work. Existing release documents
are normalized once in batches of 100, with byte-bounded parameters and conditional
updates protecting concurrent projection writes. Invalid documents cannot provide
completion evidence. Legacy completion timestamps retain their earliest projection
time.

## Response and polling ownership

Registry responses require an Effect scope, and each GitHub retry owns its response
inside a separate scope. Cleanup runs on early returns, failure and interruption.
Cancellation has a one-second cleanup deadline so an unresponsive stream cannot
hold a reader lock or block completion indefinitely. Intermediate retryable GitHub
errors are cancelled without reading their bodies. Final diagnostic bodies are
limited to 8 KiB and two seconds; normal successful payload decoding is unchanged.
Verification contexts share a single in-flight token request and retain a successful
result, while failed or fully interrupted acquisition can be retried.

Dashboard polling schedules its next request only after the previous one settles.
A request receives a 20-second cancellation deadline. Hidden pages and page teardown
cancel work, and resumed pages restart visible polling. A cancelled result cannot
reload the page; even a transport that delays cancellation retains its occupied slot
until settlement, preventing overlapping requests.
