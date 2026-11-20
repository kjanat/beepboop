# Deployment protection rules

Research for a Beepboop handler that answers GitHub custom deployment
protection rules (DPR). Facts carry their source. Points marked *summary*
came from a summary of a page section that nobody read in full.

## Incident on 2026-11-20

The `publish` job in `.github/workflows/publish-actions.yml` failed on master
`06b6a7e` (run `44667091175`, attempts 1 and 2). Each attempt completed in the
second it started, with no runner, no steps, no log and no annotations.

The job runs in the `tag` environment with `deployment: false`. The `tag`
environment held these protection rules:

| Rule id    | Type                                  | Setting         |
| ---------- | ------------------------------------- | --------------- |
| `72903137` | `wait_timer`                          | 5 minutes       |
| `73234559` | `branch_policy`                       | branch `master` |
| `73234506` | custom rule, app `beepboop-by-kjanat` | enabled         |

The custom rule came from
`GET /repos/kjanat/beepboop/environments/tag/deployment_protection_rules`.
`GET /repos/kjanat/beepboop/environments/tag` lists only the wait timer and
the branch policy, so read both endpoints.

Approvals on the earlier green runs `44658537845` and `44593651385` say
"15 minute wait timer". The environment changed after 2026-11-20 02:24 UTC,
while its `updated_at` still reads 2026-11-12.

GitHub fails a job at once when its environment has a custom rule and the job
sets `deployment: false`:

> Custom deployment protection rules are not compatible when a workflow job's
> environment is set to `deployment: false`.

Source: [Creating custom deployment protection rules][creating]. The workflow
syntax page states the same incompatibility: [Workflow syntax][syntax].

Without `deployment: false`, the job waits for a review from Beepboop.
Beepboop receives `deployment_protection_rule` deliveries and drops them.

## Beepboop today

- The registered app subscribes to `deployment_protection_rule` and holds
  `deployments: write` (`GET /apps/beepboop-by-kjanat`, 2026-11-20).
- `scripts/app-manifest.ts` requests neither. A new app created from it gets
  no deployments permission and no `deployment_protection_rule` event.
- `AutomationService.webhook` in `src/automation/service.ts` accepts `push`,
  `release`, `workflow_run`, `pull_request`, `installation` and
  `installation_repositories`. It answers every other event with 204.
  `deployment_protection_rule` deliveries end there.
- Repository events pass through `inbound()` and reach the repository's
  coordinator with `receive(delivery, repositoryId, event)`.
- `src`, `packages` and `actions` contain no deployment handling.

## GitHub contract

### App setup

From [Creating custom deployment protection rules][creating]:

- Repository permission Actions: read-only.
- Repository permission Deployments: read and write.
- Event subscription: Deployment protection rule.
- The feature is in public preview and subject to change.

The [webhook reference][webhook] asks for at least read access to Deployments
to receive the event. Reviewing a rule writes, so request read and write.

### Delivery

From the [webhook reference][webhook]:

- The event means "A deployment protection rule was requested for an
  environment."
- `environment` is a string: the environment that has the rule.
- `installation` is present for app deliveries.
- `sender` can be the `ghost` user. Read the run actor from the run.
- Headers: `X-GitHub-Event`, `X-GitHub-Delivery`, `X-Hub-Signature-256`.

*Summary*: `event`, `sha` and `ref` (populated from the check suite even
when no deployment exists), `deployment_callback_url`, `deployment` (object or
null) and `pull_requests`. The action values and the `deployment` object
fields were not read.

### Review

From [Review custom deployment protection rules for a workflow run][review]:

```http
POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule
```

| Field              | Type   | Rule                            |
| ------------------ | ------ | ------------------------------- |
| `environment_name` | string | required                        |
| `state`            | string | `approved` or `rejected`        |
| `comment`          | string | required when `state` is absent |

- Success is `204 No Content`.
- An app reviews only its own custom rules.
- The [creating guide][creating] gets an installation token with
  `POST /app/installations/{installation_id}/access_tokens`, body
  `{"permissions": {"deployments": "write"}, "repository_ids": [...]}`.

A request without `state` posts a status report. GitHub accepts up to 10
reports per deployment, each up to 1024 characters of Markdown
([creating guide][creating]).

`GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals` returns each review
with `state` `approved`, `rejected` or `pending`.
`GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments` lists
environments waiting on protection rules ([REST reference][review]).

### Limits

From [Deployments and environments][environments]:

- An environment enables at most 6 custom rules at once.
- On Free, Pro and Team, custom rules work only in public repositories.
- A wait timer is an integer from 1 to 43,200 minutes.
- Administrators can bypass protection rules by default.

### Open questions

- How long GitHub waits for a review, and what a timeout does to the job. The
  pages read here do not say.
- REST endpoints that enable or disable an app rule on an environment. The
  [configuring guide][configuring] was not read.
- Payload action values and `deployment` object fields.

## Handler shape

The pieces Beepboop needs, mapped to its code:

1. Request `deployments: write` and the `deployment_protection_rule` event in
   `scripts/app-manifest.ts`.
2. Accept `deployment_protection_rule` in `AutomationService.webhook` and
   decode the delivery at that boundary.
3. Decide in the repository's coordinator, which holds the executions and
   their workflow bindings. The run id, `sha` and `environment` point to one
   execution.
4. Review through the run endpoint with an installation token scoped to
   `deployments: write`.
5. Workflows gated by the rule must drop `deployment: false`.

[creating]: https://docs.github.com/actions/managing-workflow-runs-and-deployments/managing-deployments/creating-custom-deployment-protection-rules
[configuring]: https://docs.github.com/actions/deployment/protecting-deployments/configuring-custom-deployment-protection-rules
[environments]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
[review]: https://docs.github.com/en/rest/actions/workflow-runs#review-custom-deployment-protection-rules-for-a-workflow-run
[syntax]: https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
[webhook]: https://docs.github.com/en/webhooks/webhook-events-and-payloads#deployment_protection_rule
