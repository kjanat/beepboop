# Deploy Beepboop

Beepboop runs on Cloudflare Workers with D1 and SQLite Durable Objects. The
repository includes the configuration for `beepboop.kjanat.dev` and the
**Beepboop by kjanat** GitHub App (App ID `5399528`).

## Configure Cloudflare and login

1. Install dependencies with `bun install --frozen-lockfile`.
2. Create a D1 database and enter its ID in `wrangler.automation.jsonc`.
3. Set the account, domain, owner ID, OpenAuth issuer/client, and exact
   `ADMIN_SUBJECT` for your deployment.
4. Register the OpenAuth callback URL: `<APPLICATION_ORIGIN>/auth/callback`.
5. Apply the database migration:

   ```sh
   bunx wrangler d1 migrations apply beepboop --remote --config wrangler.automation.jsonc
   ```

## Configure the GitHub App

Generate the App manifest with `bun run app:manifest`. Review the requested
permissions and events, then install the App on the repositories it will manage.
Use `<APPLICATION_ORIGIN>/webhooks/github` as the webhook URL.

GitHub secret synchronization requires repository Secrets write and/or
Environments write permissions, according to the grant's delivery type.

## Add Worker secrets

Set these with `wrangler secret put NAME --config wrangler.automation.jsonc`:

| Secret                          | Value                                                         |
| ------------------------------- | ------------------------------------------------------------- |
| `GITHUB_APP_ID`                 | GitHub App ID                                                 |
| `GITHUB_APP_PRIVATE_KEY`        | App private key in PKCS8 PEM format                           |
| `GITHUB_WEBHOOK_SECRET`         | App webhook signing secret                                    |
| `VAULT_KEYS`                    | JSON map of key IDs to base64-encoded 32-byte encryption keys |
| `AUTHENTICATOR_BOOTSTRAP_TOKEN` | Temporary token for the first security-key enrollment         |

`VAULT_ACTIVE_KEY` selects an entry in `VAULT_KEYS` for new ciphertexts. Older
ciphertexts require their corresponding keys until migrated or deleted.

## Deploy and enroll keys

```sh
bun run typecheck
bun test
bun run check:automation-bundle
bun run test:automation-runtime
bunx wrangler deploy --config wrangler.automation.jsonc
```

Sign in to the dashboard. Enroll the first physical security key with the
bootstrap token, then enroll a second using the first key. Delete the bootstrap
secret after enrollment.

The login uses authorization code with PKCE and a secure HttpOnly cookie. An
expired session requires login again. Credential operations require a fresh
security-key assertion. Authentication proofs expire after one minute and
challenges after two minutes. Key enrollment accepts cross-platform, single-device
authenticators and rejects cloud-synced credentials; manufacturer attestation is
not checked.

## Connect Vermon

Add a service binding in Vermon targeting Worker `beepboop`, entrypoint
`VermonEvents`. Pass the binding's fetch method to Vermon's HTTP webhook provider
for this destination. Send its `package.version.changed` payload with an
`Idempotency-Key` header equal to the event ID.

Repository [subscriptions](automation.md#subscriptions) select which package
events start operations.

For an existing route-based deployment, follow the [migration guide](migration.md).
