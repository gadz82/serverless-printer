# Regression and test plan

## Slice 2

| Level | Coverage |
|---|---|
| Unit | Chromium settings/interception/browser lifecycle; archiver metadata/safety; five channels/ping; allowlist/DNS/SSRF; role policy documents |
| Integration | LocalStack SQS/S3/Lambda/EventBridge; local HTTP sink for HTTP/ping; PDF/A matrix; handler batch paths |
| Render regression | Page count, extracted text, visual diff for plain and PDF/A references on Ubuntu x86_64 |
| Contract | Existing job/result schemas and channel payloads |

## Slice 3

| Level | Coverage |
|---|---|
| Load | Confirmed jobs/min, 1/20-page mix, with/without PDF/A; p95/errors/memory |
| Power Tuning | 1,536 MB baseline plus candidate memories |
| Deployed smoke | Plain + PDF/A after every release/rollback |
| Operations | Alarms, DLQ redrive, template removal, runbook walk-through |
| Roles | Terraform plan for create/existing caller/worker modes; no IAM mutation in existing mode; PassRole |
| Cloud | Bootstrap, OIDC deploy, rollback, branch protection |

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:integration
pnpm test:render
pnpm template:validate
pnpm template:check --base origin/main
pnpm build:worker
pnpm smoke:test
terraform -chdir=infra validate
```

## Failure priorities

- JS/network isolation; browser crash/timeout.
- PDF/A unsafe inputs and metadata.
- HTTP timeout/allowlist/SSRF; Lambda/EventBridge/S3 payloads; FIFO.
- Provided role trust/PassRole; caller/worker separation.
- Network apply; smoke timeout/rollback.

## Risks

| Risk | Guard |
|---|---|
| Chromium package drift | Pin + render regression |
| PDF/A false claims | Best-effort docs + checks |
| SSRF regression | Dedicated security tests |
| Provided role over-privilege | Owner docs + generated default |
| Load flakiness | Repeat runs/variance |
