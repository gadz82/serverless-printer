# TRD — Complete the Printer service

- Iteration: `2026-11-10-complete-the-printer-service-with-templates-rend`
- Constitution: `.orchid/constitution/constitution.md`
- Source: `SPEC.md` v0.4, remaining kickoff phases 2–4 plus cloud verification
- This is a hypothesis; Phase 3 assessment validates it.

## Constraints

- **Runtime:** Node.js 24 on Lambda, `x86_64`; Chromium via `puppeteer-core` +
  `@sparticuz/chromium`, pinned to the same Chromium major and a release supporting Node 24.
- **Tooling:** pnpm workspace, TypeScript strict, Vitest, esbuild, Terraform ≥ 1.11, AWS
  provider `~> 6.0`, semantic-release, Conventional Commits.
- **Deployment:** one AWS deployment, no environments, no database, no API/UI. The jobs queue is
  the only entry point.
- **Delivery:** staged as templates/network → rendering/channels → production readiness/cloud
  verification. The plan may split into follow-up iterations at G4 if the budget is exceeded.
- **PDF/A:** best effort, no validator; part-1 and `a` levels may be limited by Chromium output.
- **Security:** JavaScript disabled, request interception, fixed Handlebars helpers, allowlist
  plus DNS/SSRF checks, scoped callback IAM, no static AWS keys.
- **Budget:** this is a large increment; the planning estimate must be checked against the
  250k warning / 600k stop thresholds, and a split is the expected mitigation if needed.

## Architecture direction

- `packages/template-engine` — new package containing:
  - Handlebars compilation with `lenient`, `strict` and `assume-objects` modes;
  - fixed helpers (`eq`, `formatCurrency`, `formatDate`) and prototype-access disabled;
  - placeholder-schema extraction from the Handlebars AST (`each`, `if`/`unless`, `with`,
    dotted paths);
  - deterministic content hashing and manifest construction used by the worker and CLI.
- `apps/render-worker` — add:
  - `ChromiumPdfRenderer` behind the existing `PdfRenderer` port;
  - `PdfLibArchiver` behind a new `PdfArchiver` port for all eight PDF/A levels;
  - `http`, `lambda`, `eventBridge` and `s3` result-delivery adapters next to the existing SQS
    adapter, plus ping delivery;
  - callback allowlist and DNS/SSRF validation at the HTTP edge;
  - browser reuse, request interception, page settings and crash recovery.
- `scripts/` — complete the CLI: `template:new`, `validate`, `check`, `preview`, `manifest`;
  they call `packages/template-engine`, not a second implementation.
- `templates/generic-report` — a real self-contained generic business report with fonts/assets/sample data;
  `_smoke` remains the release smoke identity.
- `infra/modules/network` — optional VPC create/lookup, private subnets, optional NAT, S3 gateway
  endpoint and SQS/Lambda/Events interface endpoints; printer module gains VPC config.
- `infra/modules/printer` — VPC wiring, optional EventBridge ingress rule, alarms and the
  callback target/IAM extensions for the new channels.
- CI — render regression on Ubuntu/x86_64, template validation/check, load smoke where practical.
- Release workflow — plain and PDF/A smoke jobs, manifest asset, rollback.

## Patterns to follow

- Hexagonal boundaries: template engine and domain stay free of AWS/Chromium/pdf-lib; adapters
  own I/O and binaries.
- SOLID: consumer-shaped ports (`PdfArchiver`, channel delivery, allowlist resolver); no
  speculative abstraction.
- Dependency inversion: one composition root; browser and archiver injected at the edge.
- One render use case serves the SQS adapter, the release smoke and `template:preview`.
- `code-style`/`code-style-typescript`: strict types, runtime validation at untrusted boundaries,
  anchors/docblocks for significant units.
- Repository flow: trunk-based `main`, short-lived prompt worktrees integrated and deleted.

## Deliverables

### Slice 1 — Templates and network

- `packages/template-engine` with modes, helpers, placeholder AST, hashing and manifest.
- Complete `template:*` CLI, `generic-report` template, validation/check/preview tests.
- Manifest release integration and `_smoke` regression.
- `modules/network` plus `vpc_mode` create/lookup wiring and tests.

### Slice 2 — Rendering and delivery

- Chromium renderer, PDF/A archiver and their unit/integration tests.
- All five result channels, ping, allowlist/SSRF enforcement and IAM extensions.
- Render regression suite with reference PDFs, plain and PDF/A.
- PDF/A level matrix and failure paths.

### Slice 3 — Production readiness and cloud verification

- Power Tuning and load test against the agreed throughput target.
- Opt-in alarms, runbook, DLQ redrive and template-removal procedure.
- Plain and PDF/A smoke jobs, first real template live, bootstrap/OIDC deploy, rollback.
- Branch protection/release-bot bypass and the first cloud evidence.

## Infrastructure/API/data hypotheses

- **Network:** default `none` remains; `create` and `lookup` modes add private subnets, optional
  NAT, S3 gateway endpoint and SQS/Lambda/Events interface endpoints. The worker gets VPC config
  only when a VPC is selected.
- **EventBridge ingress:** optional `job_rule = { bus_name, event_pattern }` adds a rule and queue
  policy principal.
- **Callbacks:** `http` with 5 s timeout and `X-Printer-Print-Id`; `lambda` Invoke Event; SQS with
  existing FIFO rules; EventBridge PutEvents with `EVENT_SOURCE` and detail types; S3 presigned PUT.
  Ping after delivery.
- **Data:** no database; prints remain transient in S3 with one-day expiry. PDF/A adds only
  in-memory post-processing.
- **Capacity:** start at 1,536 MB, tune with Lambda Power Tuning on 1-page and 20-page documents
  with/without PDF/A; set reserved/maximum concurrency from the load test.
- **Confidence:** high for the template engine and channel logic; medium for Chromium packaging,
  PDF/A conformance and VPC apply-time behaviour.

## Regression strategy

- Contract tests unchanged; any contract change is additive or major with an ADR.
- Unit tests for template modes/helpers/placeholder extraction, archiver, each channel, allowlist,
  SSRF and ping.
- LocalStack integration for SQS/S3/Lambda/EventBridge where supported; fakes for HTTP.
- Render regression in CI: page count, extracted text and visual comparison against references,
  plain and PDF/A.
- Deployed smoke: plain and PDF/A `_smoke` jobs after every release and rollback.
- Load test: agreed jobs/min, document mix, p95 latency, memory and error rate.

## Versioning and release

- Semantic-release continues to derive SemVer from Conventional Commits; no npm publish.
- The worker zip, manifest and reference PDFs are build/release artifacts.
- A contract change requires a major version and an ADR; template changes are content changes
  reported through `contentHash`, not versions.
- Rollback applies an earlier release artifact and re-runs both smoke jobs.

## Branch strategy

- Feature branch: **no**
- Base branch: `main`
- Integration target: `main`
- Remote: `origin` is configured to `git@github.com:gadz82/serverless-printer.git`; no push yet.
- Prompt branches: one disposable worktree/branch per prompt, merged to `main`, then deleted.
- Branch protection and the release-bot bypass are operator setup before the first PR-based
  release.

## Criticalities

1. **Iteration size:** the remaining spec is roughly three phases; the G4 plan must estimate the
   cost and may split into follow-up iterations while preserving the slices.
2. **Chromium packaging:** version alignment, Lambda zip size, cold start and `/tmp` use.
3. **PDF/A fidelity:** Chromium output may not satisfy part-1/`a` constraints; conformance is best
   effort and must be documented.
4. **Callback security:** HTTP allowlist, DNS rebinding and link-local/metadata blocking are
   security-critical.
5. **Network complexity:** VPC modes, endpoints and NAT can add cost and apply-time risk.
6. **Throughput target:** undefined in the spec; it must be agreed before load testing.
7. **Cloud verification:** remote, AWS account, bootstrap, repository variables and branch
   protection remain operator prerequisites.
