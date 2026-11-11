# EventBridge ingress — standard PDF

- **Input:** EventBridge rule → jobs queue
- **Output:** `sqs`
- **PDF:** standard PDF
- **Config:** [`config.tfvars.example`](config.tfvars.example)
- **SQS payload:** [`sqs-payload.json`](sqs-payload.json)
- **Event:** [`event.json`](event.json)

## What it demonstrates

An existing EventBridge producer can submit print jobs without calling SQS directly. Terraform
creates `<name_prefix>-jobs` on the named bus and targets the jobs queue with
`input_path = "$.detail"`; the event detail is the normal job body.

## Configure

Append the snippet to `TF_VARS` (or a manual `terraform.tfvars`), re-apply `infra/bootstrap` for
the deploy-role EventBridge permissions, then deploy/re-apply the main stack. Replace the bus,
source, detail type and queue ARNs.

## Send

```sh
jq '[{Source:.source, DetailType:."detail-type", Detail:(.detail|tojson), EventBusName:"default"}]' \
  examples/08-eventbridge-ingress/event.json > /tmp/printer-put-events.json
aws events put-events --entries file:///tmp/printer-put-events.json --region "$AWS_REGION"
```

The job detail is the same contract as a direct SQS message. The example uses an SQS result
callback; change the webhooks to use another channel if needed.

## SQS payload

The rule forwards the event's `detail` as the SQS body. [`sqs-payload.json`](sqs-payload.json) is
the same job body for direct sending or inspection; EventBridge sends it via the rule target
(`input_path = "$.detail"`).

## Expected result

The EventBridge rule forwards the `detail` body to the jobs queue, the worker renders the PDF and
sends the result to the configured SQS queue. The event `detail` must include `templateId`,
`refId`, `webhooks` and `payload`.

## Notes

- EventBridge events are capped at 256 KB, below the SQS job limit of 1 MiB.
- `{}` matches every event; use a specific pattern in production.
- The rule/target and `events.amazonaws.com` queue-policy statement are created only when
  `job_rule` is set. The default `null` leaves ingress disabled.
- The bus must exist in the same account/region; cross-account buses and scheduling are out of
  scope. See [`docs/deployment.md`](../../docs/deployment.md#optional-eventbridge-ingress).
