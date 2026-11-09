# P-009 implementation report

- Prompt: P-009 — Gate pull requests with code, contract, LocalStack and Terraform checks
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-009`
- Status: complete

## Delivered

- `.github/workflows/ci.yml` with:
  - `quality`: frozen install, lint, Prettier, typecheck, unit and contract tests.
  - `integration`: LocalStack 4 SQS/S3 service container, healthcheck, the required endpoint
    environment and `pnpm test:integration`.
  - `terraform`: Terraform 1.11.0 fmt/init/validate plus TFLint 0.66.0 with the AWS ruleset
    and module coverage.
  - `terraform-plan`: same-repository PRs with plan variables only, read-only OIDC plan role,
    S3 backend init, `-lock=false`, optional `TF_VARS`/tfvars, region override, plan summary,
    bot-owned PR comment and artifact.
  - `terraform-plan-skipped`: explicit notice and step summary when OIDC variables are missing
    or the PR is a fork, so the plan check is skipped rather than falsely green.
  - `commitlint`: every PR commit plus the Conventional Commits PR title, rerun on title edits.
- `tflint.hcl` with the AWS ruleset pinned to 0.50.0.
- No deploy, apply, static AWS keys or out-of-scope edits.

## Review

Independent reviewer initially blocked on TFLint plugin initialization (`tflint --init` does
not discover `tflint.hcl`). Fixed with
`tflint --init --config="$GITHUB_WORKSPACE/tflint.hcl"` and `GITHUB_TOKEN`; the lint run now uses
`--call-module-type=all`. Also fixed: PR title edits rerun CI, the plan region is passed
explicitly after the optional tfvars, and the plan comment lookup is restricted to the bot.

Final verdict: PASS, no blocking findings.

## Acceptance

| Command | Result |
|---|---|
| `pnpm exec prettier --check .github/workflows/ci.yml` | PASS |
| `terraform -chdir=infra fmt -check -recursive` | PASS |
| `terraform -chdir=infra init -backend=false` + `validate` | PASS |
| `tflint --init --config=tflint.hcl` + `tflint --config=... --chdir=infra --call-module-type=all` | PASS |
| `actionlint` + ShellCheck | PASS |
| `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm test:integration` | PASS |
| `pnpm exec prettier --check .` on main after merge | PASS |

The OIDC plan path was not executed locally; it requires repository variables and a real plan
role.

## Residual risks

- `infra/plan.out` is uploaded as an artifact and may contain sensitive planned values.
- Fork/missing-variable PRs merge without a plan by design; branch protection must account for
  the skipped-check semantics.
- Actions use floating major tags and LocalStack uses a floating major image; no SHA/digest
  pinning.
- SPEC §7.2 template validation and render regression arrive with the template-engine and
  Chromium increments; the current scripts do not exist yet.
