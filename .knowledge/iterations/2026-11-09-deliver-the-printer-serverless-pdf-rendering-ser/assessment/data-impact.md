# Data impact assessment

## Stores

| Store | Purpose | Retention | Encryption | Access |
|---|---|---|---|---|
| Prints bucket | Transient PDFs produced by jobs | 1 day (S3 lifecycle) | SSE-KMS with a project CMK | Worker writes/reads; callers receive presigned GETs |
| Artifacts bucket | Worker zips per release | Versioned; no expiry by default | SSE-S3 or SSE-KMS per bootstrap | CI deploy role writes; Terraform reads |
| Terraform state bucket | Single deployment state | Versioned | SSE-S3/KMS per bootstrap | Deploy and plan roles |
| CloudWatch Logs | Worker and pipeline diagnostics | `log_retention_days`, default 30 | CloudWatch-managed | Operators |

There is no database, no queue of record, and no durable copy of a print. SQS and the manifest
are transport and build artifacts, not data stores.

## Data rules

- **No long-lived prints.** The lifecycle rule is the retention authority; the worker never
  writes outside `prints/`.
- **Presigned links are short-lived.** `PRESIGN_TTL_SECONDS` defaults to 900 seconds; the result
  carries the exact expiry.
- **Deterministic identity.** `printId = UUIDv5(namespace, inbound SQS messageId)`; a retry
  overwrites the same key, and callers deduplicate on it.
- **No payload logging.** Payloads may contain personal data. Log `printId`, `templateId`,
  `messageId`, attempt, error code and duration; do not log `refId`, payload values, rendered
  HTML or PDF bytes. If correlation is needed, log a SHA-256 prefix of `refId`, not the value.
- **No secrets in code, state, or logs.** AWS credentials are OIDC-only; no static keys. State
  and artifacts buckets block public access.
- **Safe deletion.** The prints bucket has no versioning, so expiry deletes the object. The
  artifacts and state buckets are versioned and are not subject to the print lifecycle.

## Schema and migration impact

- Greenfield: no migration, backfill or compatibility window.
- The contracts are versioned `1.0.0`; future breaking changes need a major version and an ADR.
- Changing the print-id namespace, object key format, or error payload is a breaking change for
  callers and needs an ADR.

## PII and compliance

- The service is a renderer, not a system of record. PII enters through `payload` and possibly
  `refId`; it must not be logged or retained beyond the one-day PDF expiry.
- PDF/A conversion and accessibility are Phase 3; no archival claim is made in this increment.
- No data leaves the deployment region except through the caller's chosen callback target.

## Data-related risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Payload PII leaks into logs | Medium | High | Logging allowlist; unit test the logger adapter; review log fields |
| Print object outlives one day | Low | Medium | Lifecycle rule plus a Terraform assertion and an integration check |
| Presigned URL outlives intent | Low | Medium | TTL from configuration; result carries the exact expiry |
| Artifacts/state bucket misconfiguration | Low | High | Bootstrap public-access block and encryption; Terraform review |
