# P-001 implementation report

- Prompt: P-001 — Add the optional EventBridge job-ingress rule
- Status: complete

## Delivered

- Nullable `job_rule = { bus_name, event_pattern }` at root and printer-module level, default
  `null`; bus name and JSON-object event-pattern validation (non-empty, regex, max 2048 chars).
- `aws_cloudwatch_event_rule.jobs` and `aws_cloudwatch_event_target.jobs` when configured; the
  target forwards **`$.detail`** to the existing jobs queue and depends on the queue policy.
- Dynamic jobs queue-policy statement `AllowEventBridgeJobRule`: `events.amazonaws.com`,
  `sqs:SendMessage`, queue resource only, `ArnEquals aws:SourceArn` = the created rule ARN.
- Bootstrap deploy-role EventBridge permissions for the `<name_prefix>-jobs` rule on default and
  custom-bus ARN patterns; bootstrap README re-apply note.
- tfvars example, infra README (detail/256 KB/bus/`{}`/no-live-apply caveats) and cloud
  verification EventBridge ingress checks.
- `infra/modules/printer/job-rule.tftest.hcl`: 6 mocked-provider runs covering default-disabled,
  configured rule/target/bus/pattern/input_path, empty/invalid bus, malformed and non-object
  pattern.

## Resource / policy matrix

| `job_rule` | Rule | Target | Queue-policy statement |
| --- | --- | --- | --- |
| `null` | 0 | 0 | none |
| configured | 1, `<name_prefix>-jobs` on the named bus | 1, `printer-jobs`, `input_path="$.detail"`, target = jobs queue | 1, `AllowEventBridgeJobRule`, service `events.amazonaws.com`, `sqs:SendMessage`, SourceArn = rule ARN |

## Acceptance

| Command | Result |
| --- | --- |
| `terraform -chdir=infra fmt -check -recursive` | PASS |
| `terraform -chdir=infra init -backend=false` / `validate` | PASS |
| `tflint --chdir=infra --call-module-type=all` | PASS |
| `terraform -chdir=infra/bootstrap fmt -check -recursive` / `validate` | PASS |
| `terraform -chdir=infra/modules/printer init -backend=false` + `test` | PASS — 6/6 |
| `pnpm test` | PASS — 616 tests |
| `pnpm typecheck` / `lint` / Prettier | PASS |

Root `terraform plan` was not run because it needs the live S3 backend/AWS data sources; the
mocked module test is the plan evidence. The live apply remains operator verification.

## Review

Independent review found two blockers, both fixed:

1. The target forwarded the EventBridge envelope; added `input_path = "$.detail"` and documented
   that the event detail must be the print-job body.
2. The release deploy role lacked EventBridge permissions; added scoped bootstrap
   rule/target/tag permissions and the re-apply note.

A follow-up review confirmed the implementation passes. The only remaining process item was this
report, now written.

## Residual risks

- No live AWS apply or EventBridge→SQS delivery test; verify rule, target, policy and one real
  event during cloud verification.
- The bus must exist in the same account/region; cross-account buses/scheduling are out of scope.
- EventBridge events are capped at 256 KB (below the 1 MiB SQS limit); `{}` matches all events.
- The module test mocks `aws_iam_policy_document`, so it does not assert the rendered policy JSON;
  code review and cloud verification cover the statement.
- The bootstrap deploy role must be re-applied before the release workflow can manage the rule.
