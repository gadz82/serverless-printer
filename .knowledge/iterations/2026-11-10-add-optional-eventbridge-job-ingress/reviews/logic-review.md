# Logic review — optional EventBridge job ingress

- Iteration: `2026-11-10-add-optional-eventbridge-job-ingress`
- Integration target: `main` at `9c1a1d1` (merge commit; see `git log`)
- Scope: one technical prompt completing the optional SPEC §6.4 `job_rule`

## Verdict

Recommend G6 approval. The optional EventBridge ingress is implemented, defaults to disabled, and
is scoped to the project rule and jobs queue. No blocking finding remains. The only outstanding
item is live AWS verification (rule/target/policy and one real event), which is operator evidence.

## Requirement verification

| Gherkin scenario | Evidence |
| --- | --- |
| Ingress disabled by default | `job-rule.tftest.hcl` `default_is_disabled`; 0 rule/target and no EventBridge policy statement |
| Configured rule forwards to jobs queue | `configured_forwards_to_jobs_queue`: 1 rule on the named bus/pattern, 1 target with `input_path="$.detail"`; code review confirms target ARN is the jobs queue |
| Invalid input fails early | 4 negative runs: empty bus, invalid bus chars, malformed JSON, non-object JSON |
| Forwarded events use the normal job path | `input_path="$.detail"` means the event detail is the SQS job body; the worker's existing schema/DLQ/callback path is unchanged |

## Integrated evidence

| Check | Result |
| --- | --- |
| `terraform -chdir=infra fmt -check -recursive` | PASS |
| `terraform -chdir=infra validate` | PASS |
| `tflint --chdir=infra --call-module-type=all` | PASS |
| `terraform -chdir=infra/bootstrap fmt -check -recursive` / `validate` | PASS |
| `terraform -chdir=infra/modules/printer test` | PASS — 6/6 |
| `pnpm test` | PASS — 616 tests |
| typecheck / lint / Prettier | PASS |

Root `terraform plan` remains operator evidence because it requires the live S3 backend and AWS
data sources; the mocked module test is the plan evidence. The module test mocks
`aws_iam_policy_document`, so the queue-policy JSON is covered by code review and the live
verification step, not the mocked plan.

## Findings

No blocking findings. Residual risks:

- No live apply/EventBridge→SQS delivery; verify the rule, target, queue policy and one real event.
- The bus must exist in the same account/region; cross-account buses and scheduling are out of scope.
- EventBridge caps events at 256 KB; `{}` matches all events.
- Bootstrap must be re-applied for the deploy role's scoped EventBridge permissions.
