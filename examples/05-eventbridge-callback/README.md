# EventBridge callback — standard PDF

- **Channel:** `eventBridge`
- **PDF:** standard PDF
- **Config:** [`config.tfvars.example`](config.tfvars.example)

## What it demonstrates

Publishes the result to an EventBridge bus with Source `EVENT_SOURCE` (default `printer`) and DetailType `printer.print.succeeded` or `printer.print.failed`. The detail is the result JSON.

## Configure

Append the snippet to `TF_VARS` (or a manual `infra/terraform.tfvars`) and deploy/re-apply the
stack. Replace every example host, ARN and account id with your own.

## Send

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/05-eventbridge-callback/sqs-payload.json \
  --region "$AWS_REGION"
```

`JOBS_QUEUE_URL` and `AWS_REGION` come from the Terraform outputs and your deployment.

## SQS payload

[`sqs-payload.json`](sqs-payload.json) is the exact `MessageBody` sent to the jobs queue. The
`webhooks.success.channel` field selects the output channel; the `payload` object is the
Handlebars context. The command above sends this file with `aws sqs send-message`.

## Expected result

Consumers on the bus receive an event whose `detail` is the print result. Use an EventBridge rule to route success/failure to downstream targets.

## Notes

The worker needs `events:PutEvents` on the bus ARN and the bus must be in `callback_target_arns`. If `organization_id` is set, sends also carry the `aws:ResourceOrgID` condition.
