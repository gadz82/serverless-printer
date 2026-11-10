# Regression plan

- Terraform fmt/validate/tflint for root and bootstrap.
- Default-configuration check: `job_rule = null` yields no EventBridge resources and no policy
  statement.
- Configured check: a test `bus_name`/`event_pattern` yields the rule, target and policy
  statement with the correct SourceArn condition.
- Negative check: empty bus name and malformed event-pattern JSON fail variable validation.
- Repository unit/typecheck/lint/Prettier and render regression remain green (no runtime change).
- No live AWS apply; the first operator deployment confirms the rule and queue policy.
