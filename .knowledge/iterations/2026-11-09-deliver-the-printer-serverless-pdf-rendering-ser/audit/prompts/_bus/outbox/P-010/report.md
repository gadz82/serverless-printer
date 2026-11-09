# P-010 implementation report

- Prompt: P-010 — Cut releases and deploy through OIDC with smoke and rollback
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-010`
- Status: complete

## Delivered

- `release.yml` for pushes to `main` and manual dispatch/rollback, with `deploy` concurrency.
- semantic-release config with commit-analyzer, release-notes, changelog, exec, git and github;
  no npm publish.
- Release determination: `vX.Y.Z` from `.release-version`, `sha-<7>` otherwise, dispatch input
  for rollback; strict label validation.
- Build step: release-aware manifest, esbuild ESM Node 24 bundle with the `createRequire`
  banner, template/manifest copy, zip, and post-build handler import check.
- OIDC-only AWS credentials, artifact upload, S3 preflight, Terraform init/apply with
  `-var-file` before `-var`, deploy-role override, KMS-propagation retry, outputs, smoke and
  manifest release asset.
- Smoke script: contract-validated outbound `_smoke` job, unique refId, 60 s poll, result
  contract validation, release/slug/hash/size assertions, delete, redacted logging.
- `write-release.mjs` byte-exact `.release-version`.

## Review

Two independent reviewers: both approve after fixes.

1. **Terraform precedence:** `-var-file=terraform.tfvars` now precedes all `-var` flags, so the
   workflow-owned release, artifacts bucket, region and deploy role cannot be overridden by the
   operator file.
2. **Operator configuration:** the workflow materializes `infra/terraform.tfvars` from the
   `TF_VARS` repository variable and fails closed when it is absent/empty; the deploy role is
   passed explicitly from `AWS_DEPLOY_ROLE_ARN`.
3. **Smoke correctness:** the outbound job is validated with `validateJob`, `RELEASE` is required,
   and `result.template.release` must match the deployed release.
4. **Artifact preflight:** `aws s3api head-object` fails clearly before apply when the release zip
   is missing, including rollback.
5. **Log redaction:** the presigned `printing` URL and full result are no longer logged.
6. **Build guard:** the manifest must contain `_smoke` before bundling.
7. **KMS retry:** apply retries up to 3 times with 60 s waits.
8. Operational prerequisites documented in `release.yml` and `infra/README.md`: `TF_VARS`,
   required repository variables, dispatch from `main`, and branch-protection bypass for the
   semantic-release changelog commit.

## Acceptance

| Command | Result |
|---|---|
| `pnpm build:worker` | PASS — 344,152-byte zip, handler import check |
| `RELEASE=v1.2.3 pnpm build:worker` | PASS — manifest release `v1.2.3` |
| `node --check` on the three scripts | PASS |
| Prettier on workflow/config/scripts | PASS |
| `pnpm test`, `pnpm typecheck`, `pnpm lint` on main after merge | PASS |

Real semantic-release, OIDC, Terraform apply and deployed smoke were not run locally: the repo
has no remote/AWS context yet.

## Residual operational risks

- `TF_VARS` must contain the complete non-secret operator configuration; omitted values fall
  back to Terraform defaults.
- Branch protection must allow the GitHub Actions token/App to push the semantic-release
  `CHANGELOG.md` commit; dispatch must run from `main`.
- semantic-release publishes the tag/release before build/apply/smoke. A failed deploy can leave
  a release without the manifest asset; recovery may require a manual artifact upload or a
  follow-up run. Plan to improve draft-release finalization later.
- The KMS retry window is about two minutes versus the documented five-minute propagation window;
  a rerun may still be needed.
- No live AWS deploy has validated OIDC, Terraform apply, Lambda code fetch or the deployed smoke.
