# TRD — Optional EventBridge job ingress

## Contract

Add to `infra/variables.tf` and `infra/modules/printer/variables.tf`:

```hcl
variable "job_rule" {
  description = "Optional EventBridge rule that forwards matching events to the jobs queue."
  type = object({
    bus_name      = string
    event_pattern = string
  })
  default = null
}
```

Validation:
- `bus_name` is non-empty and matches `^[A-Za-z0-9._-]{1,256}$` (default bus is `"default"`).
- `event_pattern` is valid JSON and non-empty; use `can(jsondecode(var.job_rule.event_pattern))`
  guarded for null.
- `job_rule` stays `null` by default.

## Resources

In `infra/modules/printer/main.tf` (or a small `eventbridge.tf`):

```hcl
resource "aws_cloudwatch_event_rule" "jobs" {
  count          = var.job_rule == null ? 0 : 1
  name           = "${var.name_prefix}-jobs"
  event_bus_name = var.job_rule.bus_name
  event_pattern  = var.job_rule.event_pattern
}

resource "aws_cloudwatch_event_target" "jobs" {
  count          = var.job_rule == null ? 0 : 1
  rule           = aws_cloudwatch_event_rule.jobs[0].name
  event_bus_name = var.job_rule.bus_name
  arn            = aws_sqs_queue.jobs.arn
  target_id      = "printer-jobs"
}
```

Queue policy: add a dynamic statement to the existing `aws_iam_policy_document.jobs_queue` when
the rule exists:

```hcl
dynamic "statement" {
  for_each = var.job_rule == null ? [] : [aws_cloudwatch_event_rule.jobs[0].arn]
  content {
    sid       = "AllowEventBridgeJobRule"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.jobs.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [statement.value]
    }
  }
}
```

`aws_sqs_queue_policy.jobs` already depends on the caller role; add the rule to its `depends_on` so
the rule ARN exists before the policy is stored. The target can depend on the queue policy so the
first EventBridge delivery cannot race the policy.

Root `infra/main.tf` passes `job_rule = var.job_rule`.

## Documentation

- `infra/terraform.tfvars.example`: commented example with a default bus and a JSON event pattern.
- `infra/README.md`: input row and a short example, plus the note that EventBridge events are
  delivered as ordinary job messages (same contract, DLQ, callbacks and security).
- No new output; the rule name is deterministic (`<name_prefix>-jobs`).

## Verification

- `terraform fmt -check -recursive`, `init -backend=false`, `validate` and `tflint` for
  `infra/` and `infra/bootstrap/`.
- `terraform plan` with `job_rule = null` must not add EventBridge resources; a plan with a test
  `job_rule` must add the rule/target and the queue-policy statement. If the environment cannot
  reach AWS data sources, record static validation plus a `terraform console` expression check as
  evidence and note the plan limitation.
- Full repository tests/typecheck/lint/Prettier and `pnpm test:render` (unchanged) stay green.
- Add an `ORCHID-MEM` anchor/docblock if the Terraform change introduces a significant unit; a
  docblock is optional for a pure input/resource addition, but the memory lint must stay clean.

## Risks

- An EventBridge rule can deliver non-job payloads; the worker's contract validation and failure
  webhook path already handle invalid messages, and the rule only forwards matching events.
- The rule and queue are same-account/region; cross-account buses require an explicit target
  policy and are out of scope.
- No live apply; the first operator deployment must confirm the rule and queue policy.
