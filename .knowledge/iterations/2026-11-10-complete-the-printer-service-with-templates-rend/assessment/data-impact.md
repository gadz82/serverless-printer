# Data impact

## Stores

| Store | Use | Retention | Change |
|---|---|---|---|
| Prints bucket | Transient PDFs | 1 day | Unchanged |
| Artifacts bucket | Worker zips, manifest, reference PDFs | Versioned | Chromium increases zip size |
| State bucket | Terraform state | Versioned | Network state adds resources |
| CloudWatch Logs | Diagnostics | 30 days default | New channel/PDF-A events; no payload/refId |
| Render fixtures | Regression references in the repo | Git history | New binary PDFs |

No database is added. No durable print or template data is added.

## Data rules

- PDF/A post-processing is in memory; no new persistent copy.
- Logs never include payload, rendered HTML, PDF bytes, refId or presigned URLs. Channel events
  log the printId, channel, error code and duration.
- HTTP callback values and ping URLs are not logged in full.
- Reference PDFs must not contain customer data; use synthetic sample data.
- Prints still expire after one day; presigned URLs remain short-lived.
- The manifest is public release metadata; it contains no customer data.

## PII and security

- Payloads may contain PII; they are passed to Chromium and PDF/A but never logged or persisted
  beyond the print object's one-day lifetime.
- HTTP allowlist/DNS checks are the security boundary for callbacks; log decisions without URLs
  where possible.
- No secrets in templates, fixtures or the manifest.

## Risks

| Risk | Mitigation |
|---|---|
| Reference PDFs accidentally contain PII | Synthetic fixtures and review |
| Chromium/PDF-A memory pressure | Power Tuning and load test |
| Logs leak URLs/payloads | Logger allowlist and tests |
| Artifact bucket growth with Chromium | Versioned bucket and release retention policy |
