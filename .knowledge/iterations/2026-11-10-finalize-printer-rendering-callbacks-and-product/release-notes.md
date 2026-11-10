# Release notes — final rendering, callbacks and production readiness

## Shipped

- **Real Lambda rendering:** `ChromiumPdfRenderer` with `@sparticuz/chromium`/`puppeteer-core`
  pinned to Chromium 153, one launch per instance, a page per job, JavaScript disabled,
  bundled-file/data-only request interception, a 50 s deadline below the 60 s timeout, bounded
  cleanup and crash/target-closed relaunch with one retry.
- **Template bridge:** `TemplatePdfRenderer` resolves the manifest bundle, compiles Handlebars with
  the configured mode and renders through the shared Chromium adapter; the local preview keeps the
  installed-Chrome adapter and shared page settings.
- **PDF/A:** `PdfLibPdfArchiver` supports all eight levels (`1b/1a`, `2b/2u/2a`, `3b/3u/3a`) with
  version/document ID, UTF-8 XMP, sRGB ICC output intent, consistent Info/CreatorTool and
  encryption/JavaScript/unembedded-font safety checks. Conformance remains best effort; no
  validator is run.
- **All five result channels and ping:** HTTP (print-id header, 5 s timeout, 2xx), Lambda
  Invoke, SQS FIFO, EventBridge PutEvents and S3 PDF PUT. Callback allowlist + DNS/link-local/
  metadata SSRF policy, pinned addresses, no redirects; S3 uploads PDF bytes and omits printing
  fields. Invalid-message failure webhooks support HTTP/Lambda/SQS/EventBridge.
- **Roles and infrastructure:** generated or provided caller and worker roles, role separation,
  provided-worker same-account/trust validation, bootstrap `additional_worker_role_arns`
  PassRole/GetRole, EC2/VPC permissions, cross-account caller trust, all eight PDF/A levels by
  default, configurable worker memory and opt-in alarms.
- **Operations:** `docs/runbook.md` (rollback, DLQ redrive, template removal, KMS/state recovery,
  alarms, roles, VPC) and `docs/cloud-verification.md` (first deploy, branch protection, smoke,
  rollback, alarms, capacity evidence).
- **Quality and release:** plain + PDF/A render regression with committed references and CI job;
  Chromium packaging with the full 19-package runtime closure and zip assertions; plain + PDF/A
  release smoke with SQS success/failure callbacks; load-test/Power Tuning harness; 30 memory
  anchors/docblocks.

## Verification

- 614 unit/contract/integration-excluded tests pass.
- Linux x86_64 render regression: 10/10, including plain/PDF-A reference equality and the
  deliberate template-change failure.
- `pnpm build:worker`: 73,645,853-byte zip, 331 entries, 19 Chromium runtime packages, 83.6 MB
  unzipped.
- Terraform root and bootstrap fmt/validate/tflint pass; role-mode and VPC plans were exercised
  during build.
- `orchid-sdd lint`: 30 anchors/30 docblocks, 0 errors; index projection current.
- LocalStack integration remains 6/6; the S3 channel is unit-tested because LocalStack presigns
  HTTP.

## Upgrade notes

- Re-apply `infra/bootstrap` before the first main apply: it adds the generated caller role,
  EC2/VPC permissions and, for provided worker roles, `iam:PassRole`/`iam:GetRole`.
- Set the provided worker ARN in bootstrap `additional_worker_role_arns` and re-apply bootstrap
  before switching `worker_role_mode = "existing"`.
- Keep `PDF/A-2b` in `pdfa_allowed_levels`; the release smoke requests it (defaults include it).
- Optional: set `worker_memory_size` from Power Tuning and the queue-consumer values from the load
  test; apply them through the GitHub `TF_VARS` variable, not only a local tfvars file.
- The release artifact is ~74 MB zipped and must be uploaded to S3; it exceeds the 50 MB direct
  Lambda upload limit.

## Known limitations and follow-ups

- **Live cloud verification is pending:** first apply, plain/PDF-A smoke, rollback, branch
  protection/release-bot bypass and SNS alarm test are operator actions in
  `docs/cloud-verification.md`.
- **Throughput target is a candidate:** 10 20-page jobs/min with p95 < 30 s must be confirmed or
  revised with the first load/Power Tuning run.
- **PDF/A is best effort:** no validator; part-1/a transparency/accessibility edge cases remain
  best-effort.
- **Packaging is release-time validated:** `ci.yml` does not run `build:worker`; the release job
  catches packaging regressions.
- No production data migration is required; prints remain transient in S3.
