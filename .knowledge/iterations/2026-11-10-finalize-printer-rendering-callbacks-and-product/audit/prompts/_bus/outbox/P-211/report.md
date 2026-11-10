# P-211 implementation report

- Prompt: P-211 — Document cloud verification, rollback and branch protection
- Status: complete

## Delivered

- `docs/cloud-verification.md`: prepare/bootstrap/repository-variable order derived from
  bootstrap outputs; caller/worker role matrix and provided-role prerequisites; bootstrap
  PassRole/GetRole/EC2 permissions; VPC mode checks and endpoint/route commands; branch protection
  with required checks, PR/squash/linear rules and release-bot bypass; first apply, artifact and
  plain/PDF-A smoke commands with expected output; rollback; alarm test/reset; throughput/Power
  Tuning evidence fields; closeout checklist.
- `README.md`: current-scope/product status replaces the Slice 1/2/3 sections; commands include
  `test:render` and the Chromium zip; template preview no longer promises a future PDF/A mode;
  local verification uses the local Chrome adapter; cloud section links the new guide.
- `infra/README.md`: cloud verification link, worker memory input, PDF/A defaults/2b smoke note.
- `infra/bootstrap/README.md`, `infra/terraform.tfvars.example`, `docs/runbook.md`: removed stale
  prompt/Slice/PDF-A-pending wording, corrected `AWS_DEPLOY_ROLE_ARN` and bootstrap-state wording.
- No application or Terraform resource code changes; no secrets.

## Checklist contents

| Area | Covered |
| --- | --- |
| Repository variables | `TF_VARS`, `AWS_DEPLOY_ROLE_ARN`, `AWS_PLAN_ROLE_ARN`, `AWS_REGION`, buckets, key |
| Bootstrap | local state handling, outputs, re-apply triggers, PassRole/GetRole/EC2 permissions |
| Roles | caller/worker create/existing matrix, same-account worker, cross-account caller, trust checks |
| VPC | `none`/`create`/`lookup`, endpoints/NAT, KMS service-side note, verification commands |
| Branch protection | six required checks, PR-only/squash/linear, Terraform plan fork condition, release-bot bypass |
| Smoke | artifact check, manual plain + PDF/A-2b commands and expected output |
| Rollback | dispatch, artifact prerequisite, alias verification, both smoke jobs |
| Alarms | opt-in SNS, `set-alarm-state` test and reset, runbook links |
| Capacity | load-test fields, 20-page throughput/p95, Power Tuning evidence, `TF_VARS` apply path |

## Acceptance

| Command | Result |
| --- | --- |
| `pnpm exec prettier --check docs/cloud-verification.md README.md infra/README.md` | PASS |
| `pnpm template:validate` | PASS — 2 templates |
| `git diff --check` | PASS |
| `terraform -chdir=infra fmt -check -recursive` | PASS |
| `pnpm test`/typecheck/lint/Prettier on main | PASS — 614 tests |

## Review

Two independent reviewers. Fixed the state-bucket example, bootstrap/output ordering, `gh api`
placeholders, missing artifacts export, VPC KMS wording, required-check completeness,
PR/squash/linear rules, alarm reset, tfvars copy, runbook variables and check-count wording.
Final verdicts: PASS.

## Residual risks

- No AWS/GitHub run: the checklist is procedural until the first operator deployment.
- Branch-protection/ruleset state cannot be verified from the repository; the release-bot bypass
  may need a GitHub App token instead of `GITHUB_TOKEN`.
- PDF/A remains best effort with no validator.
- The local template-preview CLI still has a legacy "Slice 2" message for `--pdfa`; the README
  correctly documents that local PDF/A preview is unavailable. This is the only remaining
  user-facing Slice wording and is outside the no-code P-211 scope.
