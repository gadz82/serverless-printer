# P-104 implementation report

- Prompt: P-104 — Add the optional network module and worker VPC wiring
- Branch: `orchid/2026-11-10-complete-the-printer-service-with-templates-rend/P-104`
- Status: complete

## Delivered

- `infra/modules/network` with `none` (default), `create` and `lookup`.
- `create`: VPC, private subnets/routes, optional public subnets/NAT, S3 gateway endpoint,
  SQS/Lambda/Events interface endpoints, worker and endpoint security groups.
- `lookup`: VPC/subnet selectors by IDs or tags; no VPC created; optional existing worker SGs.
- Printer/root wiring: Lambda `vpc_config` only when a VPC is selected, new outputs, unchanged
  Phase 1 addresses/names.
- Conditional worker VPC ENI IAM; canonical IPv4 `/16`–`/24` validation; AZ-count precondition;
  NAT route-association ordering; tfvars/README updates.

## Review

Independent reviewer: approve with comments. The medium AZ-count plan-time failure was fixed with
a `terraform_data` precondition and safe slicing; `vpc_cidr` validation, tfvars formatting and
lookup-mode documentation were tightened. Final acceptance is green.

## Acceptance

| Check | Result |
|---|---|
| `terraform -chdir=infra fmt -check -recursive` | PASS |
| `terraform -chdir=infra init -backend=false` + `validate` | PASS |
| `tflint --config=$(pwd)/tflint.hcl --chdir=infra --call-module-type=all` | PASS |
| Plan `none` | PASS — 20 resources, no VPC config/IAM |
| Plan `create` | PASS — VPC/subnets/endpoints, optional NAT |
| Plan `lookup` | PASS — no new VPC, worker SG handling |
| `az_count` > available AZs | FAILS with a clear precondition |
| Invalid IPv4/CIDR shapes | FAIL with a canonical CIDR error |
| `pnpm test`/typecheck/lint/prettier on main | PASS |

## Residual risks

- **Bootstrap deploy role lacks EC2/VPC permissions.** Applying `create`/`lookup` through the normal
  OIDC deploy role needs an admin profile until bootstrap is expanded in a follow-up. `none`
  remains unaffected.
- VPC modes are plan-verified only; no live apply/connectivity test.
- Lookup mode relies on the existing VPC's endpoints/NAT; documented.
- Worker ENI permissions use `Resource: "*"` per AWS's Lambda VPC policy; broad but standard.
- Non-commercial partitions and NAT/public association ordering remain untested against AWS.
