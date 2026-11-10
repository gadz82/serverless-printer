# Architecture

Printer is one asynchronous AWS deployment. Callers publish jobs to an SQS queue; a Lambda worker
renders one PDF per job with headless Chromium, optionally converts it to PDF/A, and delivers the
result through the caller's chosen channel.

## Runtime flow

```text
caller
  │ SendMessage(job)
  ▼
SQS jobs queue ──▶ Lambda render worker (SQS event source mapping)
                         │
                         ├─ validate job + PDF/A allowlist
                         ├─ validate callbacks (allowlist + DNS/SSRF)
                         ├─ resolve template from the bundled manifest
                         ├─ compile Handlebars with the payload
                         ├─ Chromium page.pdf()  (JS off, external requests blocked)
                         ├─ optional PDF/A post-processing (pdf-lib)
                         ├─ store prints/<printId>.pdf (S3, presigned GET, 1-day expiry)
                         │    or PUT direct to the caller's presigned S3 URL
                         └─ deliver result + optional ping
                                http | lambda | sqs | eventBridge | s3
```

The use case is `ProcessPrintJob` in `packages/domain`. It depends only on ports: template
catalog, PDF renderer, PDF archiver, print repository, PDF destination, result delivery, clock,
id generator and logger. AWS, Chromium, pdf-lib and HTTP live in adapters under
`apps/render-worker`.

## Ports and adapters

| Port                | Production adapter                            | Purpose                                                   |
| ------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `TemplateCatalog`   | Manifest catalog                              | Resolve id/slug from the bundled, content-hashed manifest |
| `PdfRenderer`       | `TemplatePdfRenderer` + `ChromiumPdfRenderer` | Compile the template and render with Chromium             |
| `PdfArchiver`       | `PdfLibPdfArchiver`                           | All eight PDF/A levels, XMP/ICC/safety                    |
| `PrintRepository`   | S3 print repository                           | Store the standard PDF and presign a GET                  |
| `PdfDestination`    | `S3PdfDestination`                            | Upload PDF bytes to the caller's presigned URL            |
| `ResultDelivery`    | `ResultDeliveryRouter` + channel adapters     | Deliver the result and ping                               |
| `CallbackValidator` | `CallbackPolicy`                              | Allowlist + DNS/link-local/metadata checks                |

The composition root (`apps/render-worker/src/composition-root.ts`) is the only wiring point. It
selects the local Chrome renderer outside Lambda and the bundled `@sparticuz/chromium` adapter in
Lambda, while keeping the same page settings and request policy.

## AWS resources

| Resource                      | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| SQS jobs queue + DLQ          | The only ingress; SSE-SQS, redrive, visibility timeout ≥ 6× the worker timeout |
| Lambda render worker          | `nodejs24.x`, x86_64, Chromium in the zip, published version + `live` alias    |
| SQS event source mapping      | Batch size 1–5, `ReportBatchItemFailures`, `maximum_concurrency`               |
| S3 prints bucket              | SSE-KMS, TLS-only, versioning off, `prints/*` expires after one day            |
| S3 artifacts bucket           | Worker zips per release, created by bootstrap                                  |
| KMS key                       | Encrypts prints and grants the worker decrypt/generate-data-key                |
| CloudWatch log group + alarms | Worker logs, optional DLQ-depth and worker-error alarms to SNS                 |
| IAM caller role               | `sqs:SendMessage` only on the jobs queue; generated or provided                |
| IAM worker role               | Consume jobs, prints/KMS/logs, scoped callback sends; generated or provided    |
| Optional VPC                  | `none`, `create` (VPC + endpoints, optional NAT) or `lookup`                   |
| Optional EventBridge rule     | `job_rule` forwards matching event `detail` to the jobs queue                  |

The jobs queue policy admits the generated/provided caller role, configured sender accounts or
principals, and an organization ID when configured. The release smoke uses the deploy role's
identity policy. The worker never sends to the jobs queue.

## Security model

- **Entry point:** SQS only. No API, UI, human endpoint, database or runtime template upload.
- **Rendering:** JavaScript disabled; request interception allows only bundled files/data URIs;
  payload values are escaped by Handlebars; the helper set is fixed.
- **Callbacks:** HTTPS allowlist for `http`/ping; DNS resolution rejects loopback, link-local,
  metadata and non-routable answers; validated addresses are pinned for the request and redirects
  are not followed. S3 presigned PUT URLs get the same address safety checks.
- **AWS targets:** `callback_target_arns` scopes Lambda/SQS/EventBridge sends, with an optional
  `aws:ResourceOrgID` condition.
- **Rendering isolation:** one browser per instance, one page per job, bounded cleanup and a
  render deadline below the Lambda timeout.
- **Delivery:** no prints retained beyond the one-day S3 lifecycle; S3-channel uploads skip print
  storage entirely.
- **Deploys:** GitHub OIDC with separate deploy/plan roles; no static AWS keys. Caller and worker
  roles are separate and least privilege.

## Scaling and failure handling

- SQS absorbs bursts; Lambda scales from zero up to `maximum_concurrency`.
- Batch size 1–5 lets one instance render several jobs sequentially on the same browser.
- Chromium is launched once per instance and reused; a crash or target-closed error relaunches and
  retries the job once.
- Retryable errors are rethrown for SQS redelivery. On the last attempt the worker delivers the
  failure result; if that delivery fails, the message reaches the DLQ.
- Non-retryable errors deliver the failure result immediately (when a failure webhook exists).
- `printId = UUIDv5(namespace, inbound message id)` makes retries overwrite the same S3 object and
  lets callers deduplicate.
- The worker timeout is 60 s; the render deadline is 50 s, leaving room for PDF/A, storage and
  delivery.

## Deployment topology

There is one deployment, one Terraform state and no environments. `infra/bootstrap` creates the
state bucket, artifacts bucket and GitHub OIDC roles once; `infra/` is the application stack.
The optional VPC module can create or look up a VPC when private callbacks are required.

See [Deployment](deployment.md) for options and [Usage](usage.md) for the job contract.
