# P-207 implementation report

- Prompt: P-207 — Add generated or provided caller and worker roles
- Branch: `orchid/2026-11-10-finalize-printer-rendering-callbacks-and-product/P-207`
- Status: complete

## Delivered

- Caller role: create/existing, generated trust/`sqs:SendMessage` only on the jobs queue, existing
  ARN added to queue senders, outputs.
- Worker role: create/existing same-account/trust-Lambda validation, conditional role/policy,
  resolved ARN for Lambda/KMS/smoke queue, channel IAM for Lambda/EventBridge/SQS target ARNs,
  no jobs-queue send, provided trust check via `aws_iam_role`.
- Bootstrap: `additional_worker_role_arns` for PassRole/GetRole; EC2/VPC permissions with tag,
  region, CreateAction and SG-rule coverage; no OIDC trust change.
- Outputs `caller_role_arn`, `worker_role_arn`, `caller_role_created`, `worker_role_created`;
  PDF/A levels restored to all eight.
- Docs/tfvars for both role modes, cross-account caller vs same-account worker, provided-role
  responsibilities and bootstrap re-apply.

## Review

Two independent reviewers; multiple IAM rounds. Fixed: DescribePrefixLists, CreateTags escalation,
EC2 action scoping/region, SG-rule tag-on-create and ModifySecurityGroupRules, provided worker
trust validation, callback target jobs-queue/wildcard guard, same-account additional ARNs, and
upgrade docs. Final static checks/plans green; no blocking findings after the last fix.

## Acceptance

| Check | Result |
|---|---|
| Bootstrap/root fmt/init/validate/tflint | PASS |
| create/create, existing/create, existing/existing, create/existing plans | PASS |
| VPC create plan | PASS |
| Wrong trust/missing role/jobs callback/wildcard/cross-account/shared role | Rejected |
| `pnpm test`/typecheck/lint/prettier on main | PASS — 449 tests |

## Residual risks

- EC2 tag-key allowlist must mirror extra main tags; tag-only updates require the Project tag.
- Provided worker permissions are owner-managed; trust is validated syntactically, not full IAM.
- No real apply; policy/plan evidence only.
- PDF/A defaults take effect only after P-202/P-204/P-209; bootstrap must be re-applied before the
  first main apply.
