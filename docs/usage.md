# Usage and job contract

Callers publish one JSON job to the SQS jobs queue. One message produces exactly one PDF. The
worker validates the job, renders the template and delivers the result through the requested
channel.

## Job message

```jsonc
{
  "templateId": "generic-report", // template UUID or slug
  "refId": "invoice-2026-001", // string, number or object; echoed unchanged
  "options": {
    "pdfA": "PDF/A-2b", // optional; false/omitted = standard PDF
  },
  "webhooks": {
    "success": {
      "channel": "http", // http | lambda | sqs | eventBridge | s3
      "value": "https://api.example.com/printer/results",
      "pingUrl": "https://api.example.com/printer/ping", // optional
    },
    "failure": {
      // optional
      "channel": "sqs", // http | lambda | sqs | eventBridge (not s3)
      "value": "arn:aws:sqs:eu-central-1:123456789012:printer-failures",
    },
  },
  "payload": {
    // Handlebars context
    "title": "Invoice 2026-001",
  },
}
```

Constraints:

- One message is one print. SQS allows at most 1 MiB; EventBridge ingress allows 256 KB.
- `options` is optional; without it the job produces a standard PDF.
- `options.pdfA` must be enabled in `pdfa_allowed_levels` (all eight levels by default).
- `payload` values are escaped by Handlebars; templates cannot register custom helpers.
- `refId` is echoed unchanged. SQS FIFO deliveries use it for the message group and deduplication
  rules.

## PDF output types

| `options.pdfA`           | Output                         | Notes                                                         |
| ------------------------ | ------------------------------ | ------------------------------------------------------------- |
| omitted / `false`        | Standard PDF                   | Chromium print output, A4, tagged, header/footer page numbers |
| `PDF/A-1b`               | Archival PDF 1.4               | Basic visual fidelity; part 1 forbids transparency            |
| `PDF/A-1a`               | PDF/A-1b + accessibility       | Requires tagged/semantic output and embedded fonts            |
| `PDF/A-2b`               | Archival PDF 1.7               | Most reliable level for Chromium; the release smoke level     |
| `PDF/A-2u`               | PDF/A-2b + Unicode mapping     | Useful for searchable text                                    |
| `PDF/A-2a`               | PDF/A-2u + accessibility       | Depends on semantic HTML, `lang` and `alt`                    |
| `PDF/A-3b` / `3u` / `3a` | PDF/A-2 profiles + attachments | For archives that may carry embedded files                    |

PDF/A is applied after Chromium rendering. The archiver embeds an sRGB ICC output intent, writes
UTF-8 XMP `pdfaid:part`/`conformance`, keeps Info/CreatorTool consistent, sets the document ID and
rejects encryption, JavaScript and unembedded fonts. It is **best effort**, not validator-grade
conformance; part-1 and accessibility levels depend most on the template.

Rendering settings: A4, `printBackground`, `preferCSSPageSize`, `tagged: true`, page-number
headers/footers, JavaScript disabled and all non-bundled requests blocked.

## Output destinations

The job chooses one success channel and an optional failure channel.

| Channel       | `value`                           | Delivery                                                                           | Result specifics                                                                         |
| ------------- | --------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `http`        | HTTPS URL on `callback_allowlist` | `POST` JSON with `X-Printer-Print-Id`, 5 s timeout, any 2xx                        | Allowlist + DNS/SSRF checks; address pinned; no redirects                                |
| `lambda`      | Lambda function ARN               | `Invoke` with `InvocationType=Event`; body is the result                           | ARN in `callback_target_arns`                                                            |
| `sqs`         | Queue ARN                         | `SendMessage` with the result body                                                 | FIFO: `MessageGroupId`/`MessageDeduplicationId` rules                                    |
| `eventBridge` | Event bus ARN                     | `PutEvents`; source `EVENT_SOURCE`, detail type `printer.print.succeeded`/`failed` | Bus ARN in `callback_target_arns`                                                        |
| `s3`          | HTTPS presigned PUT URL           | `PUT` PDF bytes with `Content-Type: application/pdf`                               | Success only; result omits `printing`/`printingExpiresAt`; ping is the only notification |

After delivery, the worker POSTs `{"success": true|false}` to the matching `pingUrl` when present.

## Success result

```json
{
  "success": true,
  "printId": "3f0c…",
  "refId": "invoice-2026-001",
  "printing": "https://…presigned GET…",
  "printingExpiresAt": "2026-11-09T10:15:00Z",
  "sha256": "…",
  "sizeBytes": 48211,
  "pdfA": "PDF/A-2b",
  "template": {
    "id": "6f1c…",
    "slug": "generic-report",
    "contentHash": "…",
    "release": "v1.4.0"
  },
  "renderedAt": "2026-11-09T10:00:00Z"
}
```

- `pdfA` is `null` for a standard PDF.
- For the `s3` channel, `printing` and `printingExpiresAt` are omitted because the PDF went directly
  to the caller's URL.
- `printing` is a presigned GET URL; its lifetime is `presign_ttl_seconds` (default 900 s).
- Standard prints expire from S3 after one day.

## Failure result

```json
{
  "success": false,
  "printId": "3f0c…",
  "refId": "invoice-2026-001",
  "template": {
    "id": "6f1c…",
    "slug": "generic-report",
    "contentHash": "…",
    "release": "v1.4.0"
  },
  "error": {
    "code": "PDF_RENDER_FAILED",
    "message": "…",
    "retryable": true,
    "attempts": 5
  },
  "failedAt": "2026-11-09T10:00:05Z"
}
```

`template` is `null` when the template could not be resolved.

| Code                     | Retryable | Meaning                                                          |
| ------------------------ | --------- | ---------------------------------------------------------------- |
| `INVALID_MESSAGE`        | no        | Job does not match the schema                                    |
| `PDFA_LEVEL_NOT_ALLOWED` | no        | Requested PDF/A level is not enabled                             |
| `TEMPLATE_NOT_FOUND`     | no        | No matching template in the deployed bundle                      |
| `CALLBACK_NOT_ALLOWED`   | no        | HTTP/ping target fails the allowlist or SSRF policy              |
| `TEMPLATE_RENDER_FAILED` | no        | Handlebars error or missing fields in strict/assume-objects mode |
| `PDFA_CONVERSION_FAILED` | no        | PDF/A post-processing failed                                     |
| `PDF_RENDER_FAILED`      | yes       | Chromium/render engine failure                                   |
| `DELIVERY_FAILED`        | yes       | Success channel failed                                           |

## Retries and deduplication

- SQS redelivers retryable errors up to `max_receive_count` (default 5).
- On the last attempt the worker delivers the failure result. If the failure delivery also fails,
  the message goes to the DLQ.
- Non-retryable errors deliver the failure result immediately.
- `printId` is `UUIDv5(namespace, inbound SQS messageId)`, so a retry overwrites the same print
  object. Callers must deduplicate on `printId` because SQS is at-least-once.
- Batches of 1–5 records render sequentially on the same browser; `ReportBatchItemFailures` lets
  only failed records be retried.

## Callback security

`callback_allowlist` is a JSON array of `scheme://host[:port]` entries. Exact hosts and `*.`
subdomain wildcards are supported. The policy resolves DNS and rejects loopback, link-local,
metadata and non-routable answers; named private VPC hosts remain usable. The validated address is
pinned for the request and redirects are refused. AWS callback targets are scoped by
`callback_target_arns`.

## EventBridge ingress

When `job_rule` is set, matching events on the named bus are forwarded to the jobs queue with
`input_path = "$.detail"`. The event `detail` must be a complete job body; EventBridge events are
limited to 256 KB, and `{}` matches every event. See
[Deployment](deployment.md#optional-eventbridge-ingress) for the Terraform input.

## Examples

The README includes complete [sample configurations](../README.md#sample-configurations) for an
HTTP invoice, an S3 PDF/A archive and EventBridge ingress.
