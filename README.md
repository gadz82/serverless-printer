# Printer

**Serverless, template-driven PDF generation with real Chromium.** Send a job to SQS, get a
pixel-perfect PDF back through the callback channel you choose. No servers to manage, no PDF
toolchain to operate, no documents retained.

Printer is a single AWS deployment: templates live in Git, jobs enter through SQS, a Lambda worker
renders with headless Chromium, optionally converts to PDF/A, and delivers the result. It is built
for teams that need reliable, repeatable PDF output at any volume without owning rendering
infrastructure.

## Why Printer

- **Pixel-perfect Chromium rendering.** Printer runs the same Blink engine as Chrome. Your
  HTML/CSS, fonts, page breaks, headers and footers render the way a browser renders them, not
  through a limited PDF library or a fragile office converter.
- **Serverless and scalable by default.** SQS buffers traffic, Lambda scales the worker out and
  back to zero, and each instance reuses one Chromium browser for multiple jobs. A traffic spike
  becomes queue depth, not a failed request.
- **One deployment, no environments.** A single Terraform stack, a single jobs queue and a single
  release workflow. No API gateway, no database, no UI, no environment matrix.
- **Templates are code.** Handlebars templates, styles and sample data live in the repository,
  are validated in CI and are shipped in an immutable, content-hashed manifest with every release.
- **Privacy by design.** The service never keeps prints. Standard results are stored in S3 only
  long enough for the caller to download them; S3-channel deliveries go straight to the caller's
  presigned URL.
- **Production guardrails included.** Callback allowlists and SSRF protection, JavaScript-disabled
  rendering, blocked external requests, least-privilege caller/worker roles, OIDC deploys, optional
  alarms and a rollback runbook.

## What you can generate

Every job produces exactly one PDF from an HTML/Handlebars template:

| Output                 | What it is                                                                                   | When to use it                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Standard PDF**       | Chromium's print-quality PDF, A4, tagged, with CSS page size and page-number headers/footers | Invoices, statements, reports, tickets, letters, operational documents                 |
| **PDF/A-1b / 1a**      | Archival PDF 1.4; `a` adds the accessibility/tagged profile                                  | Long-term archives with strict visual fidelity; part 1 forbids transparency            |
| **PDF/A-2b / 2u / 2a** | Archival PDF 1.7 with transparency allowed; `u` adds Unicode mapping, `a` accessibility      | The most reliable archival levels for Chromium output; `2b` is the release-smoke level |
| **PDF/A-3b / 3u / 3a** | PDF/A-2 profiles plus attachment support                                                     | Archives that may carry embedded files                                                 |

PDF/A is post-processed with pdf-lib using an sRGB ICC output intent, UTF-8 XMP
`pdfaid:part`/`conformance`, consistent Info metadata and safety checks for encryption, JavaScript
and unembedded fonts. Conformance is best effort: Printer does not claim validator-grade PDF/A
compliance, and the part-1/accessibility levels depend on the template's semantic HTML.

The worker uses JavaScript-disabled rendering, blocks external network requests, applies A4,
`printBackground`, `preferCSSPageSize`, tagged output and page-number headers/footers.

## How it works

```text
 caller
   │  SendMessage(job: templateId + refId + payload + webhooks)
   ▼
┌──────────────┐     ┌──────────────────────────────┐     ┌────────────────────────┐
│  jobs queue  │────▶│  render worker (Lambda)      │────▶│  optional PDF/A        │
│  + DLQ       │     │  Chromium + Handlebars       │     │  pdf-lib + ICC + XMP   │
└──────────────┘     └──────────────┬───────────────┘     └───────────┬────────────┘
                                    │                                 │
                                    ▼                                 ▼
                     ┌──────────────────────────────┐     ┌────────────────────────┐
                     │  prints bucket (S3)          │     │  callback channel      │
                     │  presigned GET, 1-day expiry │     │  http/lambda/sqs/      │
                     └──────────────────────────────┘     │  eventBridge/s3        │
                                                          └───────────┬────────────┘
                                                                      ▼
                                                                    ping
```

1. **Validate** the job against the JSON Schema and the PDF/A allowlist.
2. **Check callbacks** against the allowlist and DNS/SSRF policy.
3. **Resolve** the template by id or slug from the bundled manifest.
4. **Render** Handlebars with the payload and print the HTML with Chromium.
5. **Archive** to the requested PDF/A level, if any.
6. **Store** the PDF in S3 with a presigned GET, or upload it directly for the `s3` channel.
7. **Deliver** the result and send the optional ping.

Retries use SQS redelivery and a dead-letter queue. The `printId` is a UUIDv5 derived from the
inbound SQS message id, so a retry overwrites the same object and callers can deduplicate.

## Where results go

The job chooses one success channel and an optional failure channel:

| Channel       | Delivery                                                                                  | Notes                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `http`        | `POST` the JSON result with `X-Printer-Print-Id`, 5 s timeout, any 2xx is success         | Allowlisted HTTPS URL, DNS/SSRF checked and address-pinned; no redirects                     |
| `lambda`      | `Invoke` with `InvocationType=Event`; the body is the result                              | Function ARN must be in `callback_target_arns`                                               |
| `sqs`         | `SendMessage` with the result body                                                        | FIFO queues get `MessageGroupId`/`MessageDeduplicationId` rules                              |
| `eventBridge` | `PutEvents` with source `EVENT_SOURCE` and detail type `printer.print.succeeded`/`failed` | Bus ARN must be in `callback_target_arns`                                                    |
| `s3`          | `PUT` the PDF bytes to a presigned URL with `Content-Type: application/pdf`               | Success only; the result omits `printing`/`printingExpiresAt`; ping is the only notification |

Ping is sent after delivery when `pingUrl` is present: `{"success": true|false}`.

## Infrastructure at a glance

```text
                    ┌──────────────────────────────────────────────────────────┐
                    │  single AWS account / region / Terraform state           │
                    │                                                          │
  caller ──────────▶│  SQS jobs queue ──▶ Lambda render worker (Chromium)      │
                    │       │                    │                            │
                    │       ▼                    ├──▶ S3 prints bucket (KMS)   │
                    │  SQS DLQ                   ├──▶ S3 artifacts bucket      │
                    │                            └──▶ callback targets          │
                    │  CloudWatch logs + optional alarms ──▶ SNS                │
                    │  generated or provided caller/worker IAM roles            │
                    └──────────────────────────────────────────────────────────┘
```

- **Lambda:** `nodejs24.x`, x86_64, Chromium bundled in the zip (not a layer/custom image), 60 s
  timeout, configurable memory (default 1,536 MB) and SQS batch size/concurrency.
- **S3:** a transient prints bucket with SSE-KMS and a one-day lifecycle, plus the versioned
  artifacts bucket created by bootstrap.
- **Queue:** SSE-SQS with a DLQ and a visibility timeout at least six times the worker timeout.
- **Security:** the jobs queue is the only ingress; rendering has JavaScript off and network
  blocked; callbacks are allowlisted and DNS/SSRF checked; deploys use GitHub OIDC, never static
  keys. Caller and worker roles are separate and least privilege.
- **Optional VPC:** run outside a VPC by default, create one, or attach to an existing one for
  private HTTP callbacks.

## Deployment options

| Choice              | Options                                                                                                              | Default                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Network             | `vpc_mode = "none"`, `"create"` (new VPC + endpoints, optional NAT) or `"lookup"` (existing VPC/subnets)             | `none`                 |
| Caller role         | `caller_role_mode = "create"` or `"existing"`; a provided ARN may be cross-account                                   | `create`               |
| Worker role         | `worker_role_mode = "create"` or `"existing"`; provided worker must be same-account and trust `lambda.amazonaws.com` | `create`               |
| Alarms              | `enable_alarms = true` with an existing SNS topic; DLQ depth and worker errors                                       | `false`                |
| Capacity            | `worker_memory_size`, `batch_size`, `maximum_concurrency`, `reserved_concurrency`                                    | 1,536 MB, 5, 10, unset |
| EventBridge ingress | optional `job_rule = { bus_name, event_pattern }` forwarding matching event `detail` to the jobs queue               | disabled               |
| Deploy path         | `release.yml` on `main` (semantic-release + OIDC + smoke) or a manual Terraform apply                                | release workflow       |

Start with `infra/bootstrap` once, then configure the non-secret operator values in the GitHub
`TF_VARS` variable. Every release builds the worker zip, uploads it, applies Terraform and runs
plain + PDF/A smoke jobs. Rollback is a dispatch of `release.yml` with an earlier release label.

See [Deployment](docs/deployment.md) for the full option matrix, provided-role prerequisites,
VPC trade-offs and the exact commands.

## Sample configurations

### 1. Invoice with an HTTP callback

A caller publishes a job and receives the result at an allowlisted HTTPS endpoint. The worker
renders a standard PDF, stores it for the presigned download and POSTs the result.

```json
{
  "templateId": "generic-report",
  "refId": "invoice-2026-001",
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
    "title": "Invoice 2026-001",
    "customer": { "name": "Acme GmbH" },
    "items": [{ "description": "Consulting", "quantity": 12, "unitPrice": 150, "amount": 1800 }],
    "total": 1800,
    "generatedAt": "2026-11-09T09:30:00.000Z"
  }
}
```

### 2. Archival statement delivered to S3

Request `PDF/A-2b` and have the worker PUT the PDF directly to a presigned S3 URL. The result
carries the hash, size and PDF/A level, but no `printing` URL because Printer did not store it.

```json
{
  "templateId": "monthly-statement",
  "refId": "statement-2026-10",
  "options": { "pdfA": "PDF/A-2b" },
  "webhooks": {
    "success": {
      "channel": "s3",
      "value": "https://customer-bucket.s3.eu-central-1.amazonaws.com/statements/2026-10.pdf?X-Amz-..."
    },
    "failure": {
      "channel": "sqs",
      "value": "arn:aws:sqs:eu-central-1:123456789012:printer-failures"
    }
  },
  "payload": { "account": "ACME-42", "period": "2026-10" }
}
```

### 3. EventBridge-driven batch

Enable `job_rule` on an existing bus. Matching events forward their `detail` to the jobs queue, so
one event can enqueue a job; the rest of the flow — validation, Chromium, PDF/A, callbacks and
DLQ — is unchanged. This is useful when an existing event-driven platform already emits print
requests.

```hcl
job_rule = {
  bus_name      = "default"
  event_pattern = "{\"source\":[\"my.billing\"],\"detail-type\":[\"Invoice Ready\"]}"
}
```

The event `detail` must be a contract-valid job body (`templateId`, `refId`, `webhooks`,
`payload`). EventBridge caps an event at 256 KB, below the SQS job limit of 1 MiB.

Template slugs other than `generic-report` in these examples are illustrative; only templates deployed in your manifest resolve.

### 4. Private callbacks inside a VPC

Set `vpc_mode = "create"` (or `"lookup"`), keep the worker in private subnets and allow callbacks
to private hosts. S3/SQS/Lambda/EventBridge use VPC endpoints; HTTP callbacks to hosts outside the
VPC need NAT. This is the option for internal APIs that are not publicly reachable.

## Documentation and technical resources

| Guide                                                                     | Contents                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Usage and job contract](docs/usage.md)                                   | Job/result fields, PDF/A levels, channels, examples, retries and deduplication     |
| [Architecture](docs/architecture.md)                                      | Runtime flow, ports and adapters, AWS resources, security and scaling              |
| [Templates](docs/templates.md)                                            | Template layout, Handlebars helpers, validation, preview and manifest              |
| [Deployment](docs/deployment.md)                                          | Bootstrap, VPC/role modes, alarms, release, rollback and capacity                  |
| [Development](docs/development.md)                                        | Workspace layout, commands, tests, local LocalStack flow and conventions           |
| [Operations runbook](docs/runbook.md)                                     | Alarms, DLQ redrive, template removal, KMS/state recovery, rollback and VPC checks |
| [Cloud verification](docs/cloud-verification.md)                          | First deployment, branch protection, smoke, rollback and evidence checklist        |
| [Load test and Power Tuning](docs/load-test.md)                           | Capacity harness, 1/20-page matrix, p95/memory reporting and tuning                |
| [Technical specification](docs/specification.md)                          | Full requirement and contract reference (historical source of truth)               |
| [Infrastructure](infra/README.md)                                         | Terraform resources, inputs, role/VPC details and outputs                          |
| [Bootstrap](infra/bootstrap/README.md)                                    | One-time state/artifact buckets, OIDC and deploy/plan roles                        |
| [Contracts](packages/contracts)                                           | JSON Schemas, generated types and validation                                       |
| [CI](.github/workflows/ci.yml) / [release](.github/workflows/release.yml) | Checks, semantic-release, OIDC deploy, smoke and manifest publication              |

## Project status

The full rendering, PDF/A, callback, role, alarm, regression, packaging, smoke, load-test and
cloud-verification implementation is in place. The remaining work is operator verification of the
first real AWS deployment: live plain/PDF-A smoke, rollback, branch protection, SNS alarm test and
confirmation of the throughput target. See
[Cloud verification](docs/cloud-verification.md).

## License

Private and unpublished. All rights reserved.
