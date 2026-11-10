# PRD — Finalize Printer rendering, callbacks and production readiness

- Iteration: `2026-11-10-finalize-printer-rendering-callbacks-and-product`
- Technical only: no
- Source: `SPEC.md` v0.4 remaining Phases 3–4, plus the first cloud verification and the VPC
  deploy-permission follow-up

## Problem

Slice 1 delivered templates, local preview and the optional network module. The service still
cannot do the real job: the Lambda renderer is a placeholder, PDF/A is rejected, only the SQS
result channel exists, there is no render regression or load evidence, no production alarms or
runbook, and no first cloud verification. The spec's Phase 3–4 requirements remain open.

This iteration closes them: production Chromium rendering, PDF/A, all five callbacks, render
regression, capacity evidence, operations and the first deployed real-template release.

## Users and personas

- **Caller teams** — send real templates and receive production PDFs through their chosen channel.
- **Template maintainers** — rely on render regression to protect visual output.
- **Operators** — deploy, monitor, roll back, redrive DLQ messages and run the service.
- **Developers** — extend rendering/channels with a reliable local and CI path.

## Current behaviour

- `PdfRenderer` is a deterministic placeholder; payload/template content are ignored.
- PDF/A requests fail with `PDFA_LEVEL_NOT_ALLOWED`.
- Only `sqs` delivery exists; `http`, `lambda`, `eventBridge`, `s3` and ping are missing.
- No render regression, load test, alarms or runbook.
- No AWS deploy/OIDC/rollback/CI has run; VPC apply needs bootstrap EC2 permissions.

## Desired outcome

A callable production service: a caller sends the real `generic-report` template (or another
repo template) and receives a Chromium-rendered PDF, optionally PDF/A, through any documented
channel, with ping, security checks and the documented failure handling. CI protects rendering and
contracts; operations have alarms and a runbook; the first release is deployed and verified in AWS,
including rollback and, if selected, VPC modes.

## Flows

### Rendering flow

1. Worker validates and resolves the template.
2. Chromium renders the compiled HTML with JavaScript disabled and external requests blocked.
3. If requested, pdf-lib post-processes the PDF to the requested PDF/A level.
4. The worker stores the PDF unless the success channel is `s3`.
5. The result is delivered on the chosen channel, then the ping is sent.

### Template fidelity flow

1. CI renders reference templates plain and as PDF/A.
2. Page count, extracted text and appearance are compared with references.
3. A visual regression fails the pull request.

### Operations and cloud flow

1. Bootstrap is applied; repository variables are set; branch protection is enabled.
2. A push to `main` cuts a release, builds/uploads the Chromium worker, applies Terraform via OIDC.
3. Plain and PDF/A smoke jobs pass; the manifest is attached.
4. Alarms and the runbook cover DLQ, errors, rollback, template removal and recovery.
5. Rollback dispatches an earlier release and re-runs both smoke jobs.
6. Optional VPC modes can be applied through the deploy role after the bootstrap policy expansion.

## Business rules

- One message, one print; the queue is the only entry point.
- Templates are static repo folders; no versions/statuses/upload.
- Handlebars modes/helpers from Slice 1 remain.
- Rendering is isolated: JS off, external network blocked, fixed helpers, escaping on.
- PDF/A is best effort; no validator in CI/production.
- Prints expire after one day; dedupe by `printId`; refId echoed.
- Callbacks are restricted by the allowlist and `callback_target_arns`; DNS/SSRF checks apply.
- Ping after channel delivery.
- No static AWS credentials; OIDC only.

## Success metrics

- `generic-report` renders through production Chromium plain and as PDF/A-2b; the deployed result
  matches the reference content.
- All five channels and ping pass end-to-end with and without PDF/A.
- Render regression runs in CI on Ubuntu/x86_64 for plain and PDF/A references.
- The confirmed throughput target is met by the load test; Power Tuning records memory/cost.
- Alarms and the runbook are complete; plain and PDF/A smoke pass after deploy.
- Rollback to an earlier release passes both smoke jobs.
- Bootstrap/OIDC/branch protection are verified; VPC modes apply through the deploy role.
- No static keys; least-privilege IAM covers channels/network.

## Non-goals

- Template editor/UI/API, runtime upload, template versions/statuses, environments, database.
- Third-party monitoring, PDF/A validation, a human-facing endpoint.
- Any change to the one-deployment/one-queue architecture.

## Assumptions and risks

- **AWS/remote:** the operator supplies the account/region, repository variables, bootstrap apply
  and branch protection.
- **Chromium:** package/version alignment, zip size and cold start are the main technical risks.
- **PDF/A:** conformance is best effort; part-1/`a` may be limited.
- **Throughput:** the candidate target must be confirmed before the load test.
- **VPC:** bootstrap deploy-role EC2 permission expansion is part of this iteration.
- **Scope:** Slices 2+3 are large; the plan may split Slice 3 into a follow-up if the budget is
  exceeded.

## Open questions

- Confirm the throughput target (candidate: 10 jobs/min peak, 20-page documents, p95 < 30 s).
- Confirm AWS account/region, VPC mode and network inputs for cloud verification.
- Confirm the alarm SNS topic and callback allowlist/targets.

These are assessment/operator inputs, not blockers for the intent gate.
