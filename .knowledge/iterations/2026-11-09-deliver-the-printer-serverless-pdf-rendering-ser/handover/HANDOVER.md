# Handover — Foundations: contracts and a deployable Printer skeleton

- Iteration: `2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser`
- Status: closed; G8 handover review
- Source specification: `SPEC.md` v0.4, kickoff Phase 0–1

## What changed and why

The repository now contains a complete Phase 1 foundation for the Printer service: versioned job
and result contracts, a framework-free print use case, an SQS/Lambda worker with a deterministic
placeholder renderer, transient S3 storage, SQS result delivery, Terraform bootstrap and printer
modules, a LocalStack development path, and pull-request/release workflows.

The goal of this increment was to prove the real queue → worker → storage → callback path and the
release mechanics before adding production rendering. It deliberately does **not** render real
HTML/Handlebars templates, does **not** produce PDF/A, and does **not** implement the HTTP,
Lambda, EventBridge or S3 result channels. Those are the next increments.

## Architecture delta

- `packages/contracts` — JSON Schema 2020-12 job/result contracts, Ajv 2020 validation and
  generated TypeScript types.
- `packages/domain` — entities, the eight-code error taxonomy, ports and the `ProcessPrintJob`
  use case; no AWS, filesystem, HTTP or Chromium imports.
- `apps/render-worker` — Lambda handler, composition root, config, manifest catalog, placeholder
  PDF renderer, S3 print repository, SQS result delivery and UUIDv5 print ids.
- `templates/_smoke` — the one real template identity used by the release smoke.
- `scripts/` — manifest generation, worker bundling, smoke scripts, LocalStack setup/runner/sink.
- `infra/bootstrap` — state/artifacts buckets, GitHub OIDC provider, deploy and plan roles.
- `infra/modules/printer` + root — queue/DLQ, smoke queue, prints bucket, KMS key, worker Lambda,
  alias, event source mapping, IAM, logs and optional alarms.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` — PR gates and the semantic-release deploy/rollback
  path.
- `docker-compose.yml` + `tests/integration` — LocalStack SQS/S3 and the end-to-end local smoke.

## Decisions and rejected alternatives

- **ADR-001** — JSON Schema 2020-12 is the contract source of truth; Ajv validates and TypeScript
  types are generated. Rejected TypeBox/Zod and hand-written types.
- **ADR-002** — minimal dependency baseline: AWS SDK v3, Ajv, uuid, pnpm, Vitest, esbuild,
  semantic-release. Rejected frameworks and hand-rolled AWS signing.
- **ADR-003** — Phase 1 uses a dependency-free placeholder PDF and SQS-only delivery; PDF/A
  requests are rejected with `PDFA_LEVEL_NOT_ALLOWED`. Rejected Chromium now, pdf-lib now, and
  narrowing the public contract.
- **ADR-004** — bootstrap uses local state once; the main deployment uses the S3 backend with
  native locking. Rejected a second pre-created state bucket and Terraform Cloud.
- **ADR-005** — minimal `_smoke` template and manifest script prove resolution now; full template
  tooling arrives in Phase 2.
- **ADR-006** — `_smoke` is the single reserved internal slug, exempt from the public slug
  pattern; all other leading underscores are rejected.

## Reading order

1. `packages/contracts/src/validation.ts#validateJob` — ORCHID-MEM:
   `01a1c1d8-f018-7fa1-8f4a-34775562fc02` — the inbound contract boundary — `pnpm --filter
   @printer/contracts test`
2. `packages/contracts/src/validation.ts#validateResult` — ORCHID-MEM:
   `01a1c1d8-f085-734b-9df3-a3da92ea4d6c` — the outbound contract boundary — `pnpm --filter
   @printer/contracts test`
3. `packages/domain/src/application/process-print-job.ts#ProcessPrintJob` — ORCHID-MEM:
   `01a1c1d8-f0ed-7e00-b4c3-0d86a2e00678` — the core one-job/one-print orchestration —
   `pnpm --filter @printer/domain test`
4. `packages/domain/src/domain/errors.ts#PrintJobError` — ORCHID-MEM:
   `01a1c1d8-f158-78ca-96a6-d1794b435d16` — the public error/retryability taxonomy —
   `pnpm --filter @printer/domain test`
5. `apps/render-worker/src/handler.ts#handler` — ORCHID-MEM:
   `01a1c1d8-f1c0-7c6e-8a78-68b1df5d94f4` — Lambda entry point and batch failure reporting —
   `pnpm --filter @printer/render-worker test`
6. `apps/render-worker/src/composition-root.ts#composeWorker` — ORCHID-MEM:
   `01a1c1d8-f229-78d0-8db6-dcbfec06856f` — the single wiring root —
   `pnpm --filter @printer/render-worker test`
7. `apps/render-worker/src/adapters/manifest-template-catalog.ts#ManifestTemplateCatalog` —
   ORCHID-MEM: `01a1c1d8-f365-7ef6-977c-6c5ee18cb802` — bundled template resolution —
   `pnpm --filter @printer/render-worker test`
8. `apps/render-worker/src/adapters/placeholder-pdf-renderer.ts#PlaceholderPdfRenderer` —
   ORCHID-MEM: `01a1c1d8-f3cf-7510-8a55-e30c74b3499a` — the deliberate Phase 1 rendering stub —
   `pnpm --filter @printer/render-worker test`
9. `apps/render-worker/src/adapters/s3-print-repository.ts#S3PrintRepository` — ORCHID-MEM:
   `01a1c1d8-f292-7843-9137-1a7992a59d52` — transient storage and presigned retrieval —
   `pnpm --filter @printer/render-worker test`
10. `apps/render-worker/src/adapters/sqs-result-delivery.ts#SqsResultDelivery` — ORCHID-MEM:
    `01a1c1d8-f2fd-74ad-98df-82f314ec4228` — SQS result delivery and FIFO identifiers —
    `pnpm --filter @printer/render-worker test`
11. `apps/render-worker/src/adapters/uuid-print-id-generator.ts#UuidPrintIdGenerator` —
    ORCHID-MEM: `01a1c1d8-f43a-7c14-886e-0e99b8f3511c` — deterministic retry identity —
    `pnpm --filter @printer/render-worker test`
12. `scripts/template-manifest.mjs#buildManifest` — ORCHID-MEM:
    `01a1c1d8-f4a3-73ce-8036-12b8b6325602` — release-aware content hashing —
    `pnpm vitest run scripts/template-manifest.test.mjs`
13. `infra/modules/printer/lambda.tf` — worker packaging, alias and event source mapping —
    `terraform -chdir=infra init -backend=false -input=false && terraform -chdir=infra validate`
14. `.github/workflows/release.yml` — semantic-release, OIDC deploy, smoke and rollback — review
    with `pnpm build:worker`; the deployed path requires repository variables and AWS.
15. `docker-compose.yml` and `tests/integration` — the local reproduction of the production path —
    `docker compose up -d localstack && pnpm local:setup && pnpm test:integration`

## How to run and test

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm exec prettier --check .
orchid-sdd lint
orchid-sdd index --check
```

Local end-to-end:

```bash
docker compose up -d localstack
pnpm local:setup
pnpm test:integration
pnpm worker:local   # terminal 1
pnpm sink:local     # terminal 2
pnpm smoke:local    # terminal 3
```

Build and Terraform checks:

```bash
pnpm template:manifest
pnpm build:worker
terraform -chdir=infra/bootstrap init -backend=false -input=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
tflint --init --config="$PWD/tflint.hcl"
tflint --config="$PWD/tflint.hcl" --chdir=infra --call-module-type=all
```

Cloud verification requires the remote, `TF_VARS`, `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`,
`TF_STATE_BUCKET`, `ARTIFACTS_BUCKET`, a one-time bootstrap apply and branch protection. See
`infra/README.md` and `README.md`.

## How to roll back

- **Release rollback:** dispatch `.github/workflows/release.yml` from `main` with the earlier `release` input
  (`vX.Y.Z` or `sha-…`). It skips semantic-release/build/upload, verifies the artifact exists,
  applies the earlier Terraform release and re-runs the smoke test.
- **Manual Terraform rollback:** with the backend initialized,
  `terraform -chdir=infra apply -var release=<earlier> -var artifacts_bucket="$ARTIFACTS_BUCKET"`
  plus the operator tfvars. The earlier worker zip must already exist in the artifacts bucket.
- **Local/code rollback:** revert the offending commit on `main`; there is no database or
  persistent business state to migrate.
- **Data:** prints expire after one day; the artifacts and state buckets are versioned; the KMS
  key has a 30-day deletion window. Empty the prints bucket before `terraform destroy`.
- **DLQ:** inspect `printer-jobs-dlq`, fix the cause, then redrive the messages through the SQS
  console or AWS CLI.

## Risks, gaps, and follow-ups

- **Cloud verification is deferred.** OIDC deploy, Terraform apply, deployed smoke, rollback and
  the GitHub CI run require the remote, AWS account, bootstrap apply and repository variables.
  Treat the first real release as the acceptance run.
- **Branch protection and release-bot bypass** must be configured before PRs and semantic-release
  changelog pushes are enabled.
- **Phase 2:** template engine, `template:*` tooling, manifest release asset publication and the
  optional network module.
- **Phase 3:** Chromium rendering, PDF/A, HTTP/Lambda/EventBridge/S3 channels, ping, allowlist
  enforcement, render regression, Power Tuning and load testing.
- **Phase 4:** production alarms, runbook, multi-template smoke and monitoring.
- **Known low/medium gaps:** DLQ redrive is not exercised end-to-end; LocalStack presigns HTTP;
  cross-region SQS callbacks are unsupported; KMS tag propagation can require an apply retry;
  partial-release recovery is manual; GitHub Actions are pinned to major tags rather than SHAs.
- **No production data exists yet.** The service is safe to evolve while Phase 1 is the only
  deployed increment.
