# Regression and test plan

## Slice 1 — Templates and network

| Level | Coverage |
|---|---|
| Unit | Handlebars modes, fixed helpers, prototype access, placeholder AST, hashing, manifest, validation rules, check guard |
| Integration | `template:new` → validate → preview with sample/`--data`; generic-report renders through the real use case; `_smoke` regression |
| Terraform | `fmt`, `validate`, tflint; `vpc_mode` none/create/lookup plans |
| CI | `template:validate`, `template:check --base origin/main` |

## Slice 2 — Rendering and delivery

| Level | Coverage |
|---|---|
| Unit | Chromium adapter settings, request interception, browser reuse, archiver metadata/safety checks, channel adapters, allowlist/DNS/SSRF |
| Integration | LocalStack SQS/S3/Lambda/EventBridge where supported; HTTP and ping via a local sink; PDF/A level matrix |
| Render regression | Page count, extracted text and visual comparison for plain and PDF/A references on Ubuntu x86_64 |
| Contract | Existing job/result schemas; channel-specific values |

## Slice 3 — Production readiness

| Level | Coverage |
|---|---|
| Load | Agreed jobs/min, 1-page/20-page mix, with/without PDF/A; p95 latency, errors, memory |
| Power Tuning | 1,536 MB baseline plus candidate memories |
| Deployed smoke | Plain and PDF/A `_smoke` after every release and rollback |
| Operations | Alarms, DLQ redrive, template removal, runbook walk-through |
| Cloud | Bootstrap, OIDC deploy, rollback, branch protection evidence |

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm template:validate
pnpm template:check --base origin/main
pnpm template:preview generic-report --data templates/generic-report/sample.json
pnpm test:integration
pnpm test:render
pnpm build:worker
pnpm smoke:test
```

## Failure priorities

- Template modes and helper restrictions; identity/validation/check.
- Request interception and external URL blocking.
- PDF/A metadata/safety failures.
- HTTP timeout/allowlist/SSRF; Lambda/EventBridge/S3 payloads; FIFO.
- Network endpoint/NAT gaps.
- Deployed smoke timeout and rollback.

## Risks

| Risk | Guard |
|---|---|
| Chromium package drift | Pin major; render regression |
| PDF/A false claims | Best-effort docs; fail checks; no validator claim |
| SSRF regression | Dedicated security tests |
| Network apply breaks none mode | Terraform tests for all modes |
| Load test flakiness | Repeat runs and record variance |
