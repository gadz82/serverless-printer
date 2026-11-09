# P-006 implementation report

- Prompt: P-006 — Run the worker against LocalStack with a callback sink and integration tests
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-006`
- Status: complete

## Delivered

- `docker-compose.yml` with LocalStack 4 (`sqs,s3`, port 4566, healthcheck) and a
  `callback-sink` service on `node:24-alpine` mounted at `/workspace`.
- `scripts/local-setup.mjs`: idempotent queues, DLQ redrive (`maxReceiveCount=5`, 360 s
  visibility), smoke-results queue, prints bucket and manifest generation.
- `scripts/local-worker.mjs`: real `composeWorker`/`createSqsHandler`, SQS Lambda event
  construction, batchItemFailures handling and delete-only-on-success.
- `scripts/local-callback-sink.mjs`: parses valid JSON before appending to
  `.local/results.jsonl`, discards invalid poison messages with a warning.
- `scripts/smoke-local.mjs`: sends a `_smoke` SQS job and requires a matching `success: true`
  result within 30 seconds.
- Six LocalStack integration tests: success with real SQS/S3 and presigned download, invalid
  message failure, unknown template, retryable batch failure, last-attempt failure, FIFO
  identifiers.

## Review

Independent reviewer: PASS/ACCEPT, no blocking findings. Low findings fixed before merge:

1. The success result is now validated with the production result schema after normalizing only
   the LocalStack `http://` presign scheme to `https://`; the raw URL and downloaded SHA-256 are
   still asserted.
2. The smoke script requires `success === true`; a matching failure result exits non-zero with
   the error code/message.
3. The sink parses/validates before appending, so non-JSON bodies cannot pollute the results
   file.

## Acceptance

| Command | Result |
|---|---|
| `docker compose up -d localstack` | PASS — healthy |
| `pnpm local:setup` | PASS — idempotent |
| `pnpm test:integration` | PASS — 6 tests |
| Worker + sink + `pnpm smoke:local` | PASS — success result, sink recorded |
| `pnpm lint`, `pnpm typecheck`, Prettier | PASS |
| `pnpm test` on main after merge | PASS — 285 tests |

The compose `callback-sink` service was also exercised and recorded a smoke result.

## Residual risks

- LocalStack presigned URLs are HTTP; the contract check normalizes only the scheme and does not
  prove HTTPS signing locally.
- DLQ redrive is configured but not driven through five receives in integration tests.
- The local sink is at-least-once and may duplicate lines after an append/delete failure.
- Test environment isolation relies on explicit env; the worker's S3 client still uses ambient
  AWS SDK configuration.
- LocalStack virtual-host S3 and the 30-second readiness timeout are environment-dependent.
