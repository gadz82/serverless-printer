# Printer deployment

The single root Terraform deployment for the Phase 1 printer. It creates the jobs queue and
dead-letter queue, the transient prints bucket, the render worker Lambda and its permissions, the
release-smoke results queue, and optional CloudWatch alarms. There are no environments or
workspaces: `infra/` is the only deployment.

The one-time foundation (state bucket, artifacts bucket, GitHub OIDC roles) is
`infra/bootstrap`; apply that first. See its [README](bootstrap/README.md).

## What it creates

| Resource             | Name                                                                 | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Jobs queue           | `<name_prefix>-jobs`                                                 | SSE-SQS queue for print jobs, 360 s visibility timeout, redrive to the DLQ |
| Dead-letter queue    | `<name_prefix>-jobs-dlq`                                             | SSE-SQS destination after `max_receive_count` receives                     |
| Smoke-results queue  | `<name_prefix>-smoke-results`                                        | Short-retention SSE-SQS queue for release smoke results                    |
| Prints bucket        | `<name_prefix>-prints`                                               | SSE-KMS bucket for `prints/*.pdf`, one-day lifecycle expiry                |
| KMS key              | Alias `<name_prefix>-prints`                                         | Project CMK, rotation enabled, `Project = <name_prefix>` tag               |
| Worker Lambda        | `<name_prefix>-render-worker`                                        | `nodejs24.x`, x86_64, 1,536 MB, 60 s, published version with `live` alias  |
| Event source mapping | Jobs queue to the `live` alias                                       | Batch size 1–5, `ReportBatchItemFailures`, maximum concurrency             |
| Worker role          | `<name_prefix>-render-worker`                                        | Consume jobs, read/write prints, KMS, logs, scoped SQS result sends        |
| Log group            | `/aws/lambda/<name_prefix>-render-worker`                            | Worker logs with configurable retention                                    |
| Alarms               | `<name_prefix>-jobs-dlq-depth`, `<name_prefix>-render-worker-errors` | Created only when `enable_alarms = true`                                   |

The worker code is deployed from
`s3://<artifacts_bucket>/<release>/render-worker.zip`. `release` is the release workflow's
SemVer tag or `sha-<short>`; a rollback applies an earlier release value.

## Prerequisites

- Terraform 1.11 or newer (S3 native lock files).
- The bootstrap stack applied and its outputs available.
- AWS credentials that can assume the deploy role, or an administrative profile for the first
  manual apply.
- A worker zip already uploaded to the artifacts bucket for the release being deployed.

## Initialise the S3 backend

The state bucket and region come from bootstrap; the key is fixed in `backend.tf` to
`printer/terraform.tfstate`, and `use_lockfile = true` enables native locking.

```sh
terraform -chdir=infra init \
  -backend-config="bucket=$(terraform -chdir=infra/bootstrap output -raw state_bucket)" \
  -backend-config="region=eu-central-1"
```

Use the region from `infra/bootstrap/terraform.tfvars`. The state bucket and artifacts bucket are
outside this deployment's lifecycle, so `terraform destroy` here cannot delete them.

## Configure and apply

```sh
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Edit: name_prefix, region, artifacts_bucket, deploy_role_arn and the sender/callback values.
```

Read `artifacts_bucket` and `deploy_role_arn` from
`terraform -chdir=infra/bootstrap output -raw artifacts_bucket` and
`terraform -chdir=infra/bootstrap output -raw deploy_role_arn`. The root default is
`<name_prefix>-artifacts` and the `<name_prefix>-deploy` role when those inputs are omitted, but
an operator should still verify them against the bootstrap outputs.

Keep `terraform.tfvars` out of commits; it contains operator-specific values. The release
workflow supplies `release` and `artifacts_bucket` with `-var`; a manual apply must set a real
release label (the example `dev` only keeps validate and plan usable).

```sh
terraform -chdir=infra plan -out=printer.tfplan
terraform -chdir=infra apply printer.tfplan
rm infra/printer.tfplan
```

For a release deployment:

```sh
terraform -chdir=infra plan \
  -var release=v1.2.3 \
  -var artifacts_bucket="$ARTIFACTS_BUCKET" \
  -out=printer.tfplan
```

If the first apply fails with `AccessDenied` while creating or tagging the KMS key, wait up to
five minutes and retry. The bootstrap deploy role scopes KMS administration with
`aws:ResourceTag/Project`, and KMS tag authorization is eventually consistent.

## Outputs

```sh
terraform -chdir=infra output
```

| Output                                 | Use                                                 |
| -------------------------------------- | --------------------------------------------------- |
| `jobs_queue_url` / `jobs_queue_arn`    | Sending jobs and callback configuration             |
| `jobs_dlq_url` / `jobs_dlq_arn`        | Inspecting or redriving failed jobs                 |
| `prints_bucket`                        | Operational inspection of transient PDFs            |
| `smoke_queue_url` / `smoke_queue_arn`  | Release smoke polling and the `_smoke` job callback |
| `function_name` / `function_alias_arn` | Lambda inspection and the invoked `live` alias      |
| `worker_role_arn`                      | Cross-account callback grants and review            |
| `kms_key_arn`                          | Decrypt grants for operational tooling              |

The release workflow reads `jobs_queue_url`, `smoke_queue_url` and `smoke_queue_arn` to run the
smoke script.

## Queue senders and smoke delivery

The jobs queue policy allows `sqs:SendMessage` only from:

- `allowed_sender_account_ids` (each account root principal),
- `allowed_sender_principal_arns`,
- principals in `organization_id` via `aws:PrincipalOrgID`, when set.

The deploy role is deliberately **not** listed in the queue policy. The release smoke sends through
the deploy role's bootstrap IAM identity policy, which already grants `sqs:SendMessage` on
`<name_prefix>-jobs*`; no queue-policy exception is needed.

When both sender lists are empty and `organization_id` is null, the module does not create a jobs
queue policy at all. Same-account IAM permissions still let the deploy role send and the worker
consume, so the queue is usable without a resource policy. Cross-account callbacks need a matching
grant on the target account's queue as well.

The worker may send results only to `callback_target_arns` plus the smoke-results queue. Its IAM
policy has no wildcard SQS send resource. When `organization_id` is set, callback sends also carry
an `aws:ResourceOrgID` condition.

## Prints bucket and KMS

- Objects live under `prints/` and expire after one day.
- Versioning is disabled, public access is blocked, and a bucket policy denies non-TLS requests.
- Default SSE-KMS uses the project CMK with S3 Bucket Keys enabled.
- Only the worker role has `s3:PutObject`; the deploy role configures the bucket but does not write
  objects.
- The key policy grants the worker `kms:Decrypt` / `kms:GenerateDataKey` and grants the deploy role
  key administration. The key is tagged `Project = <name_prefix>` so the bootstrap identity policy
  can scope administration to this project.
- Treat the key tags as create-time and `Project`-only. The bootstrap deploy identity policy allows
  tag changes only while the key already carries `Project = <name_prefix>` and the request keeps
  it. Changing or removing that tag later can require a bootstrap policy change and can break
  subsequent applies.

## Alarms and logs

Alarms are off by default. To enable both alarms:

```hcl
enable_alarms       = true
alarm_sns_topic_arn = "arn:aws:sns:eu-central-1:123456789012:printer-alerts"
```

`log_retention_days` defaults to 30 and accepts only CloudWatch Logs retention values.

## Network

`vpc_mode` defaults to `"none"` and validates that it stays `"none"` in Phase 1. The worker runs
outside a VPC and reaches SQS, S3, KMS and callback endpoints without NAT or VPC endpoints. VPC
create/lookup modes arrive in Phase 2.

## Local checks

```sh
terraform -chdir=infra fmt -check
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
tflint --chdir=infra
```

`init -backend=false` does not contact the state bucket; use the backend init command above before
any plan or apply.
