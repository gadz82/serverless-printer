# Printer deployment

The single root Terraform deployment for the printer. It creates the jobs queue and
dead-letter queue, the transient prints bucket, the render worker Lambda and its permissions, the
release-smoke results queue, and optional CloudWatch alarms. When `vpc_mode` is `create` or
`lookup`, it also attaches the worker to a VPC. There are no environments or workspaces: `infra/`
is the only deployment.

The one-time foundation (state bucket, artifacts bucket, GitHub OIDC roles) is
`infra/bootstrap`; apply that first. See its [README](bootstrap/README.md).

## What it creates

| Resource              | Name                                                                                    | Purpose                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Jobs queue            | `<name_prefix>-jobs`                                                                    | SSE-SQS queue for print jobs, 360 s visibility timeout, redrive to the DLQ |
| Dead-letter queue     | `<name_prefix>-jobs-dlq`                                                                | SSE-SQS destination after `max_receive_count` receives                     |
| Smoke-results queue   | `<name_prefix>-smoke-results`                                                           | Short-retention SSE-SQS queue for release smoke results                    |
| Prints bucket         | `<name_prefix>-prints`                                                                  | SSE-KMS bucket for `prints/*.pdf`, one-day lifecycle expiry                |
| KMS key               | Alias `<name_prefix>-prints`                                                            | Project CMK, rotation enabled, `Project = <name_prefix>` tag               |
| Worker Lambda         | `<name_prefix>-render-worker`                                                           | `nodejs24.x`, x86_64, 1,536 MB, 60 s, published version with `live` alias  |
| Event source mapping  | Jobs queue to the `live` alias                                                          | Batch size 1–5, `ReportBatchItemFailures`, maximum concurrency             |
| Caller role           | `<name_prefix>-caller`                                                                  | Created by default or provided; `sqs:SendMessage` only on the jobs queue   |
| Worker role           | `<name_prefix>-render-worker`                                                           | Consume jobs, read/write prints, KMS, logs, scoped channel result sends    |
| Log group             | `/aws/lambda/<name_prefix>-render-worker`                                               | Worker logs with configurable retention                                    |
| Alarms                | `<name_prefix>-jobs-dlq-depth`, `<name_prefix>-render-worker-errors`                    | Created only when `enable_alarms = true`                                   |
| VPC and subnets       | `<name_prefix>-vpc`, `<name_prefix>-private-N`                                          | Created only in `vpc_mode = "create"`; private subnets across `az_count`   |
| NAT gateway           | `<name_prefix>-nat`                                                                     | Created only with `vpc_mode = "create"` and `enable_nat_gateway = true`    |
| VPC endpoints         | `<name_prefix>-s3`, `<name_prefix>-sqs`, `<name_prefix>-lambda`, `<name_prefix>-events` | Created only in `create` mode when the endpoint flag is enabled            |
| Worker security group | `<name_prefix>-worker-*`                                                                | Created when the worker uses a VPC and no existing groups are supplied     |

The worker code is deployed from
`s3://<artifacts_bucket>/<release>/render-worker.zip`. `release` is the release workflow's
SemVer tag or `sha-<short>`; a rollback applies an earlier release value.

## Prerequisites

- Terraform 1.11 or newer (S3 native lock files).
- The bootstrap stack applied and its outputs available.
- AWS credentials that can assume the deploy role, or an administrative profile for the first
  manual apply.
- A worker zip already uploaded to the artifacts bucket for the release being deployed.

> [!IMPORTANT]
> Re-apply `infra/bootstrap` before the first P-207 main apply. The deploy role now needs to manage
> the generated `<name_prefix>-caller` role, grant the EC2/VPC permissions used by the network
> module, and — when `worker_role_mode = "existing"` — `iam:PassRole` plus `iam:GetRole` on every
> ARN in `additional_worker_role_arns`. The previous bootstrap cannot create the caller role,
> validate a provided worker role's trust, or pass that role to Lambda.

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
# Edit: name_prefix, region, artifacts_bucket, deploy_role_arn, the role modes
# and the sender/callback values.
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

## Release workflow configuration

A GitHub-hosted checkout cannot see the gitignored `infra/terraform.tfvars`. Set the repository
variable `TF_VARS` to the full non-secret contents of `terraform.tfvars` (at minimum `name_prefix`,
sender/callback settings, alarms, tags and any non-default network settings). The release workflow
materializes it into `infra/terraform.tfvars` and fails closed when it is absent or empty.

Workflow-owned values override the file: `release`, `artifacts_bucket`, `region` and
`deploy_role_arn` are passed as `-var` after `-var-file`, so the deploy always targets the
computed release and the role actually assumed through OIDC.

Required repository variables:

| Variable              | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `TF_VARS`             | Non-secret operator values from `terraform.tfvars.example`  |
| `AWS_DEPLOY_ROLE_ARN` | Bootstrap deploy role assumed through GitHub OIDC           |
| `AWS_REGION`          | Deployment region, also used by the state backend and smoke |
| `TF_STATE_BUCKET`     | Bootstrap state bucket                                      |
| `ARTIFACTS_BUCKET`    | Bootstrap artifacts bucket                                  |
| `TF_STATE_KEY`        | Optional state key; defaults to `printer/terraform.tfstate` |

Operational notes:

- Run `workflow_dispatch` from `main`; the OIDC trust accepts only `refs/heads/main`.
- Branch protection/rulesets must allow the GitHub Actions token or a GitHub App to push the
  semantic-release `CHANGELOG.md` commit. Otherwise semantic-release fails before deploy.
- A rollback dispatch applies an existing release and skips build/upload; the artifact must already
  exist in the artifacts bucket.
- `pnpm smoke:test` requires `RELEASE` plus `AWS_REGION`, `JOBS_QUEUE_URL`,
  `SMOKE_QUEUE_URL` and `SMOKE_QUEUE_ARN`.

## Outputs

```sh
terraform -chdir=infra output
```

| Output                                    | Use                                                          |
| ----------------------------------------- | ------------------------------------------------------------ |
| `jobs_queue_url` / `jobs_queue_arn`       | Sending jobs and callback configuration                      |
| `jobs_dlq_url` / `jobs_dlq_arn`           | Inspecting or redriving failed jobs                          |
| `prints_bucket`                           | Operational inspection of transient PDFs                     |
| `smoke_queue_url` / `smoke_queue_arn`     | Release smoke polling and the `_smoke` job callback          |
| `function_name` / `function_alias_arn`    | Lambda inspection and the invoked `live` alias               |
| `caller_role_arn` / `caller_role_created` | Integrator role ARN and whether Terraform owns it            |
| `worker_role_arn` / `worker_role_created` | Worker execution role ARN and whether Terraform owns it      |
| `kms_key_arn`                             | Decrypt grants for operational tooling                       |
| `vpc_id`                                  | Worker VPC ID in `create`/`lookup`, otherwise null           |
| `worker_subnet_ids`                       | Worker subnet IDs in `create`/`lookup`, otherwise empty      |
| `worker_security_group_ids`               | Worker security groups in `create`/`lookup`, otherwise empty |

The release workflow reads `jobs_queue_url`, `smoke_queue_url` and `smoke_queue_arn` to run the
smoke script.

## Queue senders and smoke delivery

The jobs queue policy allows `sqs:SendMessage` only from:

- the generated or provided caller role ARN, always;
- `allowed_sender_account_ids` (each account root principal);
- `allowed_sender_principal_arns`;
- principals in `organization_id` via `aws:PrincipalOrgID`, when set.

The deploy role is deliberately **not** listed in the queue policy. The release smoke sends through
the deploy role's bootstrap IAM identity policy, which already grants `sqs:SendMessage` on
`<name_prefix>-jobs*`; no queue-policy exception is needed.

A provided caller role is added to the queue senders without modifying its IAM policy. That role
may be in another account: its own identity policy must allow `sqs:SendMessage`, and the queue
policy here names it as a principal. Cross-account callbacks still need a matching grant on the
target account's queue.

`callback_target_arns` accepts explicit SQS queue, Lambda function and EventBridge event bus ARNs.
Wildcard ARNs and the jobs queue ARN are rejected, and the smoke-results queue is always added
automatically. The worker may publish results only to those targets plus the smoke-results queue.
The generated worker policy grants `lambda:InvokeFunction`, `events:PutEvents` and
`sqs:SendMessage` on exactly those callback ARNs; it has no wildcard SQS send or jobs-queue send
permission. When `organization_id` is set, callback sends also carry an `aws:ResourceOrgID`
condition.

## Caller and worker roles

The caller and worker are separate roles by design. A shared role would let callers publish results
or the worker enqueue jobs, so the stack never merges their permissions.

### Caller role matrix

| Mode               | Terraform behaviour                                                                                    | Trust                                                              | Permissions                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `create` (default) | Creates `<name_prefix>-caller` and its inline policy; outputs `caller_role_arn`                        | `caller_trusted_principal_arns`, default the deployer account root | `sqs:SendMessage` only on the jobs queue                      |
| `existing`         | Uses `caller_role_arn`; adds it to the jobs queue senders; creates or modifies no IAM; outputs the ARN | Owner-managed; may be cross-account                                | Owner-managed; must allow `sqs:SendMessage` on the jobs queue |

### Worker role matrix

| Mode               | Terraform behaviour                                                                                                                     | Trust                                            | Permissions                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create` (default) | Creates `<name_prefix>-render-worker` and its inline policy; outputs `worker_role_arn`                                                  | `lambda.amazonaws.com`                           | Consume the jobs queue, read/write `prints/*`, KMS, logs, `lambda:InvokeFunction` / `events:PutEvents` / `sqs:SendMessage` on `callback_target_arns`, smoke-queue send, VPC ENIs when configured |
| `existing`         | Uses the same-account `worker_role_arn` for Lambda, the KMS key policy and the smoke queue; creates or modifies no IAM; outputs the ARN | Owner-managed; must trust `lambda.amazonaws.com` | Owner-managed; must be equivalent to the generated policy                                                                                                                                        |

`caller_role_created` and `worker_role_created` report which path Terraform took.

Validation rules:

- `caller_role_mode` and `worker_role_mode` accept only `create` or `existing`.
- `create` rejects a non-null `caller_role_arn` or `worker_role_arn`.
- `existing` requires the matching ARN.
- Provided ARNs must be IAM role ARNs.
- A provided worker role must be in the current account; Lambda execution roles cannot be
  cross-account. A provided caller role may be cross-account because the generated queue policy
  names it directly.
- The caller and worker must not resolve to the same role; a shared role would merge their
  permissions.

Provided-role responsibilities:

- Terraform reads a provided worker role with `iam:GetRole` and rejects the plan when the role does
  not exist or its trust policy does not allow `lambda.amazonaws.com`. It cannot verify that the
  role's attached or inline permissions match the generated policy, or that they stay drift-free.
  The owner supplies and maintains those permissions. A provided caller role is not read or
  validated beyond its ARN shape and queue-policy insertion.
- The provided caller role must allow `sqs:SendMessage` on `<name_prefix>-jobs`. The stack adds the
  role ARN to the queue policy but does not attach an identity policy.
- The provided worker role must allow the generated policy's actions: jobs-queue consume, the
  `prints/*` object actions, KMS decrypt/generate-data-key on `kms_key_arn`, log writes, the
  callback actions on `callback_target_arns`, smoke-queue send, and the Lambda VPC ENI actions
  when `vpc_mode` is not `none`.
- When the worker role is provided, add its ARN to `additional_worker_role_arns` in
  `infra/bootstrap/terraform.tfvars` and re-apply bootstrap before applying this stack. The deploy
  role otherwise cannot `iam:PassRole` it to Lambda or read it for trust validation.

The generated caller role trusts the deployer account root by default. Set
`caller_trusted_principal_arns` to the integrator account root, IAM role or IAM user ARNs to
narrow or extend that trust. This list is ignored in `existing` mode.

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

## PDF/A defaults

`pdfa_allowed_levels` defaults to all eight levels (`PDF/A-1b/1a`, `2b/2u/2a`, `3b/3u/3a`). The
setting only takes effect once the P-202/P-204/P-209 renderer, archiver and channel work is
deployed; before that the worker does not honour PDF/A requests.

## Network

Networking is optional. `vpc_mode` defaults to `"none"`: the worker runs outside a VPC and reaches
SQS, S3, KMS and callback endpoints without NAT, subnets or VPC endpoints. `create` builds a VPC;
`lookup` attaches the worker to an existing one. In both non-`none` modes, the Lambda gets a
`vpc_config` with `subnet_ids` and `worker_security_group_ids`; in `none` it has no `vpc_config`.

| Mode     | What the module does                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`   | Creates nothing network-related. This is the safe default and the lowest-cost option.                                                                                                                                               |
| `create` | Creates a VPC (`vpc_cidr`, `az_count`), private subnets, an S3 gateway endpoint and SQS/Lambda/Events interface endpoints. Public subnets, an internet gateway and one NAT gateway are added only with `enable_nat_gateway = true`. |
| `lookup` | Resolves an existing VPC by `vpc_id` or `vpc_tags`, and subnets by `subnet_ids` or `subnet_tags`. Creates no VPC. A managed worker security group is created unless `worker_security_group_ids` is supplied.                        |

For `lookup`, provide exactly one of `vpc_id` or `vpc_tags`, and exactly one of `subnet_ids` or
`subnet_tags`. Tags are matched as `tag:<key>` filters; the data sources resolve at plan/apply time
and therefore need read access to the VPC and subnets.

### Create mode example

```hcl
vpc_mode           = "create"
vpc_cidr           = "10.0.0.0/16"
az_count           = 2
enable_nat_gateway = false
```

Private subnets have no default route unless `enable_nat_gateway = true`. The worker security group
allows outbound DNS (UDP/TCP 53) and HTTPS (TCP 443). Interface endpoints are reachable through
that egress, and their own security group accepts 443 from the worker group. The S3 gateway
endpoint is attached to the private route table.

### Lookup mode example

```hcl
vpc_mode   = "lookup"
vpc_id     = "vpc-0123456789abcdef0"
subnet_ids = ["subnet-0123456789abcdef0", "subnet-0fedcba9876543210"]
# vpc_tags    = { Environment = "shared" }
# subnet_tags = { Tier = "private" }
# worker_security_group_ids = ["sg-0123456789abcdef0"]
```

When `worker_security_group_ids` is empty, the module creates a worker security group in the
looked-up VPC. Supply existing groups to reuse an operator-managed egress policy instead.

> [!WARNING]
> Lookup mode only attaches the worker. The existing VPC must already provide connectivity to S3,
> SQS, Lambda and EventBridge through gateway/interface endpoints or a NAT gateway. Otherwise the
> worker attaches successfully but cannot reach AWS services.

### Endpoint and NAT trade-offs

- **No NAT (default):** no hourly NAT or public IPv4 cost. `http` callbacks can reach only private
  hosts routable from the VPC, and AWS service calls use the S3 gateway plus SQS/Lambda/Events
  interface endpoints.
- **NAT (`enable_nat_gateway = true`):** adds public subnets, an internet gateway, an Elastic IP and
  one NAT gateway. This enables `http` callbacks to public hosts. NAT gateways are billed hourly
  plus data processing, and the public IPv4 address is billed separately.
- **S3 gateway endpoint:** free; keeps S3 traffic on the AWS network.
- **SQS/Lambda/Events interface endpoints:** billed hourly per AZ and per GB processed. Disable an
  endpoint with `enable_sqs_endpoint`, `enable_lambda_endpoint` or `enable_events_endpoint` when the
  worker does not use that service, or when a NAT gateway already covers it.
- Endpoints and NAT are only created in `create` mode. In `lookup` mode they belong to the existing
  VPC and its operator.

`availability_zones` can pin create mode to specific AZ names; when empty the module uses the
region's enabled zones. The list must contain distinct names, and `az_count` must not exceed the
available or supplied zones; otherwise the plan fails with a clear precondition. `vpc_cidr` must
be a canonical IPv4 network address with a `/16` to `/24` prefix, for example `10.0.0.0/16`.

Applying `create` or `lookup` needs EC2/VPC management permissions for VPCs, subnets, route
tables, gateways, endpoints, security groups and Elastic IPs. The bootstrap deploy role now grants
a curated EC2 set:

- create calls use `Resource: "*"` because the resource does not exist yet, gated on
  `aws:RequestTag/Project`;
- configure and delete calls are scoped to the project EC2 resource ARNs and require
  `aws:ResourceTag/Project`; this includes `security-group-rule/*` and
  `ec2:ModifySecurityGroupRules`;
- tag-on-create is limited to the project's create actions and security-group rule authorization
  calls, and both tag-on-create and tag updates restrict `aws:TagKeys` to the finite project tag
  set (`Project`, `Name`, `Tier` plus bootstrap `tags` keys);
- tag updates require the resource to already carry `Project` via `aws:ResourceTag/Project`;
- every EC2 statement carries `aws:RequestedRegion = var.region`;
- `Describe*` calls, including `ec2:DescribePrefixLists` needed for VPC endpoints, use
  `Resource: "*"` because EC2 has no resource-level authorization for them.

The comment block in `infra/bootstrap/iam.tf` records these choices. Bootstrap `tags` must include
every additional tag key the main deployment applies to network resources; otherwise the tag key
allowlist denies the apply. The worker VPC execution role is complete: when `vpc_mode` is `create`
or `lookup` it includes the Lambda Hyperplane ENI permissions (`ec2:CreateNetworkInterface`,
`ec2:DescribeNetworkInterfaces`, `ec2:DescribeSubnets`, `ec2:DeleteNetworkInterface`,
`ec2:AssignPrivateIpAddresses` and `ec2:UnassignPrivateIpAddresses`).

## Local checks

```sh
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
tflint --chdir=infra --config="$PWD/tflint.hcl" --call-module-type=all
```

`init -backend=false` does not contact the state bucket; use the backend init command above before
any plan or apply.
