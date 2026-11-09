# P-007 implementation report

- Prompt: P-007 — Provision the state, artifacts and GitHub OIDC foundation with Terraform
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-007`
- Status: complete

## Delivered

- `infra/bootstrap` with Terraform >= 1.11, AWS provider ~> 6.0 and TLS provider.
- Versioned, encrypted, public-access-blocked state and artifacts buckets with override-able
  names.
- GitHub OIDC provider create-or-lookup, deploy role restricted to `refs/heads/main`, plan role
  restricted to `pull_request`, both audience `sts.amazonaws.com`.
- Scoped deploy policy for state/artifacts, SQS, prints bucket, KMS, Lambda, IAM, logs, alarms,
  smoke send/receive and `iam:PassRole`; no AdministratorAccess.
- Read-only plan policy plus explicit state read.
- Outputs, tfvars example and README covering apply, state storage and GitHub variables.
- Bootstrap lock file committed; local state, `.terraform/` and tfvars excluded.

## Review and fixes

Three review rounds found and fixed apply-time IAM issues:

1. `lambda:CreateEventSourceMapping` now uses `Resource: "*"` with a `lambda:FunctionArn`
   condition; `ListEventSourceMappings` removed.
2. `logs:DescribeLogGroups` now uses `Resource: "*"`.
3. KMS administration is scoped by `aws:ResourceTag/Project = name_prefix`; `CreateKey` and
   `TagResource` require the project request tag, so an unrelated key cannot be tagged into
   scope. P-008 must tag the key `Project = name_prefix`. The first apply may need a retry while
   KMS tag authorization propagates; documented in the README.
4. Invalid S3 `Delete*` actions removed; `kms:UntagResource` removed to avoid removing the
   scope tag.

Final verdict: LGTM, no blocking findings.

## Acceptance

| Command | Result |
|---|---|
| `terraform -chdir=infra/bootstrap fmt -check` | PASS |
| `terraform -chdir=infra/bootstrap init -backend=false` | PASS |
| `terraform -chdir=infra/bootstrap validate` | PASS |
| `tflint --chdir=infra/bootstrap` | PASS |

No apply was run; the operator supplies the account, remote and admin credentials.

## Residual risks

- KMS tag propagation can make the first P-008 apply fail with AccessDenied; retry after up to
  five minutes.
- The read-only plan role cannot write the state lock; P-009 must plan with `-lock=false` or add
  a narrow lock-object grant.
- The deploy role can attach arbitrary inline policies to worker roles; a permissions boundary
  would reduce that escalation path.
- KMS alias operations remain scoped by alias name, not by key tag.
- Bootstrap state is local by design (ADR-004) and must be stored securely.
