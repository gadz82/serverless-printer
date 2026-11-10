# TRD — Finalize Printer rendering, callbacks and production readiness

- Iteration: `2026-11-10-finalize-printer-rendering-callbacks-and-product`
- Constitution: `.orchid/constitution/constitution.md`
- Source: `SPEC.md` v0.4 Phases 3–4, Slice 1 handover, ADR-102–107
- This is a hypothesis; the assessment validates it.

## Constraints

- Lambda Node 24 `x86_64`; `puppeteer-core` pinned to the Chromium major of
  `@sparticuz/chromium`; browser bundled in the zip and marked external in esbuild.
- pdf-lib for PDF/A; no binary archiver; best-effort conformance.
- One deployment, no API/UI/database/environments; queue remains the only entry.
- Terraform >= 1.11, AWS ~> 6.0; OIDC only; no static keys.
- Callback security: allowlist + DNS/link-local/metadata checks, scoped IAM.
- Budget: Slices 2+3 estimated ~400k–450k build tokens; split Slice 3 if the plan exceeds the
  stop threshold.

## Architecture direction

- `apps/render-worker/src/rendering/` — refactor the local renderer into a shared HTML/PDF
  settings module and add `ChromiumPdfRenderer` using `@sparticuz/chromium`:
  - launch once per instance, new page per job, relaunch after crash;
  - JS disabled, request interception allowing only bundled files/data URIs;
  - A4/printBackground/preferCSSPageSize/tagged, page-number header/footer, 60 s timeout.
- `apps/render-worker/src/pdfa/` — `PdfArchiver` port + pdf-lib adapter:
  - version/document ID, sRGB ICC output intent, XMP part/conformance, Info consistency;
  - encryption/JS/font-embedding checks; fail PDFA_CONVERSION_FAILED;
  - all eight levels; no validator.
- `apps/render-worker/src/delivery/` — five adapters and ping behind the existing
  `ResultDelivery` port; shared `CallbackPolicy` for HTTP allowlist/DNS/SSRF.
- `apps/render-worker/src/composition-root.ts` — wire the real renderer/archiver/channels; keep
  the local Chrome adapter for preview only.
- `scripts/` — render regression fixtures/runner; load test/Power Tuning harness; smoke plain +
  PDF/A.
- `infra/bootstrap` — expand the deploy role with EC2/VPC permissions for network modes.
- `infra/modules/printer` — PDF/A env defaults restored; IAM for lambda/events/s3/http; alarms.
- `.github/workflows/ci.yml` — render regression on Ubuntu x86_64; maybe load smoke.
- `.github/workflows/release.yml` — plain + PDF/A smoke, manifest asset, rollback.

## Patterns to follow

- Hexagonal ports: `PdfRenderer`, `PdfArchiver`, `ResultDelivery`, `CallbackPolicy`.
- SOLID/DI: one composition root; browser/archiver/channel adapters replaceable in tests.
- One render use case serves the SQS adapter, smoke and preview.
- Code style/TS: strict types, runtime validation at boundaries, anchors/docblocks.
- Repository: trunk-based `main`, short-lived prompt branches.

## Deliverables

### Slice 2 — Rendering, PDF/A, channels

- `ChromiumPdfRenderer` and shared page settings; local Chrome adapter refactor.
- `PdfArchiver` + pdf-lib for all levels.
- Five channel adapters + ping; callback policy/allowlist/SSRF.
- Render regression suite and reference PDFs.
- Integration tests for channels/archiver; LocalStack where possible.

### Slice 3 — Production readiness and cloud

- Throughput target, Power Tuning, load test report.
- Alarms, runbook, DLQ redrive/template removal/rollback procedures.
- Plain + PDF/A smoke; first real template live.
- Bootstrap deploy-role VPC permissions; cloud verification (OIDC/release/rollback/branch
  protection).

## Infrastructure/API/data hypotheses

- Chromium zip external in the bundle; Lambda memory starts at 1,536 MB and is tuned.
- PDF/A env `PDFA_ALLOWED_LEVELS` returns to all levels by default.
- IAM: callback target ARNs for lambda/sqs/events; s3 PutObject for the presigned channel; HTTP
  egress via NAT/VPC when configured; worker ENI policy already conditional.
- Bootstrap deploy role gains EC2/VPC actions scoped to the project where AWS permits; otherwise
  documented.
- No database; prints remain transient; render fixtures are repo artifacts.

## Regression strategy

- Contract tests unchanged; channel-specific payload tests.
- Unit tests for renderer settings, interception, archiver metadata/checks, channels, allowlist.
- Render regression: page count, text, visual diff, plain and PDF/A, Ubuntu x86_64.
- Deployed smoke plain and PDF/A after every release/rollback.
- Load test: agreed jobs/min, document mix, p95, errors, memory.

## Versioning and release

- semantic-release continues; worker zip/manifest/reference PDFs are release artifacts.
- No contract breaking change; additive channel behavior only.
- Rollback applies an earlier release and runs both smoke jobs.

## Branch strategy

- Feature branch: **no**
- Base/integration: `main`
- Remote: `origin` configured; push/branch protection by the operator.
- Prompt branches: one disposable worktree/branch per prompt.

## Criticalities

1. Chromium packaging/version/cold start; zip and `/tmp`.
2. PDF/A conformance and honesty.
3. SSRF/allowlist security.
4. VPC/NAT/endpoint apply and cost; bootstrap deploy-role expansion.
5. Throughput target and load-test validity.
6. Cloud/remote prerequisites.
7. Scope/budget split between Slice 2 and Slice 3.
