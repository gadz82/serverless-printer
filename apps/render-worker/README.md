# @printer/render-worker

Render worker for the Printer service.

- Entry point: `handler.handler`.
- Inbound: SQS jobs queue; each record is validated with `@printer/contracts`.
- Rendering: `TemplatePdfRenderer` resolves the bundled template, compiles Handlebars with
  `HANDLEBARS_MODE` and renders it with `ChromiumPdfRenderer` on Lambda or
  `LocalChromeRenderer` outside Lambda. `PDF_RENDERER=auto|lambda|local` can force the choice.
- PDF/A: `PdfLibPdfArchiver` applies the requested level; `PDFA_ALLOWED_LEVELS` defaults to every
  supported level.
- Storage: `prints/<printId>.pdf` in S3 with a presigned GET and SHA-256 metadata. Encryption
  is left to the prints bucket's default SSE-KMS configuration with the project CMK; the worker
  sends no per-object encryption header.
- Delivery: `http`, `lambda`, `sqs`, `eventBridge` and `s3`, then the optional ping. HTTP and
  ping URLs go through the callback policy and pinned DNS transport. S3 presigned PUT URLs must
  use HTTPS; loopback, metadata and link-local addresses are always rejected, and private VPC
  endpoints need `S3_ALLOW_PRIVATE_ENDPOINT=true`.
- Failures: retryable failures and last-attempt delivery failures are returned as
  `batchItemFailures`; the worker never deletes messages itself.

`composeWorker` is the only wiring point and runs once per cold start.

## Configuration

`PRINTS_BUCKET` is required. The other variables default as in the specification:
`HANDLEBARS_MODE=lenient`, `PDFA_ALLOWED_LEVELS` every level, `PDF_RENDERER=auto`,
`S3_ALLOW_PRIVATE_ENDPOINT=false`, `CALLBACK_ALLOWLIST=[]`, `EVENT_SOURCE=printer`,
`PRESIGN_TTL_SECONDS=900`, `MAX_RECEIVE_COUNT=5`.

- `SQS_ENDPOINT_URL` is optional and intended only for local/test environments; production
  leaves it unset. HTTPS URLs are accepted generally; plain HTTP is restricted to loopback hosts
  (`localhost`, `127.0.0.1`, `[::1]`), for example `http://localhost:4566` with LocalStack. The
  result sender then posts to `<endpoint>/<accountId>/<queueName>` instead of the AWS SQS host.
- `TEMPLATE_MANIFEST_PATH` is optional and defaults to the committed
  `src/templates.manifest.json` fixture. The release build replaces that bundle with the
  generated `dist/templates.manifest.json`. A worker test regenerates the manifest from
  `templates/` with `scripts/template-manifest.mjs` and fails if the committed copy drifts.
- `PDF_RENDERER` defaults to `auto`: bundled Chromium when `AWS_LAMBDA_FUNCTION_NAME` is set,
  installed Chrome otherwise. `local` and `lambda` force one backend.
- `S3_ALLOW_PRIVATE_ENDPOINT` defaults to `false`. Set it only when the presigned endpoint is a
  private VPC S3 endpoint; metadata, link-local and loopback addresses remain blocked.
