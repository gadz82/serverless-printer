# Tour — Foundations: contracts and a deployable Printer skeleton

A 15-stop reading order. Every link and command below works from the repository root after
`pnpm install --frozen-lockfile`.

1. `packages/contracts/src/validation.ts#validateJob` — ORCHID-MEM:
   `01a1c1d8-f018-7fa1-8f4a-34775562fc02`
   - Why: the inbound contract is the public interface and the first defence against bad jobs.
   - Prove it: `pnpm --filter @printer/contracts test`
2. `packages/contracts/src/validation.ts#validateResult` — ORCHID-MEM:
   `01a1c1d8-f085-734b-9df3-a3da92ea4d6c`
   - Why: callers and the smoke test must agree on one result shape, including error codes.
   - Prove it: `pnpm --filter @printer/contracts test`
3. `packages/domain/src/application/process-print-job.ts#ProcessPrintJob` — ORCHID-MEM:
   `01a1c1d8-f0ed-7e00-b4c3-0d86a2e00678`
   - Why: one job becomes one print or one explicit failure, independent of AWS.
   - Prove it: `pnpm --filter @printer/domain test`
4. `packages/domain/src/domain/errors.ts#PrintJobError` — ORCHID-MEM:
   `01a1c1d8-f158-78ca-96a6-d1794b435d16`
   - Why: the eight public error codes and their retryability live here.
   - Prove it: `pnpm --filter @printer/domain test`
5. `apps/render-worker/src/handler.ts#handler` — ORCHID-MEM:
   `01a1c1d8-f1c0-7c6e-8a78-68b1df5d94f4`
   - Why: the Lambda entry point decides which SQS records are retried or dead-lettered.
   - Prove it: `pnpm --filter @printer/render-worker test`
6. `apps/render-worker/src/composition-root.ts#composeWorker` — ORCHID-MEM:
   `01a1c1d8-f229-78d0-8db6-dcbfec06856f`
   - Why: this is the only place where config, AWS clients, adapters and the use case meet.
   - Prove it: `pnpm --filter @printer/render-worker test`
7. `apps/render-worker/src/adapters/manifest-template-catalog.ts#ManifestTemplateCatalog` —
   ORCHID-MEM: `01a1c1d8-f365-7ef6-977c-6c5ee18cb802`
   - Why: templates are resolved from the deployed bundle, not a database.
   - Prove it: `pnpm --filter @printer/render-worker test`
8. `apps/render-worker/src/adapters/placeholder-pdf-renderer.ts#PlaceholderPdfRenderer` —
   ORCHID-MEM: `01a1c1d8-f3cf-7510-8a55-e30c74b3499a`
   - Why: the deliberate Phase 1 rendering stub; Chromium replaces it behind the port.
   - Prove it: `pnpm --filter @printer/render-worker test`
9. `apps/render-worker/src/adapters/s3-print-repository.ts#S3PrintRepository` — ORCHID-MEM:
   `01a1c1d8-f292-7843-9137-1a7992a59d52`
   - Why: prints are transient, hashed, presigned and overwritten on retry.
   - Prove it: `pnpm --filter @printer/render-worker test`
10. `apps/render-worker/src/adapters/sqs-result-delivery.ts#SqsResultDelivery` — ORCHID-MEM:
    `01a1c1d8-f2fd-74ad-98df-82f314ec4228`
    - Why: SQS is the only Phase 1 callback; FIFO identifiers make retries safe.
    - Prove it: `pnpm --filter @printer/render-worker test`
11. `apps/render-worker/src/adapters/uuid-print-id-generator.ts#UuidPrintIdGenerator` —
    ORCHID-MEM: `01a1c1d8-f43a-7c14-886e-0e99b8f3511c`
    - Why: the deterministic print id is the caller's deduplication key.
    - Prove it: `pnpm --filter @printer/render-worker test`
12. `scripts/template-manifest.mjs#buildManifest` — ORCHID-MEM:
    `01a1c1d8-f4a3-73ce-8036-12b8b6325602`
    - Why: the manifest is the bundle's source of truth for identities and content hashes.
    - Prove it: `pnpm vitest run scripts/template-manifest.test.mjs`
13. `infra/modules/printer/lambda.tf` — the worker package, `live` alias and event source mapping.
    - Why: this is how the worker becomes a deployed, replaceable version.
    - Prove it: `terraform -chdir=infra init -backend=false -input=false && terraform -chdir=infra validate`
14. `.github/workflows/release.yml` — semantic-release, OIDC upload/apply, smoke and rollback.
    - Why: the release path is the only way code reaches the single deployment.
    - Prove it: `pnpm build:worker` (the deployed path needs repository variables and AWS).
15. `docker-compose.yml` and `tests/integration` — the local reproduction of the same path.
    - Why: developers can prove the queue → worker → S3 → SQS callback path without AWS.
    - Prove it: `docker compose up -d localstack && pnpm local:setup && pnpm test:integration`

## Suggested path

- Start at the contracts (stops 1–2) and follow a job into `ProcessPrintJob` (stop 3).
- Read the handler and composition root (stops 5–6) to see the adapter boundary.
- Follow template resolution, rendering, storage and delivery (stops 7–11).
- End at the build manifest, infrastructure and release path (stops 12–15).
- Failure paths live in `packages/domain/test/process-print-job.test.ts` and
  `apps/render-worker/test/handler.test.ts`;
  the release and rollback story is in the logic review, the HANDOVER document and ADR-003.
