# Contract assessment — job and result schemas

- Contract version: `1.0.0`
- Schema dialect: JSON Schema 2020-12
- Validation: Ajv 2020 with `allErrors` and strict mode at the worker boundary
- Type generation: `json-schema-to-typescript` into `packages/contracts/src/generated/`
- Source of truth: `packages/contracts/schemas/*.schema.json`

## Job schema

Required: `templateId`, `refId`, `webhooks` (with `webhooks.success`). Optional: `options`,
`payload`. Unknown top-level fields are rejected (`additionalProperties: false`) so typos fail
fast and the contract stays explicit.

| Field | Type | Rules |
|---|---|---|
| `templateId` | string | 1–128 characters; a UUID, the reserved `_smoke` slug, or a normal slug matching `^[a-z][a-z0-9-]{2,63}$` (ADR-006) |
| `refId` | string \| number \| object | Echoed unchanged; object values are compared deeply |
| `options` | object | Optional; `pdfA` is `false` (default) or one of the enabled levels |
| `options.pdfA` | boolean \| string | `false` or `PDF/A-1b`, `1a`, `2b`, `2u`, `2a`, `3b`, `3u`, `3a`; must be in the configured allowed levels. Phase 1 defaults the allowed list to empty, so archival requests fail with `PDFA_LEVEL_NOT_ALLOWED` |
| `webhooks.success` | object | Required; `channel` is `http`, `lambda`, `sqs`, `eventBridge` or `s3` |
| `webhooks.success.pingUrl` | string \| null | Optional HTTPS URL on the allowlist; `null` means no ping |
| `webhooks.success.value` | string | HTTPS URL, Lambda ARN, SQS queue ARN, EventBridge bus ARN, or presigned PUT URL |
| `webhooks.failure` | object | Optional; same shape as success but `s3` is not allowed |
| `payload` | object | Handlebars context; defaults to `{}`; bounded by the 1 MiB message limit |

Channel-specific validation is expressed with `if/then`: `http` requires an HTTPS URL, `sqs`,
`lambda` and `eventBridge` require ARN-shaped values, and `s3` requires an HTTPS presigned PUT
URL. `pingUrl` is HTTPS-only when present.

## Result schema

### Success

Required: `success: true`, `printId`, `refId`, `sha256`, `sizeBytes`, `pdfA`, `template`,
`renderedAt`. `printing` and `printingExpiresAt` are present for callback channels and omitted
for the `s3` channel; `dependentRequired` enforces that the two appear together.

| Field | Type | Rules |
|---|---|---|
| `printId` | string | UUID; `UUIDv5(project namespace, inbound SQS messageId)` |
| `refId` | string \| number \| object | Identical to the submitted value |
| `printing` | string | HTTPS presigned GET URL |
| `printingExpiresAt` | string | RFC 3339 date-time; derived from `PRESIGN_TTL_SECONDS` |
| `sha256` | string | 64 lower-case hex characters over the stored PDF bytes |
| `sizeBytes` | integer | ≥ 1 |
| `pdfA` | string \| null | `null` for a standard PDF; otherwise the requested level |
| `template` | object | `id`, `slug`, `contentHash`, `release` |
| `renderedAt` | string | RFC 3339 date-time |

### Failure

Required: `success: false`, `printId`, `refId`, `template` (nullable), `error`, `failedAt`.
`error.code` is one of the eight codes in the spec; `error.retryable` matches the code table;
`error.attempts` is ≥ 1. `template` is `null` only when resolution failed.

## Error codes

`INVALID_MESSAGE`, `PDFA_LEVEL_NOT_ALLOWED`, `TEMPLATE_NOT_FOUND`, `CALLBACK_NOT_ALLOWED`,
`TEMPLATE_RENDER_FAILED`, `PDFA_CONVERSION_FAILED`, `PDF_RENDER_FAILED`, `DELIVERY_FAILED`.

Unsupported channels in this increment (`http`, `lambda`, `eventBridge`, `s3`) fail as
`CALLBACK_NOT_ALLOWED` with a message naming the unsupported channel; no new public error code is
invented for a known Phase 1 limitation.

## Compatibility rules

- Additive optional fields are minor versions when they do not change acceptance.
- New required fields, enum narrowing, or a changed error contract are major versions and need an
  ADR.
- Generated types are committed and verified in CI; regenerating must not change the diff.
- Fixtures cover one valid job/result pair and at least one invalid case per required field and
  per channel-specific rule.
- The print-id namespace is a committed constant; changing it invalidates caller deduplication.

## Open technical questions

- None blocking. Channel-specific validation details are completed in the planning prompt for the
  contract package.
