# Deploy Beepboop

Beepboop runs on Cloudflare Workers with D1 and SQLite Durable Objects. The
repository includes the configuration for `beepboop.kjanat.dev` and the
**Beepboop by kjanat** GitHub App (App ID `5399528`).

## Configure Cloudflare and login

1. Install dependencies with `bun install --frozen-lockfile`.
2. Create a D1 database and enter its ID in `wrangler.toml`.
3. Set the account, domain, owner ID, OpenAuth issuer/client, and exact
   `ADMIN_SUBJECT` for your deployment.
4. Register the OpenAuth callback URL: `<APPLICATION_ORIGIN>/auth/callback`.
5. Deploy through Cloudflare Workers Builds. The deployment command applies
   pending database migrations and backfills typed projection metadata before uploading
   the Worker. The existing Worker keeps serving until both stages finish successfully.

## Local development

Run `bun run dev` (or `bun run start`) and open `http://localhost:4321`. Startup applies the D1
migrations and projection backfill locally; it never migrates the deployed database. If you start Astro
directly, first run `bun run db:local`. A missing `sessions` table means these
migrations have not run against the local database. To prepare an isolated persistence
directory, run `bun run db:local -- --persist-to /absolute/path/to/state` and use the
same persistence directory for the local Worker. The default is `.wrangler/state`
in the repository.

Development uses `http://localhost:4321` as the application origin, including
login callbacks, mutation origin checks, and security-key registration. The port
is fixed so callback registration cannot silently drift when another process
occupies it. Production continues to use `APPLICATION_ORIGIN` from Wrangler.

The OpenAuth issuer must allow the exact callback
`http://localhost:4321/auth/callback` for client `beepboop`. Update and deploy the
issuer's registered client configuration through its normal deployment path;
changing this application's configuration cannot register an OAuth callback.
Use localhost consistently rather than switching to an IP address.

The local D1 database is independent of production: repositories, secret values,
and enrolled security keys must be configured locally. For GitHub operations and
encrypted storage, provide the required Worker secrets in local `.dev.vars`
using your secret-management tooling. Do not copy production database contents
into development to bypass setup.

## Configure the GitHub App

Generate the App manifest with `bun run app:manifest`. Review the requested
permissions and events, then install the App on the repositories it will manage.
Use `<APPLICATION_ORIGIN>/webhooks/github` as the webhook URL.

Cargo adoption checks require repository Secrets, Variables and Environments read
permissions. For an existing App, add these permissions in its GitHub settings,
then approve the permission update for each installation. Regenerating the
manifest only changes new Apps. A publishing-check access error identifies an
App installation permission problem separately from missing workflow configuration.

GitHub secret synchronization requires repository Secrets write and/or
Environments write permissions, according to the grant's delivery type.

## Add Worker secrets

Set these with `wrangler secret put NAME --config wrangler.toml`:

| Secret                   | Value                                                         |
| ------------------------ | ------------------------------------------------------------- |
| `GITHUB_APP_ID`          | GitHub App ID                                                 |
| `GITHUB_APP_PRIVATE_KEY` | App private key in PKCS8 PEM format                           |
| `GITHUB_WEBHOOK_SECRET`  | App webhook signing secret                                    |
| `VAULT_KEYS`             | JSON map of key IDs to base64-encoded 32-byte encryption keys |

`VAULT_ACTIVE_KEY` selects an entry in `VAULT_KEYS` for new ciphertexts. Older
ciphertexts require their corresponding keys until migrated or deleted.

## Generated types

`bun run types` generates Worker types from `wrangler.toml`; `bun run sync`
runs Astro sync. Install preparation and checking run both commands; development,
build and preview also generate Worker types before starting. The generated
`worker-configuration.d.ts` is ignored by Git and referenced once through the
base TypeScript configuration. Secret names are declared in Wrangler's
`secrets.required`; their values stay in Worker secrets or local secret files.
There is no custom type-generation wrapper or duplicated hand-written `Env`.

Type checking uses TypeScript 7.1 beta with `@astrojs/ts-content-mapper`
registered in the root tsconfig. `bun run check` runs `tsc --noEmit
--runExternalCode` for the server and Astro components, then checks browser
code with its existing DOM tsconfig. The external-code flag enables Astro's
mapper; `astro check` and the separate TypeScript alias are no longer used.

## Deploy and enroll keys

```sh
bun run check
bun run deploy:dry
bun run deploy
```

For Cloudflare Workers Builds, set the deploy command to `bun run deploy`.
The build-command field can stay empty: the deploy script runs `astro build`
first, applies pending D1 migrations to the production `beepboop` database,
then drains legacy execution-state and release-completion metadata in bounded
pages before deploying its generated `dist/server/wrangler.json` configuration.
SQL migration or backfill failure stops deployment. Backfill updates use compare-and-swap
checks, resume safely after interruption, and print only final row counts. Request
handlers perform only a bounded tail step and report pending maintenance when
legacy rows remain; they never drain historical metadata during a request.
The database tooling uses an isolated configuration containing only the public D1
binding, does not load local environment files, and disposes its proxy after use.
Both local and remote backfills run through the same Node.js subprocess because
Wrangler remote bindings require Node's transport. The remote connection uses
Wrangler's authenticated Workers preview session. The Builds API token must retain
its Workers deployment access and D1 edit access.
Dependency installation and `astro sync` do not build the Worker. Running
`bunx wrangler deploy` directly from a fresh checkout instead bundles the source
entrypoint and fails on Astro's virtual modules. Do not add aliases for those
modules; Astro resolves them during its build.

`bun run deploy:dry` builds Astro and checks the generated Worker with
`wrangler deploy --dry-run`. It never applies remote migrations, runs the database backfill, or publishes a
Worker. Keep schema migrations compatible with the currently running Worker because
migrations run before its replacement is uploaded.

Sign in to the dashboard and enroll the first physical security key. Enroll a
second key with a touch of the first.

The login uses authorization code with PKCE and a secure HttpOnly cookie. An
expired session requires login again. Storing, revealing, granting, revoking
and synchronizing credentials require a fresh security-key assertion. Authentication proofs expire after one minute and
challenges after two minutes. Key enrollment accepts cross-platform, single-device
authenticators and rejects cloud-synced credentials; manufacturer attestation is
not checked.

## Notifications

Store each Slack Incoming Webhook or HTTPS webhook URL as a secret, then add a
destination on the Notifications page. Each delivery attempt reads the URL from
the vault. Logs and delivery records hold only the HTTP status.
