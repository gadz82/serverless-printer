# HTTP callback — standard PDF

- **Channel:** `http`
- **PDF:** standard PDF
- **Config:** [`config.tfvars.example`](config.tfvars.example)

## What it demonstrates

Delivers the result JSON to an allowlisted HTTPS endpoint, then sends the optional ping. The result includes a presigned `printing` URL for the transient S3 copy.

## Configure

Append the snippet to `TF_VARS` (or a manual `infra/terraform.tfvars`) and deploy/re-apply the
stack. Replace every example host, ARN and account id with your own.

## Send

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/01-http-standard/sqs-payload.json \
  --region "$AWS_REGION"
```

`JOBS_QUEUE_URL` and `AWS_REGION` come from the Terraform outputs and your deployment.

## SQS payload

[`sqs-payload.json`](sqs-payload.json) is the exact `MessageBody` sent to the jobs queue. The
`webhooks.success.channel` field selects the output channel; the `payload` object is the
Handlebars context. The command above sends this file with `aws sqs send-message`.

## Expected result

The endpoint receives a `POST` with `X-Printer-Print-Id`, a 2xx response is success, and the result contains `printing`, `printingExpiresAt`, `sha256`, `sizeBytes` and `pdfA: null`. The ping receives `{"success":true}`.

## Notes

HTTP callbacks require HTTPS, an exact/wildcard allowlist entry, DNS/SSRF validation, pinned addresses and no redirects. The 5 s timeout is measured from the worker; keep the endpoint responsive.
