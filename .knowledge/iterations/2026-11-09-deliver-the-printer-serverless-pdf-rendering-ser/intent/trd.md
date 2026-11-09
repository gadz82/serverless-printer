# TRD — Foundations: contracts and a deployable Printer skeleton

- Iteration: `2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser`
- Constitution: `.orchid/constitution/constitution.md` (backend profile)
- Source: `SPEC.md` v0.4
- This is a hypothesis; the assessment phase validates it.

## Constraints

- **Runtime:** Node.js 24 on AWS Lambda, `x86_64`, TypeScript in strict mode.
- **Tooling:** pnpm workspace, Vitest, ESLint or Biome, esbuild for the worker bundle, Terraform ≥ 1.11 with AWS provider `~> 6.0`.
- **Cloud:** single AWS deployment, no environments, no database, no API, no UI. The jobs SQS queue is the only entry point.
- **CI/CD:** GitHub Actions with OIDC only; semantic-release and Conventional Commits; no static AWS credentials.
- **Entry contract:** one SQS message is at most 1 MiB and produces exactly one print; EventBridge is limited to 256 KiB.
- **Environment limits:** all Lambda environment variables together must stay under 4 KB.
- **Packaging:** the worker zip is uploaded to the artifacts bucket and deployed from `s3_key`; this increment's placeholder renderer keeps the zip small, while Chromium packaging is deferred to Phase 3.
- **Repository:** one Git repository; development stays on `main`; the operator adds the remote later.
- **Scope:** kickoff Phase 0–1 only. The placeholder renderer, the bundled `_smoke` template and the minimal manifest exist to prove the end-to-end path, not to deliver production rendering.

## Architecture direction

Hexagonal architecture with dependencies pointing inward:

- `packages/contracts` — versioned JSON Schemas for job and result payloads, plus generated TypeScript types and fixture helpers. No AWS imports.
- `packages/domain` — entities, ports and the `ProcessPrintJob` use case. No AWS, Chromium, filesystem or HTTP imports. Ports:
  - `PrintRepository` (store a print and produce a reference);
  - `ResultDelivery` (deliver a success or failure result);
  - `PdfRenderer` (render a template and payload to PDF bytes);
  - `Clock`, `IdGenerator` and `Logger` for determinism and tests.
- `apps/render-worker` — SQS adapter, Lambda entry point, AWS SDK adapters for S3 and SQS results, a placeholder `PdfRenderer`, configuration parsing and error mapping.
- `templates/_smoke` — the tiny identity used by the post-deploy smoke path, bundled with a generated manifest slice. Full template tooling remains Phase 2.
- `scripts/` — manifest/build/smoke helpers used by CI and the release workflow.
- `infra/bootstrap` — state bucket, artifacts bucket, GitHub OIDC provider, deploy role and read-only plan role.
- `infra/modules/printer` — jobs queue + DLQ, prints bucket + KMS, worker Lambda + alias, IAM, log group, event source mapping and optional alarm inputs.
- `infra/main.tf`, `variables.tf`, `backend.tf` — single deployment wired to the bootstrap outputs.
- `.github/workflows/` — `ci.yml` for pull requests, `release.yml` for `main` and manual rollback.

The real Chromium renderer replaces the placeholder behind the `PdfRenderer` port in Phase 3 without changing the use case or the contracts.

## Patterns to follow

- Constitution: `.orchid/constitution/constitution.md`, including the backend profile guidelines for API, data and errors.
- Steering: architecture boundaries, SOLID, dependency inversion, hexagonal architecture, TypeScript code style, code examples and trunk-based repository flow.
- The domain and use case depend only on ports; AWS SDK calls live in adapters.
- One message, one print; errors are explicit and mapped to the documented error codes.
- Inline comments explain only why; significant units receive an `ORCHID-MEM` anchor and UUID docblock when their behaviour is implemented.
- A new runtime dependency needs an ADR and an owner; the placeholder renderer should prefer a dependency-free, deterministic PDF unless the assessment records `pdf-lib` as the approved choice.
- Configuration is parsed once at cold start and fails loudly on invalid values.

## Deliverables

- **Unit:** contract validation, print-id derivation, refId echoing, error mapping, domain use case with fake ports, placeholder renderer determinism, configuration parsing.
- **Integration:** LocalStack SQS and S3: handler consumes a job, stores the object, delivers the result to a callback queue, handles invalid messages and retries; Terraform `fmt`/`validate`/`tflint`.
- **E2E:** a deployed smoke job uses the `_smoke` template and an SQS callback queue, once on every release; local docker-compose flow documented and scripted.

## Infrastructure/API/data hypotheses

- **Bootstrap:** S3 state bucket with versioning, encryption, public-access block and native lock file; artifacts bucket `<prefix>-artifacts`; GitHub OIDC provider; deploy role restricted to `repo:<owner>/<repo>:ref:refs/heads/main`; read-only plan role for pull requests.
- **Printer module:** SSE-SQS jobs queue and DLQ with `max_receive_count`; queue policy restricted to configured senders; prints bucket with SSE-KMS, public-access block, TLS-only policy, versioning off and one-day lifecycle expiry; worker Lambda `nodejs24.x`, `x86_64`, 1,536 MB, 60 s, environment from the spec, published version plus `live` alias; event source mapping with batch size 1–5, `maximum_concurrency` and `ReportBatchItemFailures`; CloudWatch log group with retention; alarms off by default.
- **API:** none. The SQS queue is the interface; JSON Schemas are the public contract.
- **Data:** no database. S3 holds transient prints only; the deterministic `printId` is `UUIDv5(namespace, inbound SQS messageId)`; the result includes SHA-256 and size.
- **Callbacks:** the contract models all five channels, but this increment implements only `sqs` result delivery. Other channels return a documented non-retryable configuration error until Phase 3.
- **Confidence:** high for the queue/worker/storage path; medium for OIDC and LocalStack parity until exercised against a real account.

## Regression strategy

- Contract tests pin every job and result field and reject breaking edits without a version bump.
- Unit tests cover the use case and error table; integration tests run the handler against LocalStack.
- The deployed smoke test is the release authority; a failed smoke blocks the release.
- Terraform checks (`fmt -check`, `validate`, `tflint`, plan summary) guard infrastructure changes.
- Render fidelity is not tested in this increment; the render regression suite arrives with Chromium in Phase 3.
- Existing behaviour is protected by explicit ports and a small write scope per development prompt.

## Versioning and release

- Semantic-release derives the next SemVer from Conventional Commits; `docs:`/`chore:` produce a `sha-<short>` release value.
- The release workflow uploads `render-worker.zip` to `s3://<artifacts>/<release>/`, applies Terraform with `-var release=<release>`, and runs the smoke test.
- `CHANGELOG.md` is generated; the GitHub Release is created by semantic-release.
- Contract schemas are versioned in `packages/contracts`; a breaking contract change requires a major release and an ADR.
- Rollback re-dispatches `release.yml` with an earlier `release`, skipping versioning and build.
- No feature flags are planned for this increment; the placeholder renderer is replaced behind a port in Phase 3.

## Branch strategy

- Feature branch: **no**
- Base branch: `main`
- Integration target: `main` (the current branch)
- Remote: added later by the operator; no remote-dependent checks are required to build locally.
- Prompt branches: one disposable worktree/branch per prompt, merged to `main`, then deleted after CR.

## Criticalities

- Bootstrap and the first deploy require an AWS account, a GitHub repository identity and an administrator; the code must parameterize owner, repository, account and region.
- GitHub OIDC trust and branch protection cannot be verified until the remote exists.
- The placeholder renderer intentionally does not prove real PDF rendering or PDF/A; that risk moves to Phase 3.
- LocalStack may diverge from AWS on SQS batch responses, visibility timing and S3 presigning; deployed smoke remains authoritative.
- The 4 KB Lambda environment budget constrains the callback allowlist and requires compact configuration.
- The worker zip path and Terraform `s3_key` contract must stay in sync with the release workflow from the first deploy.
