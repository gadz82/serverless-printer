# S3 PDF/A upload — archival PDF

- **Channel:** `s3`
- **PDF:** PDF/A-2b
- **Config:** [`config.tfvars.example`](config.tfvars.example)

## What it demonstrates

Uploads the PDF bytes directly to a caller-generated presigned S3 PUT URL. The worker skips the prints bucket, so the success result has no `printing`/`printingExpiresAt`; the ping is the only notification.

## Configure

Append the snippet to `TF_VARS` (or a manual `infra/terraform.tfvars`) and deploy/re-apply the
stack. Replace every example host, ARN and account id with your own.

## Send

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/06-s3-pdfa/sqs-payload.json \
  --region "$AWS_REGION"
```

`JOBS_QUEUE_URL` and `AWS_REGION` come from the Terraform outputs and your deployment.

## SQS payload

[`sqs-payload.json`](sqs-payload.json) is the exact `MessageBody` sent to the jobs queue. The
`webhooks.success.channel` field selects the output channel; the `payload` object is the
Handlebars context. The command above sends this file with `aws sqs send-message`.

## Expected result

The object appears at the presigned URL with `Content-Type: application/pdf`; the result has `pdfA: "PDF/A-2b"`, `sha256` and `sizeBytes` but no `printing` field. The ping receives `{"success":true}`.

## Notes

The presigned URL must be HTTPS, must not redirect, and must not target loopback/link-local/metadata addresses. The `s3` channel is success-only; use `http`, `lambda`, `sqs` or `eventBridge` for the failure webhook. Generate the presigned PUT URL with your SDK and keep its expiry short.
