# Migrate from route-based delivery

The route-based service uses `wrangler.jsonc`, `routes.json`, and
`ReleaseCoordinator`. Repository automation uses `wrangler.automation.jsonc`,
`.github/beepboop.json` in each repository, and `AutomationCoordinator`.
`AUTOMATION_ENABLED=true` selects repository automation for the deployment.

## Before switching

1. Complete the [deployment setup](deployment.md).
2. Inventory each destination's current publishing workflow and trigger.
3. Prepare repository configuration, workflow integration, and credential grants.
4. Identify the signing, candidate checks, and required publications for each
   destination and include them in its workflow and stream configuration.

The automation deployment includes the `COORDINATOR` binding and its `v1`
storage migration so existing delivery history is available during the transition.

## Move a repository

1. Inspect the repository and open its onboarding PR.
2. Review the proposed `mode: "observe"` bindings and package list. Split packages
   with independent versions into separate streams.
3. Merge the configuration. Observation follows the existing workflow triggers.
4. Add the generic Actions and `beepboop_execution_id` dispatch input to operations
   that Beepboop will start. Set their mode to `dispatch` with an exact ref.
5. Disable the previous trigger for each delivery when enabling its replacement.
6. Confirm the release's required publications in the dashboard.

For Actionlint, coordinate direct Homebrew and Scoop publishing with their
replacement subscriptions. For Actup, replace the fixed `publish-actup` consumer
with repository-owned delivery workflows and generic Actions.

## Remove the old implementation

After every destination has moved, remove `routes.json`, the route-based router
and dashboard, and the bespoke publisher Actions and Python consumers. Update
CI to remove their tests. Review Cloudflare storage deletion separately before
removing the old Durable Object class and binding.

During migration, the old implementation can be checked with:

```sh
python3 -B -m unittest discover -s packages/consumer -p 'test_*.py'
bun run check:bundle
bun run test:runtime
```
