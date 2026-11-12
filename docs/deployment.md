# Deployment

Printer is one Terraform deployment and one GitHub release workflow. There are no environments,
workspaces, databases or static AWS keys.

## Prerequisites

- Terraform 1.11 or newer and AWS administrator credentials for bootstrap.
- A GitHub repository with Actions enabled and OIDC allowed.
- Node.js 24 and pnpm 10.34.9 for local checks.
- An existing SNS topic only if alarms are enabled.

## 1. Bootstrap once

`infra/bootstrap` creates the state bucket, artifacts bucket, GitHub OIDC provider and the deploy
and plan roles. It uses local state; keep it out of Git and store it securely.

```sh
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
# Set github_owner, github_repo and the same name_prefix/region/tags as the main stack.
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output
```

Re-apply bootstrap after bootstrap code changes (caller role, EC2/VPC permissions, EventBridge
permissions) or after changing `additional_worker_role_arns`.

## 2. Configure the deployment

```sh
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Edit name_prefix, region, artifacts_bucket, deploy_role_arn, sender/callback values,
# role modes, VPC mode, alarms, capacity and optional EventBridge ingress.
```

Read `artifacts_bucket` and `deploy_role_arn` from the bootstrap outputs. Keep the file out of
commits.

For CI releases, set the GitHub repository variables (Settings → Secrets and variables → Actions →
Variables):

| Variable              | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `TF_VARS`             | Full non-secret contents of `terraform.tfvars`    |
| `AWS_DEPLOY_ROLE_ARN` | Bootstrap deploy role                             |
| `AWS_PLAN_ROLE_ARN`   | Bootstrap read-only plan role                     |
| `AWS_REGION`          | Deployment region                                 |
| `TF_STATE_BUCKET`     | Bootstrap state bucket                            |
| `ARTIFACTS_BUCKET`    | Bootstrap artifacts bucket                        |
| `TF_STATE_KEY`        | Optional; defaults to `printer/terraform.tfstate` |

The release workflow runs a preflight check before releasing. When **none** of the deployment
variables are set, it skips release/deploy with a notice so pushes to `main` stay green before the
first deployment. A **partial** configuration fails closed with the missing variable names. When
the configuration is complete, the workflow materializes `TF_VARS` into `infra/terraform.tfvars`
and deploys. Never put secrets in `TF_VARS`.

## Deployment options

### Network (`vpc_mode`)

| Mode             | Behavior                                                                                                                   | Use when                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `none` (default) | Worker runs outside a VPC; AWS and HTTP callbacks use the AWS network/internet                                             | Lowest cost and simplest operation                   |
| `create`         | Creates a VPC, private subnets, S3 gateway and SQS/Lambda/Events interface endpoints; optional public subnets, IGW and NAT | You need private HTTP callbacks or network isolation |
| `lookup`         | Attaches the worker to an existing VPC/subnets and managed or supplied security groups                                     | You already own the network                          |

`lookup` requires exactly one of `vpc_id`/`vpc_tags` and one of `subnet_ids`/`subnet_tags`. In
`create`/`lookup` the Lambda gets a `vpc_config`; in `none` it has none. HTTP callbacks outside the
VPC need NAT; S3/KMS traffic through S3 is service-side, but direct KMS calls need connectivity.

### Caller and worker roles

| Role   | Mode               | Behavior                                                                                                                                          |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller | `create` (default) | Creates `<name_prefix>-caller`, trusts `caller_trusted_principal_arns` (default deployer account root), `sqs:SendMessage` only on the jobs queue  |
| Caller | `existing`         | Adds `caller_role_arn` to the queue senders without modifying IAM; the role owner must allow `sqs:SendMessage`; cross-account callers are allowed |
| Worker | `create` (default) | Creates `<name_prefix>-render-worker` trusting `lambda.amazonaws.com` with consume/prints/KMS/logs/channel permissions                            |
| Worker | `existing`         | Uses a same-account `worker_role_arn` for Lambda/KMS/smoke; the role must trust Lambda and have equivalent permissions                            |

A provided worker role also needs its ARN in bootstrap `additional_worker_role_arns` (PassRole and
GetRole) and a bootstrap re-apply. The plan validates the role exists and trusts
`lambda.amazonaws.com`; it cannot verify policy equivalence. Never point caller and worker at the
same role.

### Capacity

| Input                  | Default | Effect                                                |
| ---------------------- | ------- | ----------------------------------------------------- |
| `worker_memory_size`   | 1536 MB | Lambda memory; tune with [Power Tuning](load-test.md) |
| `batch_size`           | 5       | Records per invocation; 1–5, rendered sequentially    |
| `maximum_concurrency`  | 10      | SQS event-source concurrency; minimum 2               |
| `reserved_concurrency` | unset   | Optional cap on the function                          |
| `max_receive_count`    | 5       | Receives before the DLQ                               |

Start at the defaults and change them only with measured load/Power Tuning evidence.

### Alarms

`enable_alarms = false` by default. To enable the DLQ-depth and worker-error alarms, set
`enable_alarms = true` and `alarm_sns_topic_arn` to an existing topic in the deployment region.
Terraform does not create the SNS topic or subscriptions; the topic policy must allow
`cloudwatch.amazonaws.com` to publish (and its KMS key policy if encrypted). See the
[runbook](runbook.md#alarm-definitions-and-response).

### Optional EventBridge ingress

Set `job_rule` to forward matching events from an existing bus to the jobs queue:

```hcl
job_rule = {
  bus_name      = "default"
  event_pattern = "{\"source\":[\"my.billing\"],\"detail-type\":[\"Invoice Ready\"]}"
}
```

The target uses `input_path = "$.detail"`, so the event detail must be a complete job body.
EventBridge caps events at 256 KB; `{}` matches all events. The queue policy allows
`events.amazonaws.com` only from the rule ARN. Re-apply bootstrap before enabling it (deploy-role
EventBridge permissions). Cross-account buses and scheduling are out of scope.

## Release and rollback

The normal path is a push to `main`:

1. semantic-release computes a SemVer tag or `sha-<short>` release.
2. The worker zip (Chromium + templates + manifest) is built and uploaded to the artifacts bucket.
3. Terraform applies through OIDC with the release label.
4. Plain and PDF/A-2b `_smoke` jobs run and must both pass.
5. The manifest is attached to the SemVer GitHub Release.

Manual dispatch:

```sh
gh workflow run release.yml --ref main
gh run watch <run-id>
```

Rollback dispatches the same workflow with an earlier release label; build/upload are skipped and
the existing artifact is applied, then both smoke jobs run:

```sh
gh workflow run release.yml --ref main -f release=v1.2.3
```

The artifact must already exist and the release must support PDF/A-2b or the PDF/A smoke will fail
by design. See [Cloud verification](cloud-verification.md#8-rollback) for the full evidence checklist.

## First deployment

Follow [Cloud verification](cloud-verification.md): bootstrap outputs, repository variables,
branch protection, role/VPC checks, release, both smoke jobs, rollback and alarm/load evidence. Do
not mark the deployment verified until the live checks exist.

## Related guides

- [Architecture](architecture.md)
- [Usage and job contract](usage.md)
- [Templates](templates.md)
- [Operations runbook](runbook.md)
- [Load test and Power Tuning](load-test.md)
- [Infrastructure README](../infra/README.md)
- [Bootstrap README](../infra/bootstrap/README.md)
