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

The dashboard uses server-rendered HTML and a small browser client. Physical-key
registration uses the browser's WebAuthn APIs. Generic Actions connect repository
workflows to the service.

Deployment instructions are in [deployment.md](deployment.md).
