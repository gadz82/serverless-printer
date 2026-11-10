# Contract assessment

## Unchanged public job/result contract

The Phase 1 job/result schemas already model:

- `options.pdfA` with all eight levels;
- `webhooks.success` with `http`, `lambda`, `sqs`, `eventBridge`, `s3`;
- `webhooks.failure` with the four non-S3 channels;
- `pingUrl`, channel-specific values and the success/failure result shapes.

No breaking change is planned. Phase 3 implements the behaviour behind the existing contract and
restores the default allowed PDF/A levels after the Phase 1 rejection.

## New internal contract: `template.json`

A template descriptor becomes a validated schema:

| Field | Type | Rule |
|---|---|---|
| `id` | string | UUID v4; immutable; unique |
| `slug` | string | `_smoke` or `^[a-z][a-z0-9-]{2,63}$`; immutable; unique |
| `name` | string | non-empty |
| `description` | string | non-empty |

`template:validate` enforces this schema plus Handlebars compilation and `sample.json` against the
placeholder tree. `template:check` compares identity against the base commit.

## Manifest extension

The manifest keeps `release` and adds the full placeholder tree per template:

```json
{
  "release": "v1.4.0",
  "templates": [
    {
      "id": "…",
      "slug": "generic-report",
      "name": "Generic report",
      "path": "templates/generic-report",
      "contentHash": "…",
      "placeholders": { "customer": { "name": "string" } }
    }
  ]
}
```

`contentHash` remains SHA-256 over sorted files; the release asset remains the manifest itself.

## Delivery contract details

- HTTP: POST JSON, `X-Printer-Print-Id`, 5 s timeout, any 2xx delivered.
- Lambda: `Invoke` with `InvocationType=Event`; body is the result.
- SQS: `SendMessage`; FIFO group/deduplication rules from Phase 1.
- EventBridge: `PutEvents` with `EVENT_SOURCE` and `printer.print.succeeded|failed`.
- S3: presigned PUT with `Content-Type: application/pdf`; `printing`/`printingExpiresAt` omitted.
- Ping: POST `{"success": true|false}` after channel delivery.

## Compatibility

Any required-field or enum change is a major contract change with an ADR. The Phase 3 work is
expected to be additive/behavioural only.
