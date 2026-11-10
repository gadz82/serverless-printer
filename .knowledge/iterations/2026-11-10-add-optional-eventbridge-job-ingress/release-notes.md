# Release notes — optional EventBridge job ingress

## Shipped

- Optional `job_rule = { bus_name, event_pattern }` Terraform input at root and printer-module
  level, default `null`.
- EventBridge rule (`<name_prefix>-jobs`) and target to the jobs queue when configured; the
  target forwards `$.detail` as the SQS job body.
- SourceArn-scoped jobs queue policy for `events.amazonaws.com`.
- Scoped bootstrap deploy-role permissions for the EventBridge rule/target/tags.
- Bus/event-pattern validation; docs, tfvars example and cloud verification steps.
- Six mocked-provider Terraform tests for default, configured and invalid input.

## Verification

- Terraform root/bootstrap fmt/validate/tflint pass.
- Module tests 6/6.
- Full repo suite 616 tests; typecheck, lint and Prettier pass.
- No live AWS apply/EventBridge delivery test; verify during cloud verification.

## Known limitations

- The event bus must exist in the same account/region; cross-account buses and scheduling are out
  of scope.
- EventBridge caps events at 256 KB; `{}` matches all events.
- The mocked test does not evaluate the rendered queue-policy JSON; code review and live
  verification cover the statement.
- Re-apply bootstrap before enabling `job_rule`.
