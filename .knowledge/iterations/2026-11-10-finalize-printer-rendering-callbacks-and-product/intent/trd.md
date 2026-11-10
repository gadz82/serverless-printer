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
- **Role ownership:** two independent roles, each `create` (default) or `existing`:
  - **caller/integrator role** — `sqs:SendMessage` on the jobs queue only; generated and output,
    or a provided ARN added to the queue's allowed senders;
  - **worker execution role** — consume jobs, store prints, publish to `callback_target_arns`;
    generated or a provided same-account ARN that trusts `lambda.amazonaws.com` and is passable by
    the deploy role.
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
  **two role modes**:
  - **caller/integrator role:** `caller_role_mode = "create" | "existing"` default `create`;
    `caller_role_arn` for `existing`; generated role trusts `caller_trusted_principal_arns` (or the
    deployer account root by default) and can only `sqs:SendMessage` to the jobs queue; the
    resolved ARN is added to the queue policy and output as `caller_role_arn`;
  - **worker execution role:** `worker_role_mode = "create" | "existing"` default `create`;
    `worker_role_arn` for `existing`; same-account and `lambda.amazonaws.com` trust; conditional
    role/policy; resolved ARN feeds Lambda, KMS and the smoke queue; provided roles are not
    modified.
- `infra/bootstrap` — `additional_worker_role_arns` added to the deploy role's `iam:PassRole`
  resources so a provided worker role can be attached to Lambda.
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
- Worker and caller role modes (generated/provided), bootstrap `iam:PassRole` support and the
  generated caller role output.

## Infrastructure/API/data hypotheses

- Chromium zip external in the bundle; Lambda memory starts at 1,536 MB and is tuned.
- PDF/A env `PDFA_ALLOWED_LEVELS` returns to all levels by default.
- IAM: callback target ARNs for lambda/sqs/events; s3 PutObject for the presigned channel; HTTP
  egress via NAT/VPC when configured; worker ENI policy already conditional.
- Bootstrap deploy role gains EC2/VPC actions scoped to the project where AWS permits; otherwise
  documented. It also gains PassRole for provided worker role ARNs.
- Both role modes are Terraform-level only. `create` keeps least-privilege caller/worker roles;
  `existing` resolves ARNs and skips IAM creation/modification. The caller role only sends to the
  jobs queue; the worker role only publishes to delivery channels.
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
8. Role ownership: provided caller/worker roles are outside least-privilege control; the worker
   role must be same-account and trust `lambda.amazonaws.com`; bootstrap PassRole must include a
   provided worker ARN. Caller and worker roles must remain separate.

## Role ownership evaluation

### Interpretation

The requirement covers two distinct IAM roles:

1. **Caller/integrator role** — allows an external application to publish new prints with
   `sqs:SendMessage` on the jobs queue. Terraform either creates and outputs this role, or accepts
   a provided ARN and adds it to the queue's allowed senders. The caller may be in the same or a
   different account; the trust policy names the caller principals.
2. **Worker execution role** — allows the Lambda to consume the jobs queue and publish results to
   the specific delivery channels in `callback_target_arns` (SQS, Lambda, EventBridge and the
   presigned S3 flow). Terraform either creates it or uses a provided same-account ARN that
   trusts `lambda.amazonaws.com`. A provided worker role must be passable by the deploy role.

They must stay separate: a shared role would let callers publish results and the worker enqueue
jobs, violating least privilege. The caller role does not get delivery-channel permissions; the
worker role does not get jobs-queue send permission.

### Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Both roles generated (default) | Low | Low | High | Least privilege, self-contained stack |
| Caller provided, worker generated | Low | Medium (caller-owned permissions/trust) | High | Reuses integrator IAM |
| Caller generated, worker provided | Low | Medium (worker-owned trust/permissions) | High | Reuses a central Lambda role |
| Both provided | Low | Medium/High (both outside least-privilege control) | High | Maximum IAM governance reuse |

### Decision

- `caller_role_mode = "create" | "existing"`, default `create`.
  - `create`: Terraform creates a role with `sqs:SendMessage` only on the jobs queue and a trust
    policy for `caller_trusted_principal_arns` (default: the deployer account root). The ARN is
    output as `caller_role_arn`.
  - `existing`: `caller_role_arn` is required; Terraform adds that ARN to the jobs queue policy
    and does not create or modify any IAM role/policy.
- `worker_role_mode = "create" | "existing"`, default `create`.
  - `create`: Terraform creates the least-privilege worker role/policy and trust.
  - `existing`: `worker_role_arn` is required, same-account, trusts `lambda.amazonaws.com`; the
    stack does not create or modify IAM and uses the ARN for Lambda, KMS and the smoke queue.
- Bootstrap gains `additional_worker_role_arns` for `iam:PassRole`; the caller role needs no
  PassRole because it is assumed by the integrator, not Lambda.

### Trade-offs

- **Generated:** least privilege and reproducible; Terraform owns trust/policy/drift.
- **Provided caller:** central integrator IAM; the stack cannot guarantee the role's policy or
  trust, but it only grants queue access.
- **Provided worker:** central Lambda-role governance; the stack cannot guarantee least privilege
  or trust, and bootstrap PassRole must include the ARN.
- **Cross-account:** allowed for the caller role via its trust principal; **not** allowed for the
  worker role because Lambda needs a same-account execution role.
- **Delivery channels:** the integrator supplies `callback_target_arns`; the generated worker
  policy scopes SQS send/Lambda invoke/EventBridge publish to those ARNs. The S3 channel uses a
  caller-supplied presigned URL, so no worker S3 permission on the destination bucket is required.
- **Existing-role drift:** documented owner responsibility; a future check can verify trust and
  permissions if `iam:GetRole` is available.

### Variables and outputs

- `caller_role_mode`, `caller_role_arn`, `caller_trusted_principal_arns`
- `worker_role_mode`, `worker_role_arn`
- Outputs: `caller_role_arn`, `worker_role_arn`, `caller_role_created`, `worker_role_created`


