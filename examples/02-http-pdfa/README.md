# HTTP callback — PDF/A-2b

- **Channel:** `http`
- **PDF:** PDF/A-2b
- **Config:** [`config.tfvars.example`](config.tfvars.example)

## What it demonstrates

Renders a standard Chromium PDF, post-processes it to PDF/A-2b with pdf-lib and delivers the archival PDF result over HTTP.

## Configure

Append the snippet to `TF_VARS` (or a manual `infra/terraform.tfvars`) and deploy/re-apply the
stack. Replace every example host, ARN and account id with your own.

## Send

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/02-http-pdfa/sqs-payload.json \
  --region "$AWS_REGION"
```

`JOBS_QUEUE_URL` and `AWS_REGION` come from the Terraform outputs and your deployment.

## SQS payload

[`sqs-payload.json`](sqs-payload.json) is the exact `MessageBody` sent to the jobs queue. The
`webhooks.success.channel` field selects the output channel; the `payload` object is the
Handlebars context. The command above sends this file with `aws sqs send-message`.

## Expected result

The result has `pdfA: "PDF/A-2b"`, a presigned `printing` URL and the usual hash/size/template fields. The PDF/A file embeds the sRGB ICC output intent and XMP `pdfaid` part/conformance metadata.

## Notes

PDF/A is best effort, not validator-grade. Part-1 and accessibility levels depend on semantic template HTML; no validator runs in CI or production. The level must be in `pdfa_allowed_levels`.
