# Tour — final rendering, callbacks and production readiness

A 15-stop reading order. Commands run from the repository root after
`pnpm install --frozen-lockfile`.

1. `apps/render-worker/src/rendering/chromium-pdf-renderer.ts#ChromiumPdfRenderer` — ORCHID-MEM:
   `01a1c6e2-7376-7a46-9c7f-aa22f4bdecae`
   - Why: the Lambda browser lifecycle, 50 s deadline, request policy and crash recovery.
   - Prove: `pnpm --filter @printer/render-worker test`
2. `apps/render-worker/src/rendering/template-pdf-renderer.ts#TemplatePdfRenderer` — ORCHID-MEM:
   `01a1c6e2-748b-7a7d-be61-8728b67b41e8`
   - Why: turns a manifest template and payload into compiled HTML and a Chromium render.
   - Prove: `pnpm --filter @printer/render-worker test`
3. `apps/render-worker/src/pdfa/pdf-lib-pdf-archiver.ts#PdfLibPdfArchiver` — ORCHID-MEM:
   `01a1c6e2-73a4-7f26-9d3e-6b36fad2f5d1`
   - Why: all eight PDF/A levels, XMP/ICC metadata and unsafe-PDF rejection.
   - Prove: `pnpm --filter @printer/render-worker test`
4. `apps/render-worker/src/security/callback-policy.ts#CallbackPolicy` — ORCHID-MEM:
   `01a1c6e2-73d3-750f-a5bd-47127cb77c34`
   - Why: allowlist and DNS/link-local/metadata checks before any callback request.
   - Prove: `pnpm --filter @printer/render-worker test`
5. `apps/render-worker/src/delivery/http-request.ts#pinnedHttpRequest` — ORCHID-MEM:
   `01a1c6e2-7400-7d2c-9d53-5ee417119bae`
   - Why: pins the validated address so DNS cannot rebind between validation and connect.
   - Prove: `pnpm --filter @printer/render-worker test`
6. `apps/render-worker/src/delivery/result-delivery-router.ts#ResultDeliveryRouter` — ORCHID-MEM:
   `01a1c6e2-742e-7487-90c5-d6432db771cf`
   - Why: one place that dispatches HTTP, Lambda, SQS, EventBridge, S3 and ping.
   - Prove: `pnpm --filter @printer/render-worker test`
7. `apps/render-worker/src/delivery/s3-pdf-destination.ts#S3PdfDestination` — ORCHID-MEM:
   `01a1c6e2-745c-7060-92ae-5484fc16ea61`
   - Why: the s3 channel uploads PDF bytes, not the JSON result, with its own SSRF guard.
   - Prove: `pnpm --filter @printer/render-worker test`
8. `apps/render-worker/src/composition-root.ts#composeWorker` — ORCHID-MEM:
   `01a1c1d8-f229-78d0-8db6-dcbfec06856f`
   - Why: the only wiring point; selects local Chrome outside Lambda and Chromium inside.
   - Prove: `pnpm --filter @printer/render-worker test`
9. `packages/domain/src/application/process-print-job.ts#ProcessPrintJob` — ORCHID-MEM:
   `01a1c1d8-f0ed-7e00-b4c3-0d86a2e00678`
   - Why: PDF/A archiving, S3 delivery, retries and failure delivery stay in the use case.
   - Prove: `pnpm --filter @printer/domain test`
10. `scripts/build-worker.mjs` — ORCHID-MEM: `01a1c6e2-74b9-7f7c-b83b-72a18dc313da`
    - Why: externalizes Chromium, copies the 19-package closure and asserts the zip.
    - Prove: `pnpm build:worker`
11. `scripts/smoke-test.mjs#run` — ORCHID-MEM: `01a1c6e2-74e6-7a60-b670-ffe141c7f55d`
    - Why: the release gate sends both plain and PDF/A jobs and validates the callbacks.
    - Prove: `pnpm smoke:test` after a deploy
12. `scripts/render-regression.mjs#runRenderRegression` — ORCHID-MEM:
    `01a1c6e2-7513-71d9-ae96-e93bc181897d`
    - Why: compares real Chromium output with committed plain/PDF-A references.
    - Prove: `RENDER_REGRESSION_REQUIRED=1 pnpm test:render`
13. `scripts/load-test.mjs#run` — ORCHID-MEM: `01a1c6e2-7540-7c8e-8bd5-cea84775b708`
    - Why: the 1/20-page plain/PDF-A matrix, p95, memory and Power Tuning event.
    - Prove: `node scripts/load-test.mjs --print-event 20-page-pdfa`
14. `infra/modules/printer/iam.tf` and `infra/modules/printer/lambda.tf` — role modes, channel IAM,
    worker memory and the Lambda alias.
    - Why: generated/provided roles and the production runtime shape.
    - Prove: `terraform -chdir=infra init -backend=false -input=false && terraform -chdir=infra validate`
15. `docs/cloud-verification.md` and `docs/runbook.md` — the first-deploy, smoke, rollback, alarm
    and incident path.
    - Why: the remaining work is operator evidence, not code.
    - Prove: follow the checklist; do not paste secrets.

## Suggested path

Start with the renderer and bridge (1–2), then PDF/A (3), the callback security/delivery path (4–7),
the wiring/use case (8–9), the release and evidence tools (10–13), infrastructure (14), and the
operator docs (15). Failure-path tests live next to each adapter; the render references and smoke
matrix are the end-to-end evidence.
