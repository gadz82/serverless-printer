# Infrastructure impact

- Adds one optional `aws_cloudwatch_event_rule` and one `aws_cloudwatch_event_target` when
  `job_rule` is set.
- Adds one dynamic statement to the existing jobs queue policy for the EventBridge service
  principal, scoped by `aws:SourceArn`.
- Default `null` creates no new resources or policy statements.
- The event bus must exist in the same account/region; cross-account buses and scheduling are
  out of scope.
- The bootstrap deploy role gains scoped EventBridge rule/target/tag permissions for the
  `<name_prefix>-jobs` rule on the default and custom-bus ARN patterns. Re-apply bootstrap before
  enabling `job_rule`; never widen the main/worker role for this.
