# P-008 implementation report

- Prompt: P-008 — Build the printer Terraform module and single root deployment
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-008`
- Status: complete

## Delivered

- `infra/modules/printer` with jobs queue, DLQ, smoke-results queue, queue policies, prints
  bucket, project KMS key, worker role/policy, Lambda, `live` alias, SQS event source mapping,
  log group and optional alarms.
- Names aligned with the bootstrap deploy policy: `<prefix>-jobs`, `<prefix>-jobs-dlq`,
  `<prefix>-smoke-results`, `<prefix>-prints`, `<prefix>-render-worker`, and
  `/aws/lambda/<prefix>-render-worker`.
- SQS: SSE-SQS, 1 MiB messages, 360 s visibility, DLQ after `max_receive_count`, DLQ redrive
  allow policy, and conditional sender policy for configured accounts/principals/organization.
- Prints bucket: SSE-KMS with project CMK, public access blocked, TLS-only, versioning off,
  one-day `prints/` lifecycle, worker-only write.
- KMS: rotation, `Project = name_prefix` tag for the bootstrap condition, worker
  decrypt/generate-data-key, deploy role administration, alias.
- Lambda: `nodejs24.x`, `x86_64`, 1,536 MB, 60 s, handler from
  `<artifacts>/<release>/render-worker.zip`, published version plus `live` alias, batch size
  1–5, `ReportBatchItemFailures`, maximum concurrency and reserved concurrency.
- Root S3 backend with `use_lockfile`, §6.5 variables, tfvars example, outputs and README.

## Review

Two independent reviewers: PASS/ACCEPT with one medium contract finding and low hardening items.

1. The jobs queue policy no longer adds the deploy role as a sender; the release smoke uses the
   deploy role's bootstrap IAM permission. The queue policy is conditional on configured senders
   or `organization_id`.
2. Integer validations (`floor(x) == x`) added for the numeric inputs, so fractional plan values
   cannot fail at Lambda cold start or SQS apply.
3. README documents the KMS tag create-time/Project-only limitation and the queue-sender
   contract.
4. On `main`, the bootstrap smoke-send permission was narrowed from `<prefix>-jobs*` to the exact
   `<prefix>-jobs` queue, and `.gitignore` now covers `infra/terraform.tfvars` and `*.tfplan`.

Final verdict: LGTM, no blocking findings.

## Acceptance

| Command | Result |
|---|---|
| `terraform -chdir=infra fmt -check -recursive` | PASS |
| `terraform -chdir=infra init -backend=false` | PASS |
| `terraform -chdir=infra validate` | PASS |
| `tflint --chdir=infra` | PASS |
| `terraform -chdir=infra/bootstrap fmt/init/validate/tflint` | PASS |
| `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .` on main | PASS |

No AWS plan or apply was run; deployment-time behavior remains operator-verified.

## Residual risks

- KMS tag authorization can require a retry on the first apply.
- KMS tags are effectively create-time/Project-only under the bootstrap deploy policy.
- No deployed plan/apply has exercised Lambda S3 code fetch, alias ESM or IAM propagation.
- Same-account IAM can send to the jobs queue when no queue policy is configured; cross-account
  senders require explicit configuration.
- `terraform destroy` requires manually emptying the prints bucket first.
