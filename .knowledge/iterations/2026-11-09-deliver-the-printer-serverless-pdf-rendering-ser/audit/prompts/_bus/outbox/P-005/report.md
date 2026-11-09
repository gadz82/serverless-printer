# P-005 implementation report

- Prompt: P-005 — Implement the Lambda worker, AWS adapters and SQS batch handling
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-005`
- Status: complete

## Delivered

- `@printer/render-worker` Lambda package with strict config parsing, structured redacting
  logger, manifest catalog, deterministic placeholder PDF renderer, S3 print repository, SQS
  result delivery, UUIDv5 print ids and a single composition root.
- Lambda handler with sequential batch processing, `ApproximateReceiveCount`/`MAX_RECEIVE_COUNT`
  retry logic, `batchItemFailures`, invalid-message failure delivery when a readable SQS failure
  webhook exists, and no direct message deletion.
- SQS ARN→URL conversion, FIFO group/deduplication rules with canonical object refIds,
  `SQS_ENDPOINT_URL` loopback-only local support, S3 `prints/<printId>.pdf` with SHA-256, size
  and presigned GET, and bucket-default SSE-KMS reliance.
- 74 tests across 10 files, including a manifest drift guard.

## Review

Two independent reviewers: PASS/ACCEPT for Phase 1 scope. Review fixes applied before merge:

1. **LocalStack SQS:** added optional `SQS_ENDPOINT_URL`, passed to the SQS client and used to
   build `<endpoint>/<account>/<queue>`; plain HTTP restricted to loopback. Verified end-to-end
   against LocalStack by reviewer B.
2. **ESM bundling:** P-010 prompt now requires a `createRequire` banner and a post-build import
   check, because AWS SDK CJS dependencies dynamically require Node built-ins.
3. **Non-finite refId:** JSON parse rejects non-finite numbers; `readRefId` guards finite numbers;
   tests cover `1e400` and nested non-finite values.
4. **Manifest fail-fast:** the catalog reads and validates eagerly in its constructor; a missing
   or corrupt manifest fails composition at cold start.
5. **Manifest drift:** a test regenerates the manifest from a template snapshot and compares it to
   the committed `src` copy.
6. **S3 encryption:** removed the explicit `ServerSideEncryption: "aws:kms"` header because
   without a key ID it selects the AWS-managed aws/s3 key, not the project CMK. The prints bucket
   default SSE-KMS with the project CMK is the single encryption source.
7. **Presign expiry:** `printingExpiresAt` now derives from a timestamp captured before
   presigning.

## Acceptance

| Command | Result |
|---|---|
| `pnpm --filter @printer/render-worker test` | PASS — 74 tests |
| `pnpm --filter @printer/render-worker typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm exec prettier --check apps/render-worker` | PASS |
| `pnpm test` / `pnpm typecheck` on main after merge | PASS |

## Residual risks

- LocalStack presigned GET URLs are HTTP while the result contract requires HTTPS; P-006
  integration tests must be scheme-aware, and deployed smoke remains authoritative.
- Cross-region SQS callbacks sign with the worker region; same-region callbacks are the supported
  case.
- `MAX_RECEIVE_COUNT` must match the Terraform redrive policy; P-008 wires both from the same
  variable.
- Storage/manifest errors normalize to retryable `PDF_RENDER_FAILED`; retry/DLQ behaviour is
  sound but the public code is approximate.
- The committed source manifest is a pinned local fixture guarded by the drift test.
