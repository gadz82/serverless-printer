# Cloud verification

This is the first-deployment and rollback checklist for the single Printer stack. It is written
for an operator with the bootstrap state bucket, an AWS account and a GitHub repository with
Actions enabled. Run the steps in order and record the evidence fields at the end without pasting
secrets.

## Evidence to collect

Record these for every verification or rollback:

| Field                | Example                                                |
| -------------------- | ------------------------------------------------------ |
| AWS account / region | `123456789012` / `eu-central-1`                        |
| Git commit           | `git rev-parse HEAD`                                   |
| Release              | `v1.2.3` or `sha-abcdef0`                              |
| Workflow run         | `https://github.com/<owner>/<repo>/actions/runs/<id>`  |
| Bootstrap applied    | date and commit of `infra/bootstrap`                   |
| Role modes           | caller `create`/`existing`, worker `create`/`existing` |
| VPC mode             | `none`, `create` or `lookup`                           |
| Artifact             | `s3://<artifacts>/<release>/render-worker.zip`, size   |
| Smoke refIds         | plain and PDF/A-2b                                     |
| Rollback release     | previous release label and result                      |
| Load/Power Tuning    | memory, concurrency, jobs/min, 20-page p95             |
| Alarms               | enabled or disabled; SNS test result                   |
| Operator / approver  | names or handles                                       |

## 1. Prepare operator files

Start from the examples so the bootstrap and main deployment agree on `name_prefix`, `region`,
tags and the state/artifacts bucket names:

```sh
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Edit both files: set github_owner/github_repo in bootstrap, and the same
# name_prefix/region/tags plus sender/callback, role and VPC settings in the main file.
```

The bootstrap defaults the state bucket to `<name_prefix>-tfstate`; if you override
`state_bucket_name` there, use that value below. Keep both tfvars files local and out of commits.

## 2. Bootstrap and IAM foundation

The bootstrap stack creates the state bucket, artifacts bucket and GitHub OIDC deploy/plan roles.
Apply it before the first main apply. Re-apply it when bootstrap code changes (the current version
adds the generated caller role and EC2/VPC permissions) or when inputs change, notably
`additional_worker_role_arns`.

```sh
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output

export STATE_BUCKET="$(terraform -chdir=infra/bootstrap output -raw state_bucket)"
export ARTIFACTS_BUCKET="$(terraform -chdir=infra/bootstrap output -raw artifacts_bucket)"
export DEPLOY_ROLE_ARN="$(terraform -chdir=infra/bootstrap output -raw deploy_role_arn)"
export PLAN_ROLE_ARN="$(terraform -chdir=infra/bootstrap output -raw plan_role_arn)"
```

Bootstrap uses local state by design. Encrypt or store `infra/bootstrap/terraform.tfstate` in the
team's secret store after the apply; never commit it. `terraform.tfvars` and the plan file are also
ignored.

`infra/bootstrap/README.md` documents the inputs and outputs. The deploy role also needs:

- `iam:PassRole` and `iam:GetRole` on every ARN in `additional_worker_role_arns` when a provided
  worker role is used;
- the curated EC2/VPC permissions for `vpc_mode = "create"` or `"lookup"`;
- permission to create/manage the generated `<name_prefix>-caller` role.

Re-apply bootstrap after changing `additional_worker_role_arns`; otherwise the first main apply
fails with `AccessDenied` before or during the Lambda update. Do not add static AWS keys.

## 3. Repository variables

Set the non-secret repository variables under **Settings → Secrets and variables → Actions →
Variables**. `TF_VARS` is the full non-secret content of `infra/terraform.tfvars`; never put AWS
keys or other secrets in it.

```sh
gh variable set AWS_REGION --body "${AWS_REGION:-eu-central-1}"
gh variable set AWS_DEPLOY_ROLE_ARN --body "$DEPLOY_ROLE_ARN"
gh variable set AWS_PLAN_ROLE_ARN --body "$PLAN_ROLE_ARN"
gh variable set TF_STATE_BUCKET --body "$STATE_BUCKET"
gh variable set ARTIFACTS_BUCKET --body "$ARTIFACTS_BUCKET"
# Optional; defaults to printer/terraform.tfstate.
gh variable set TF_STATE_KEY --body "printer/terraform.tfstate"
gh variable set TF_VARS --body "$(cat infra/terraform.tfvars)"
```

`AWS_PLAN_ROLE_ARN` enables the pull-request `Terraform plan` job; that job also requires
`AWS_REGION` and a same-repository PR (forks show a skipped notice). The release workflow skips
release/deploy with a notice when none of the deployment variables are set, and fails closed when
the configuration is partial. Keep `infra/terraform.tfvars` local and out of commits.

`TF_VARS` must contain the operator values from
[`infra/terraform.tfvars.example`](../infra/terraform.tfvars.example): `name_prefix`, `region`,
`artifacts_bucket`, `deploy_role_arn`, sender/callback settings, role modes, VPC mode, alarms,
tags and the selected `pdfa_allowed_levels`. Include `PDF/A-2b` because the release smoke requests
it; the Terraform defaults include all eight levels.

## 4. Role modes and provided roles

The caller and worker are separate roles; never point both modes at the same role.

| Mode                      | Terraform behaviour                                                                                                                                    | Prerequisites                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller `create` (default) | Creates `<name_prefix>-caller` trusting `caller_trusted_principal_arns` (default deployer account root), with `sqs:SendMessage` only on the jobs queue | None beyond bootstrap                                                                                                                                                   |
| Caller `existing`         | Adds `caller_role_arn` to the jobs queue senders; does not create or modify IAM                                                                        | The owner allows `sqs:SendMessage` on `<name_prefix>-jobs`; cross-account callers also need their own assume-role grant and trust                                       |
| Worker `create` (default) | Creates `<name_prefix>-render-worker` trusting `lambda.amazonaws.com` and the generated consume/prints/KMS/logs/channel policy                         | None beyond bootstrap                                                                                                                                                   |
| Worker `existing`         | Uses the same-account `worker_role_arn` for Lambda, KMS and the smoke queue; does not modify IAM                                                       | Same account, trust `lambda.amazonaws.com`, permissions equivalent to the generated policy, and the ARN in bootstrap `additional_worker_role_arns` + bootstrap re-apply |

The plan validates a provided worker role's existence and trust with `iam:GetRole`; it cannot
verify that its policies stay equivalent to the generated policy. See the
[full role matrices](../infra/README.md#caller-and-worker-roles) for the exact permissions.

Inspect a provided role before planning:

```sh
aws iam get-role --role-name "<worker-role-name>" \
  --query 'Role.AssumeRolePolicyDocument.Statement[].Principal'
aws iam list-attached-role-policies --role-name "<worker-role-name>"
aws iam list-role-policies --role-name "<worker-role-name>"
```

Negative checks are useful before an apply: a missing worker ARN, a wrong-account worker ARN, a
worker role that does not trust `lambda.amazonaws.com`, or the same ARN for caller and worker must
all fail `terraform plan`.

## 5. VPC modes and permissions

`vpc_mode` defaults to `none`. Choose one mode per deployment; there are no environments.

| Mode     | What to verify                                                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`   | No `vpc_config` on the function; worker reaches SQS/S3/KMS and callbacks over the AWS network/internet                                                                                                                                                                                             |
| `create` | Bootstrap deploy role has the EC2/VPC permissions; subnets, endpoints, optional NAT and worker security group are created; the worker can reach SQS, S3, Lambda and EventBridge from every selected AZ. S3 performs KMS operations service-side; direct KMS calls need NAT or private connectivity |
| `lookup` | The existing VPC already provides endpoint/NAT connectivity; exactly one of `vpc_id`/`vpc_tags` and one of `subnet_ids`/`subnet_tags`; existing egress groups or the managed worker group                                                                                                          |

The create-mode bootstrap permissions are scoped by the `Project = <name_prefix>` tag and
`aws:RequestedRegion`; review `infra/bootstrap/iam.tf` before changing tags or the region. After
apply:

```sh
aws lambda get-function-configuration \
  --function-name "$(terraform -chdir=infra output -raw function_name)" \
  --query '{VpcConfig:VpcConfig,Runtime:Runtime,Architectures:Architectures,MemorySize:MemorySize,Timeout:Timeout}'
```

For `create` with `enable_nat_gateway = false`, confirm the S3 gateway endpoint and the
SQS/Lambda/Events interface endpoints exist and their security groups allow 443 from the worker:

```sh
aws ec2 describe-vpc-endpoints --filters "Name=tag:Project,Values=<name_prefix>" \
  --query 'VpcEndpoints[].{Service:ServiceName,State:State,Subnets:SubnetIds}'
aws ec2 describe-route-tables --filters "Name=tag:Project,Values=<name_prefix>" \
  --query 'RouteTables[].Routes'
```

For `lookup`, the stack does not create endpoints; a missing route appears as a worker timeout.

### EventBridge ingress (optional)

If `job_rule` is set, verify the rule and target after apply:

```sh
aws events describe-rule --name "<name_prefix>-jobs" --event-bus-name "<bus_name>"
aws events list-targets-by-rule --rule "<name_prefix>-jobs" --event-bus-name "<bus_name>" \
  --query 'Targets[].{Id:Id,Arn:Arn,InputPath:InputPath}'
```

`InputPath` must be `$.detail`; the event detail must be a valid print-job body. Send one test event
whose `detail` is a contract-valid job (using the documented template, refId and SQS/webhook
callback), then confirm the normal result path. Confirm the queue policy names
`events.amazonaws.com` with the rule ARN in `aws:SourceArn`, and record the rule ARN, bus, event
pattern and test refId in the evidence record. If `job_rule` is null, record it as intentionally
disabled.

## 6. Branch protection and required checks

`main` must require these CI checks before merge:

- `Quality and contracts`
- `Template validation`
- `LocalStack integration`
- `Render regression`
- `Terraform validation`
- `Commit conventions`

`Terraform plan` is conditional on `AWS_PLAN_ROLE_ARN`, `AWS_REGION` and a same-repository pull
request; forks get a skipped notice. Add it as a required check only if it runs for every change,
otherwise fork PRs can block. Also require pull requests, squash merges and linear history on
`main` ([specification](specification.md) §7.2). The render-regression job installs poppler-utils and uses the real Lambda
Chromium, so it must not be skipped by a path filter. If the optional `orchid-sdd` workflow is
enabled, require its `validate` check too.

Inspect the current protection/rulesets:

```sh
gh api repos/{owner}/{repo}/branches/main/protection
gh api repos/{owner}/{repo}/rulesets
```

The release workflow runs semantic-release on every push to `main` and pushes a `CHANGELOG.md`
commit with `GITHUB_TOKEN` (`[skip ci]`). If the ruleset requires pull requests or signed commits,
allow the GitHub Actions bot (or the GitHub App used by semantic-release) to bypass the ruleset
for that push. Without the bypass, semantic-release fails before the build/deploy steps. Do not
disable protection for humans just to make the bot work.

## 7. First apply and smoke

The release workflow is the normal path: a push to `main` computes the release, builds
`dist/render-worker.zip` (including Chromium and the s3 ICC profile), uploads it, applies
Terraform through OIDC, then runs both smoke jobs. To trigger it manually:

```sh
gh workflow run release.yml --ref main
gh run list --workflow=release.yml --limit 1
gh run watch <run-id>
```

Before the smoke, confirm the artifact and outputs:

```sh
RELEASE="v1.2.3" # or the sha-<short> release the workflow used
aws s3api head-object \
  --bucket "$ARTIFACTS_BUCKET" \
  --key "${RELEASE}/render-worker.zip" \
  --query '{Size:ContentLength,Version:VersionId}'
terraform -chdir=infra output jobs_queue_url
terraform -chdir=infra output smoke_queue_url
terraform -chdir=infra output smoke_queue_arn
terraform -chdir=infra output function_alias_arn
```

The zip is about 74 MB; it exceeds the 50 MB direct-upload limit, so it must be uploaded to S3.
The worker payload is under the 250 MB unzipped Lambda limit and the function runs `nodejs24.x`,
`x86_64`, with the published `live` alias.

### Manual smoke

The release workflow runs `scripts/smoke-test.mjs` automatically. To rerun it manually:

```sh
export AWS_REGION="eu-central-1" # replace with the deployment region
export RELEASE="v1.2.3" # the deployed release
export JOBS_QUEUE_URL="$(terraform -chdir=infra output -raw jobs_queue_url)"
export SMOKE_QUEUE_URL="$(terraform -chdir=infra output -raw smoke_queue_url)"
export SMOKE_QUEUE_ARN="$(terraform -chdir=infra output -raw smoke_queue_arn)"

pnpm smoke:test
```

Expected output has both lines and exits 0:

```
Smoke plain OK: template=_smoke@<release> pdfA=null sizeBytes=... sha256=...
Smoke pdfa-2b OK: template=_smoke@<release> pdfA=PDF/A-2b sizeBytes=... sha256=...
```

Record both generated refIds and the result hashes/sizes in the evidence record. Both jobs use the
success and failure SQS callbacks. The script waits for both refIds before asserting; a failure
result fails the step once both arrive, and a missing result fails at the timeout.

## 8. Rollback

Dispatch the release workflow with an earlier release label. Rollback skips versioning/build and
applies the existing artifact, then runs both smoke jobs.

```sh
gh workflow run release.yml --ref main -f release=v1.2.3
gh run watch <run-id>
```

Prerequisites:

- The artifact `s3://$ARTIFACTS_BUCKET/v1.2.3/render-worker.zip` exists.
- The target release contains the `_smoke` manifest and supports PDF/A-2b; a release predating
  those features fails the PDF/A smoke by design.
- `TF_VARS` and the Terraform state are unchanged except for the release being deployed.

After the workflow, confirm the alias points at the rollback version:

```sh
aws lambda get-alias \
  --function-name "$(terraform -chdir=infra output -raw function_name)" \
  --name live \
  --query '{Version:FunctionVersion,Description:Description}'
```

Record the rollback release and both smoke results. Use
[`docs/runbook.md`](runbook.md#rollback) for the manual Terraform path if the workflow is
unavailable.

## 9. Alarms and operations

Alarms are opt-in:

```hcl
enable_alarms       = true
alarm_sns_topic_arn = "arn:aws:sns:eu-central-1:123456789012:printer-alerts"
```

The SNS topic must exist in the deployment region and allow `cloudwatch.amazonaws.com` to
publish (and its KMS key policy must allow the same if encrypted). Test the notification path
before relying on it:

```sh
aws cloudwatch set-alarm-state \
  --alarm-name "<name_prefix>-jobs-dlq-depth" \
  --state-value ALARM \
  --state-reason "first-deployment verification"
```

Confirm the subscription received the message, then clear the manual state:

```sh
aws cloudwatch set-alarm-state \
  --alarm-name "<name_prefix>-jobs-dlq-depth" \
  --state-value OK \
  --state-reason "first-deployment verification complete"
```

Record whether alarms are enabled and the SNS test result. Use
[`docs/runbook.md`](runbook.md) for DLQ redrive, template removal/`TEMPLATE_NOT_FOUND`, KMS/state
recovery, role failures and VPC operations.

## 10. Throughput and Power Tuning evidence

After the first successful deploy, run the load test off-peak. The harness, matrix, memory
collection and Power Tuning steps are in [`docs/load-test.md`](load-test.md). Record at least:

- worker release and function version;
- `worker_memory_size`, `maximum_concurrency`, `batch_size`, `reserved_concurrency`;
- job mix and sample count (`LOAD_TEST_JOBS`);
- mixed throughput, **20-page throughput**, 20-page p95, errors;
- p50/p95/max `Max Memory Used`;
- Power Tuning memory candidates, average duration/cost, chosen memory;
- the confirmed target (or the decision to keep the candidate 10 20-page jobs/min, p95 < 30 s).

Apply measured values through `TF_VARS` and redeploy; do not edit a local tfvars file and assume
the release workflow will use it. Re-run the load test with `LOAD_TEST_ENFORCE_TARGET=1` after the
target is confirmed.

## 11. Closeout

- [ ] Bootstrap outputs match the repository variables.
- [ ] Deploy role OIDC works from `main`; no static keys.
- [ ] Branch protection requires the checks listed in section 6 and the release bot can push `CHANGELOG.md`.
- [ ] Caller/worker role modes and provided-role prerequisites are recorded.
- [ ] VPC mode and endpoint/NAT reachability are verified (or `none` is intentional).
- [ ] Optional EventBridge ingress is verified end to end, or recorded as intentionally disabled.
- [ ] Worker artifact is present, under the Lambda limits and deployed to the `live` alias.
- [ ] Plain and PDF/A-2b smoke jobs pass with the deployed release.
- [ ] Rollback dispatch passes both smoke jobs.
- [ ] Alarms are intentionally enabled with a tested SNS path, or intentionally disabled.
- [ ] Load/Power Tuning evidence and the confirmed target are recorded.
- [ ] The evidence table is attached to the release/change record without secrets.
