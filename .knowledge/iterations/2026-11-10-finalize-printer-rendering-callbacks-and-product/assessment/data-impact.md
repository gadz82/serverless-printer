# Data impact

- No database. Prints remain transient in S3 with one-day expiry.
- PDF/A is in-memory post-processing; no new persistent copy.
- Render reference PDFs are Git/release artifacts with synthetic data; no customer PII.
- Logs never include payload, HTML, PDF bytes, refId, presigned URLs or callback URLs in full.
- Provided IAM roles/ARNs are configuration, not secrets; no credentials stored.
- Role trust principals and callback targets are account metadata; no PII.
- Caller role output is an ARN; safe to publish.
- HTML/HTTP channel payloads contain the result/`refId`; transport encryption/allowlist applies.

## Risks

| Risk | Mitigation |
|---|---|
| Reference PDFs contain PII | Synthetic fixtures and review |
| Logs leak URLs/payload | Logger allowlist/tests |
| Chromium/PDF-A memory pressure | Power Tuning/load test |
| Artifact growth | Versioned bucket/retention |
