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
- **Worker role ownership:** Terraform supports `worker_role_mode = "create"` (default) or
  `"existing"` with a same-account `worker_role_arn`. In existing mode the stack creates/modifies
  no IAM role or policy; the bootstrap deploy role must be allowed to pass the provided ARN.
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
- `infra/modules/printer` — PDF/A env defaults restored; IAM for lambda/events/s3/http; alarms;
  **worker role mode**:
  - `worker_role_mode = "create" | "existing"` default `create`;
  - `worker_role_arn` required for `existing`, forbidden for `create`;
  - existing ARN must be same-account and trust `lambda.amazonaws.com`;
  - conditional role/policy resources; resolved ARN feeds Lambda, the KMS key policy, the smoke
    queue policy and outputs;
  - the provided role is not modified; its owner supplies the equivalent permissions.
- `infra/bootstrap` — `additional_worker_role_arns` (or equivalent) added to the deploy role's
  `iam:PassRole` resources, so a provided role can be attached to Lambda.
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
- Worker role mode (generated/provided) and bootstrap `iam:PassRole` support.

## Infrastructure/API/data hypotheses

- Chromium zip external in the bundle; Lambda memory starts at 1,536 MB and is tuned.
- PDF/A env `PDFA_ALLOWED_LEVELS` returns to all levels by default.
- IAM: callback target ARNs for lambda/sqs/events; s3 PutObject for the presigned channel; HTTP
  egress via NAT/VPC when configured; worker ENI policy already conditional.
- Bootstrap deploy role gains EC2/VPC actions scoped to the project where AWS permits; otherwise
  documented. It also gains PassRole for provided worker role ARNs.
- The worker role mode is Terraform-level only: `create` keeps today's least-privilege role;
  `existing` resolves an ARN and skips all IAM creation/modification. Same-account only.
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
8. Role ownership: provided roles are outside least-privilege control; same-account and
   `lambda.amazonaws.com` trust are mandatory; bootstrap PassRole must include the ARN.

## Role ownership evaluation

### Interpretation

This is implemented for the **worker execution role** (the role Lambda assumes to consume the jobs
queue and publish results to delivery channels). The generated role is the current least-privilege
policy plus the Slice 2 channel permissions. A provided role must be a same-account IAM role with
an equivalent policy and a trust policy for `lambda.amazonaws.com`.

If the intended requirement is a **caller role** (an external application that publishes jobs to
the queue and reads delivery queues), that is a separate IAM artifact and should be stated
explicitly; the current queue `allowed_sender_*` inputs already model caller authorization.

### Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| `worker_role_mode = "create"` default (chosen) | Low | Low | High | Least privilege, self-contained stack |
| `worker_role_mode = "existing"` + same-account ARN | Low | Medium (deployer-owned permissions/trust) | High | Reuses central roles, may be over-privileged |
| Boolean `create_worker_role` | Low | Low | High | Simpler but less explicit than a mode |
| Implicit nullable ARN (`null` = create) | Low | Low | High | Concise but easy to misread |

### Decision

Use `worker_role_mode` (`create` default, `existing`) plus `worker_role_arn`. Validate the ARN is
same-account; reject it in `create` mode. Conditionalize the role/policy and feed the resolved ARN
to Lambda, KMS and the smoke queue. Add `additional_worker_role_arns` to bootstrap's `iam:PassRole`
so a provided role can be attached. The stack never modifies a provided role; the operator owns its
trust policy and permissions.

### Trade-offs

- **Generated:** least privilege and reproducible; the stack owns rotation/drift.
- **Provided:** central IAM governance and reuse; the stack cannot guarantee least privilege or
  trust correctness, and bootstrap PassRole must be updated for the ARN.
- **Cross-account:** not supported by Lambda execution roles; reject at validation.
- **Existing-role policy drift:** a documented owner responsibility; optionally a future `check`
  block can verify trust/permissions if `iam:GetRole` is available.

