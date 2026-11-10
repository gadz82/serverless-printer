# Assessment impact map

## Slice 1 — Templates and network (this iteration)

| Area | Change | Requirements |
|---|---|---|
| `packages/template-engine` | Handlebars compile modes, fixed helpers, placeholder AST, hashing, manifest | R-101, R-102 |
| `scripts/template-*` | `new`, `validate`, `check`, `preview`, `manifest` using the engine | R-103, R-105 |
| `templates/generic-report` | Real template with fonts, assets and sample data | R-104 |
| `apps/render-worker` | Manifest catalog uses the full engine; `_smoke` remains | R-102, R-104 |
| `infra/modules/network` + printer | `vpc_mode` create/lookup, subnets, NAT, endpoints, worker VPC config | R-106 |
| CI | Template validate/check commands wired in | R-105 |

## Slice 2 — Rendering and delivery (follow-up)

| Area | Change | Requirements |
|---|---|---|
| Worker renderer | Chromium adapter with JS disabled, interception, page settings, browser reuse | R-107 |
| Worker archiver | pdf-lib PDF/A for all eight levels, ICC/XMP/Info/safety checks | R-108 |
| Worker delivery | HTTP, Lambda, EventBridge, S3 adapters and ping | R-109 |
| Worker security | Allowlist, DNS/SSRF, link-local/metadata blocking | R-110 |
| CI/tests | Render regression, PDF/A matrix, channel tests | R-111 |

## Slice 3 — Production readiness and cloud verification (follow-up)

| Area | Change | Requirements |
|---|---|---|
| Capacity | Throughput target, Power Tuning, load test, memory/concurrency | R-112 |
| Operations | Opt-in alarms, SNS, runbook, DLQ redrive, template removal | R-113 |
| Release | Plain + PDF/A smoke, first real template live | R-114 |
| Cloud | Bootstrap, OIDC deploy, branch protection, rollback evidence | R-115 |

## Ports and adapters

| Port | Slice | Adapter |
|---|---|---|
| Existing `PdfRenderer` | 2 | Chromium via puppeteer-core + @sparticuz/chromium |
| New `PdfArchiver` | 2 | pdf-lib post-processor |
| Existing `ResultDelivery` | 2 | HTTP, Lambda, EventBridge, S3 added to SQS |
| New `CallbackPolicy`/allowlist | 2 | HTTP allowlist + DNS/SSRF resolver |
| Existing `TemplateCatalog` | 1 | Full engine manifest |

## Boundary checks

- Template engine and domain stay free of AWS/Chromium/pdf-lib.
- Channel-specific payload/headers stay in adapters; the result shape stays shared.
- Network module is optional and default-off.
- No API/UI/database/environments/template upload.

## Risks by area

| Risk | Slice | Mitigation |
|---|---|---|
| Chromium version/package mismatch | 2 | Pin major, render regression, CI x86_64 |
| PDF/A conformance limits | 2 | Best-effort documented; failure checks |
| SSRF/allowlist bypass | 2 | DNS resolution and link-local blocking plus tests |
| VPC/NAT cost and apply complexity | 1 | Default none; plan review; separate apply test |
| Iteration size/budget | all | Split into slices per ADR-107 |
| Throughput target undefined | 3 | Confirm before load test |
