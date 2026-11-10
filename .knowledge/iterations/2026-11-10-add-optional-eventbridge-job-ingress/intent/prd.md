# PRD — Optional EventBridge job ingress

## Problem

SPEC §6.4 defines an optional EventBridge rule input, `job_rule = { bus_name, event_pattern }`,
that forwards matching events to the jobs queue and is named in the queue policy. The current
Terraform module has no `job_rule` input, rule, target or queue-policy statement, so callers
cannot use EventBridge as the documented optional ingress.

This is a purely technical Terraform completion of an existing SPEC item. It does not change the
job contract, rendering, callbacks or the worker.

## Scope

- Add `job_rule` to the root and printer-module variables, default `null`.
- When set, create an EventBridge rule on the named bus, a target to the jobs queue, and a queue
  policy statement allowing `events.amazonaws.com` to send only from that rule.
- Keep the default deployment byte-for-byte behaviour: `job_rule = null` creates no EventBridge
  resources and no queue-policy statement.
- Document the input and provide a commented tfvars example.
- Validate the object shape and event pattern; keep the existing queue policy senders untouched.

## Out of scope

- Scheduling, EventBridge Scheduler, cross-account buses, dead-letter targets for the rule.
- Changes to the job/result schemas, worker, callbacks, smoke or load tests.
- A live AWS apply; the change is validated statically and with Terraform plans where feasible.

## Acceptance

- `terraform -chdir=infra fmt -check -recursive`
- `terraform -chdir=infra init -backend=false -input=false`
- `terraform -chdir=infra validate`
- `terraform -chdir=infra/bootstrap fmt -check -recursive` (unchanged)
- `tflint --config=./tflint.hcl --chdir=infra --call-module-type=all`
- A plan with `job_rule = null` shows no EventBridge resources.
- A plan/validation with a configured `job_rule` includes the rule, target and queue-policy
  statement.
- Existing tests, typecheck, lint and Prettier stay green.

## Decisions

- Development stays on `main`; the user explicitly chose no feature branch for this small
  follow-up. The iteration still uses its own prompt branch/worktree for the change.
- The rule targets the existing jobs queue in the same account/region; cross-account buses are
  out of scope.
- No new output is required; operators can inspect the rule by name.
