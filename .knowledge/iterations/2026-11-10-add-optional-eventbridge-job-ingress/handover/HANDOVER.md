# Handover — optional EventBridge job ingress

- Iteration: `2026-11-10-add-optional-eventbridge-job-ingress`
- Status: closed; G8 handover
- Scope: SPEC §6.4 optional `job_rule` only

## What changed and why

The printer now supports the documented optional EventBridge ingress. When `job_rule` is set,
Terraform creates an EventBridge rule and a target to the existing jobs queue; matching events
forward their `detail` as the normal print-job body. The default remains no EventBridge resources.

## Architecture delta

- `infra/variables.tf`, `infra/modules/printer/variables.tf` — nullable `job_rule` object with
  bus-name and JSON-object event-pattern validation.
- `infra/modules/printer/main.tf` — rule/target resources, `input_path="$.detail"`, and a
  SourceArn-scoped queue-policy statement.
- `infra/bootstrap/iam.tf` — scoped EventBridge rule/target/tag permissions for the deploy role.
- `infra/terraform.tfvars.example`, `infra/README.md`, `docs/cloud-verification.md` — usage and
  verification.
- `infra/modules/printer/job-rule.tftest.hcl` — six mocked-provider tests.

## Reading order

1. `infra/variables.tf` — root `job_rule` input and validation.
2. `infra/modules/printer/variables.tf` — module contract.
3. `infra/modules/printer/main.tf` — rule, target, `input_path` and queue-policy statement.
4. `infra/bootstrap/iam.tf` — deploy-role EventBridge permissions.
5. `infra/modules/printer/job-rule.tftest.hcl` — default/configured/invalid tests.
6. `docs/cloud-verification.md#eventbridge-ingress-optional` — live verification.

## How to run and test

```bash
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
tflint --config="$PWD/tflint.hcl" --chdir=infra --call-module-type=all
terraform -chdir=infra/modules/printer init -backend=false -input=false
terraform -chdir=infra/modules/printer test
pnpm test && pnpm typecheck && pnpm lint && pnpm exec prettier --check .
```

## How to deploy and verify

1. Re-apply `infra/bootstrap` for the deploy-role EventBridge permissions.
2. Set `job_rule` in `TF_VARS` (or a manual tfvars) with an existing bus and a specific JSON
   pattern; event `detail` must be a contract-valid job.
3. Deploy through `release.yml` (or a manual apply).
4. Verify the rule, target `InputPath=$.detail`, SourceArn queue-policy statement and one real
   event per `docs/cloud-verification.md`.

## How to roll back

Set `job_rule = null` and re-apply; Terraform removes the rule, target and queue-policy statement.
No worker or data change is involved.

## Risks and follow-ups

- No live AWS apply or EventBridge delivery test yet; operator verification remains.
- The bus must exist in the same account/region; cross-account buses and scheduling are out of scope.
- EventBridge events are capped at 256 KB; `{}` matches all events.
- The mocked test does not evaluate the rendered policy JSON; code review plus live verification
  cover it.
