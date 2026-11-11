# SQS FIFO callback — standard PDF

- **Channel:** `sqs`
- **PDF:** standard PDF
- **Config:** [`config.tfvars.example`](config.tfvars.example)

## What it demonstrates

Sends the result JSON to an SQS FIFO queue. The worker applies the documented `MessageGroupId`/`MessageDeduplicationId` rules so callers can preserve ordering and deduplicate.

## Configure

Append the snippet to `TF_VARS` (or a manual `infra/terraform.tfvars`) and deploy/re-apply the
stack. Replace every example host, ARN and account id with your own.

## Send

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/04-sqs-fifo/sqs-payload.json \
  --region "$AWS_REGION"
```

`JOBS_QUEUE_URL` and `AWS_REGION` come from the Terraform outputs and your deployment.

## SQS payload

[`sqs-payload.json`](sqs-payload.json) is the exact `MessageBody` sent to the jobs queue. The
`webhooks.success.channel` field selects the output channel; the `payload` object is the
Handlebars context. The command above sends this file with `aws sqs send-message`.

## Expected result

The results queue receives one message with the result body. For a FIFO queue, `MessageGroupId` is `refId` (hashed when not a string or longer than 128 chars) and `MessageDeduplicationId` is `SHA-256(refId + inbound messageId)`.

## Notes

The queue name must end in `.fifo` and both success/failure queues should be in `callback_target_arns`. Standard SQS queues work too; the FIFO identifiers are only applied for `.fifo` names.
