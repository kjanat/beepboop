# Beepboop CLI

The Bun CLI uses DreamCLI and the same API and repository policy as the dashboard.
Run it from this checkout with `bun run beepboop`, or run `bun link` once to install
its `beepboop` executable locally. Bun must be installed; no generated `dist/`
CLI is needed.

```sh
bun run beepboop auth login
bun run beepboop auth status
bun run beepboop repositories list
bun run beepboop repositories show kjanat/actionlint
bun run beepboop repositories discover kjanat/actionlint
bun run beepboop runs list
bun run beepboop secrets
```

`auth login` prompts for the server URL and whether to open your browser. It also
prints the URL and a confirmation code. Open the URL, sign in through
OpenAuth if needed, compare the code, and approve your terminal. The command waits
up to five minutes. Approval is exchanged once for a session lasting eight hours.
`auth logout` revokes that session on the server and deletes the local credential.
Expired or revoked sessions require another login; there is no refresh token.

Credentials are separate for each server. They are written atomically with mode
`0600` under `$XDG_STATE_HOME/beepboop` (default `~/.local/state/beepboop`), in a
`0700` directory. The server stores only a hash of the session token. Server-side
sessions use the existing `sessions` table and expiry checks.

Every command accepts `--server https://beepboop.kjanat.dev`, or reads
`BEEPBOOP_SERVER`. HTTP is allowed only for localhost development. The CLI refuses
redirects when sending credentials. The new authentication endpoints must be
deployed before using this CLI against a server.

Repository and run lists display tables; add `--json` for their full API records.
Plans and other structured responses are JSON. Use `--help` on any command.
Missing repository, stream, version, plan, and approval inputs are prompted for in
an interactive terminal. Explicit arguments skip their prompts; scripts must
supply required inputs. Use `auth login --server URL --no-browser` to print the
login link without opening a browser.

Flags use camelCase, including `--sourceSha` and `--planId`.

## Release preparation and execution

Use stream names from `repositories show`. Repository numbers are resolved from
the enrolled repository name.

```sh
beepboop releases plan kjanat/actionlint --stream main --version 2.1.0
beepboop releases prepare kjanat/actionlint --stream main --version 2.1.0 \
  --sourceSha REVIEWED_SOURCE_SHA --planId REVIEWED_PLAN_ID
beepboop releases start PREPARATION_ID --sourceSha REVIEWED_SOURCE_SHA
beepboop runs list
beepboop runs approve EXECUTION_ID --sourceSha REVIEWED_SOURCE_SHA
beepboop runs recover EXECUTION_ID
beepboop runs recover EXECUTION_ID --action retry
```

Use the exact `sourceSha` and `planId` returned by the preview. Preparation rejects
changed plans on the server. Start a release set after its preparation has
completed and the repository's required review/merge steps are done. Approval is
bound to the exact reviewed commit. Recovery defaults to reconciliation; retry
must be selected explicitly. Existing server approval and dispatch rules apply.

Independent monorepo releases use the JSON plan format documented in
[release planning](release-planning.md):

```sh
beepboop releases plan-set OWNER/REPO --stream main --plan release-plan.json
beepboop releases prepare-set OWNER/REPO --stream main --plan release-plan.json \
  --sourceSha REVIEWED_SOURCE_SHA --planId REVIEWED_PLAN_ID
```

The `secrets` command returns metadata and grants, never secret values. Secret
writes, reveals, grant changes, and security-key management use the dashboard's
fresh WebAuthn verification. A CLI session does not remove that requirement.
