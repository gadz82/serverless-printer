# Lambda callback — standard PDF

- **Channel:** `lambda`
- **PDF:** standard PDF
- **Config:** [`config.tfvars.example`](config.tfvars.example)

## What it demonstrates

Invokes a result Lambda asynchronously with the result JSON as the invocation body. The worker only gets `lambda:InvokeFunction` on the ARNs in `callback_target_arns`.

## Configure

Append the snippet to `TF_VARS` (or a manual `infra/terraform.tfvars`) and deploy/re-apply the
stack. Replace every example host, ARN and account id with your own.

## Send

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/03-lambda-callback/sqs-payload.json \
  --region "$AWS_REGION"
```

`JOBS_QUEUE_URL` and `AWS_REGION` come from the Terraform outputs and your deployment.

## SQS payload

[`sqs-payload.json`](sqs-payload.json) is the exact `MessageBody` sent to the jobs queue. The
`webhooks.success.channel` field selects the output channel; the `payload` object is the
Handlebars context. The command above sends this file with `aws sqs send-message`.

## Expected result

The success Lambda receives the success result; the failure Lambda receives a failure result if rendering/delivery fails. The result format is identical to the other channels (including `printing` for a stored print).

## Notes

Use `InvocationType=Event` semantics: the callback Lambda is responsible for parsing and acting on the result. Add both success and failure function ARNs to `callback_target_arns`; otherwise the worker policy denies the send.
