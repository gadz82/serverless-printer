# @printer/render-worker

Lambda worker for the Phase 1 printer foundation.

- Entry point: `handler.handler`.
- Inbound: SQS jobs queue; each record is validated with `@printer/contracts`.
- Rendering: `PlaceholderPdfRenderer` returns a fixed, dependency-free one-page PDF. It is
  **not** production rendering and never labels the output as PDF/A.
- Storage: `prints/<printId>.pdf` in S3 with a presigned GET and SHA-256 metadata. Encryption
  is left to the prints bucket's default SSE-KMS configuration with the project CMK; the worker
  sends no per-object encryption header, which also keeps LocalStack to SQS and S3.
- Delivery: SQS result queue only. Other channels fail non-retryably with
  `CALLBACK_NOT_ALLOWED`.
- Failures: retryable failures and last-attempt delivery failures are returned as
  `batchItemFailures`; the worker never deletes messages itself.

`composeWorker` is the only wiring point and runs once per cold start.

## Configuration

`PRINTS_BUCKET` is required. The other variables default as in the specification:
`HANDLEBARS_MODE=lenient`, `PDFA_ALLOWED_LEVELS` empty, `CALLBACK_ALLOWLIST=[]`,
`EVENT_SOURCE=printer`, `PRESIGN_TTL_SECONDS=900`, `MAX_RECEIVE_COUNT=5`.

- `SQS_ENDPOINT_URL` is optional and intended only for local/test environments; production
  leaves it unset. HTTPS URLs are accepted generally; plain HTTP is restricted to loopback hosts
  (`localhost`, `127.0.0.1`, `[::1]`), for example `http://localhost:4566` with LocalStack. The
  result sender then posts to `<endpoint>/<accountId>/<queueName>` instead of the AWS SQS host.
- `TEMPLATE_MANIFEST_PATH` is optional and defaults to the committed
  `src/templates.manifest.json` fixture. The release build replaces that bundle with the
  generated `dist/templates.manifest.json`. A worker test regenerates the manifest from
  `templates/` with `scripts/template-manifest.mjs` and fails if the committed copy drifts.
