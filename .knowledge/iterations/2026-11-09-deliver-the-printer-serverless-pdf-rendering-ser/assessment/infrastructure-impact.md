# Infrastructure impact assessment

## Bootstrap (one-time, `infra/bootstrap`)

| Resource | Decision |
|---|---|
| Terraform state | Local state for bootstrap only; not committed. The main deployment uses the created S3 backend. See ADR-004 |
| State bucket | `<prefix>-tfstate`, versioned, encrypted, public access blocked, native lock file enabled in the main backend |
| Artifacts bucket | `<prefix>-artifacts`, versioned, encrypted, public access blocked, worker zips under `<release>/` |
| GitHub OIDC provider | `token.actions.githubusercontent.com`; create or look up an existing provider |
| Deploy role | Trusts only `repo:<owner>/<repo>:ref:refs/heads/main` with audience `sts.amazonaws.com`; used by `release.yml` |
| Plan role | Trusts `repo:<owner>/<repo>:pull_request`; read-only plan access |
| Outputs | State bucket, artifacts bucket, deploy role ARN, plan role ARN |

## Printer module (`infra/modules/printer`)

| Resource | Phase 1 decision |
|---|---|
| Jobs queue | SSE-SQS, visibility timeout ≥ 6× the 60 s worker timeout, redrive to DLQ after `max_receive_count` (default 5) |
| DLQ | SSE-SQS, same retention as the jobs queue |
| Queue policy | Send allowed only for `allowed_sender_account_ids`, `allowed_sender_principal_arns` or `organization_id`; optional EventBridge rule principal when `job_rule` is later supplied |
| Prints bucket | SSE-KMS with a project CMK, public access blocked, TLS-only bucket policy, versioning off, lifecycle expiry 1 day, worker-only writes |
| KMS key | Rotation enabled; key policy grants the worker encrypt/decrypt and the deploy role key administration |
| Worker Lambda | `nodejs24.x`, `x86_64`, 1,536 MB, 60 s, environment from §4.8 plus `MAX_RECEIVE_COUNT`, code from `s3://<artifacts>/<release>/render-worker.zip`, published version plus `live` alias. `PDFA_ALLOWED_LEVELS` defaults to an empty list in Phase 1 (PDF/A rejected; ADR-003) |
| Event source mapping | Batch size 1–5, `ReportBatchItemFailures`, `scaling_config.maximum_concurrency` with a minimum of 2, optional reserved concurrency |
| IAM | Consume the jobs queue, read/write `prints/*`, KMS, CloudWatch Logs, `sqs:SendMessage` on `callback_target_arns` only, with `aws:ResourceOrgID` when `organization_id` is set |
| CloudWatch | Log group with `log_retention_days` (default 30); DLQ-depth and worker-error alarms behind `enable_alarms = false` |
| VPC | `vpc_mode = "none"` in Phase 1; `modules/network` and the create/lookup modes arrive in Phase 2 |

## Root deployment (`infra/`)

- `backend.tf` uses S3 with `use_lockfile = true`, key `printer/terraform.tfstate`.
- `main.tf` calls `modules/printer` with the bootstrap outputs and the release value.
- Inputs follow §6.5; `release` is supplied by `release.yml`.
- No environments, workspaces, or per-stage stacks.

## CI/CD impact

### `ci.yml`

- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, unit and contract tests.
- LocalStack service container (SQS + S3) for integration tests.
- Commitlint over every PR commit and the PR title.
- Terraform `fmt -check`, `init -backend=false`, `validate`, `tflint`, and a plan through the
  read-only OIDC role. Plans are posted to the PR; fork PRs without OIDC are reported as skipped,
  not silently green.

### `release.yml`

- Triggers: push to `main` and `workflow_dispatch` with a `release` input; concurrency group
  `deploy`.
- Semantic-release computes `vX.Y.Z` or `sha-<short>`, updates `CHANGELOG.md`, tags and releases.
- Build bundles the worker with esbuild, generates the manifest, and creates
  `render-worker.zip`.
- OIDC assumes the deploy role; the zip is uploaded to the artifacts bucket.
- Terraform applies with `-var release=<release>`; the smoke script sends the `_smoke` job with
  an SQS callback and waits for the result.
- On a release cut, `templates.manifest.json` is attached to the GitHub Release.
- Rollback skips versioning and build, applies the requested release, and runs the smoke test.

## Inputs the operator must supply

- GitHub owner and repository name (OIDC trust and workflow).
- AWS account, region and role ARNs.
- Bootstrap state/artifacts bucket names (or prefix).
- Repository variables for the workflows: region, role ARNs, state bucket/key, artifacts bucket.
- Initial `callback_target_arns` and `allowed_sender_*` values.

These are captured as assumptions `A-001`–`A-004`; none changes the product scope.

## Infrastructure risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OIDC trust misconfigured | Medium | High | Bootstrap tests the trust policy; deploy workflow fails closed |
| Bootstrap applied with wrong account/region | Low | High | Explicit variables, plan review, no default credentials |
| Deploy role too broad | Medium | High | Resource-scoped policies, conditional `iam:PassRole`, review at G3 |
| S3 bucket name collision | Low | Medium | Configurable prefix; bootstrap fails clearly |
| LocalStack diverges from AWS | Medium | Medium | Deployed smoke is authoritative; integration tests cover the adapter contract |
| Terraform provider v6 breaking changes | Medium | Medium | Pin `~> 6.0`, run `validate` and `plan` in CI |
