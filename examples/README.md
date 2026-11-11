# Examples

Eight copy-pasteable examples focused on the **output path**. Each folder contains:

- `README.md` — what it demonstrates, configuration and send command;
- `sqs-payload.json` — the exact SQS `MessageBody` (job contract);
- `config.tfvars.example` — the Terraform inputs to append to `TF_VARS` or a manual tfvars file.

The EventBridge ingress example also contains `event.json`; its `detail` is the same job body
forwarded to SQS.

Replace every `example.com`, `example.corp`, ARN and AWS account id with your own. Do not commit
real presigned URLs or secrets.

| #   | Example                                          | Output channel           | PDF      | Configuration focus                    |
| --- | ------------------------------------------------ | ------------------------ | -------- | -------------------------------------- |
| 1   | [HTTP standard](01-http-standard/)               | `http`                   | Standard | Callback allowlist + ping              |
| 2   | [HTTP PDF/A](02-http-pdfa/)                      | `http`                   | PDF/A-2b | Archival output over HTTP              |
| 3   | [Lambda callback](03-lambda-callback/)           | `lambda`                 | Standard | Async Lambda invocation                |
| 4   | [SQS FIFO](04-sqs-fifo/)                         | `sqs`                    | Standard | FIFO group/deduplication               |
| 5   | [EventBridge callback](05-eventbridge-callback/) | `eventBridge`            | Standard | Bus detail events                      |
| 6   | [S3 PDF/A](06-s3-pdfa/)                          | `s3`                     | PDF/A-2b | Direct presigned PUT, no print storage |
| 7   | [Private HTTP via VPC](07-private-http-vpc/)     | `http`                   | Standard | `vpc_mode` + private callback          |
| 8   | [EventBridge ingress](08-eventbridge-ingress/)   | EventBridge → jobs queue | Standard | Optional `job_rule` ingress            |

## SQS payload shape

`sqs-payload.json` is the **message body**, not an SQS event envelope. A complete standard job
looks like this:

```json
{
  "templateId": "generic-report",
  "refId": "example-http-standard-001",
  "options": { "pdfA": false },
  "webhooks": {
    "success": {
      "channel": "http",
      "value": "https://api.example.com/printer/results",
      "pingUrl": "https://api.example.com/printer/ping"
    },
    "failure": {
      "channel": "http",
      "value": "https://api.example.com/printer/errors"
    }
  },
  "payload": {
    "title": "Quarterly business report",
    "customer": { "name": "Sample Customer" },
    "items": [
      { "description": "Consulting hours", "quantity": 12, "unitPrice": 150, "amount": 1800 }
    ],
    "total": 1800,
    "generatedAt": "2026-11-01T09:30:00.000Z"
  }
}
```

Send it with the SQS API or CLI:

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/01-http-standard/sqs-payload.json \
  --region "$AWS_REGION"
```

The SQS `SendMessage` request is:

```json
{
  "QueueUrl": "https://sqs.eu-central-1.amazonaws.com/123456789012/printer-jobs",
  "MessageBody": "{...the JSON above as a string...}"
}
```

For a FIFO callback example, the callback queue is the FIFO resource; the **job** itself is sent to
the standard jobs queue. The worker adds the callback FIFO attributes when it delivers the result.
The jobs queue accepts standard SQS messages only.

Optionally attach SQS message attributes for tracing; the worker does not require them:

```sh
aws sqs send-message \
  --queue-url "$JOBS_QUEUE_URL" \
  --message-body file://examples/01-http-standard/sqs-payload.json \
  --message-attributes '{"traceparent":{"DataType":"String","StringValue":"00-..."}}' \
  --region "$AWS_REGION"
```

## Use an example

1. Pick the closest example and read its `README.md`.
2. Merge `config.tfvars.example` into the GitHub `TF_VARS` repository variable (or a manual
   `infra/terraform.tfvars`).
3. Deploy/re-apply the stack. Re-apply `infra/bootstrap` first if you enabled EventBridge ingress
   or a provided worker role.
4. Send `sqs-payload.json` with `aws sqs send-message` (the README shows the exact command).
5. Confirm the callback/ping and the result fields.

For a presigned S3 PUT URL, generate it with your SDK, use HTTPS and keep the expiry short. The
worker does not create it. The S3 channel is success-only; use HTTP/Lambda/SQS/EventBridge for the
failure webhook.

## Validation

`tests/examples/examples.test.ts` validates every `sqs-payload.json` and the EventBridge ingress
`detail` against `@printer/contracts`, requires the expected files per folder and enforces the 6–8
example cap. Run:

```sh
pnpm exec vitest run tests/examples
```

See [Usage](../docs/usage.md) for the full job/result contract, [Deployment](../docs/deployment.md)
for the Terraform options, and the root [README](../README.md) for the product overview.
