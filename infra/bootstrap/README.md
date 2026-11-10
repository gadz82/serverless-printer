# Bootstrap

One-time Terraform root module that creates the foundation the main deployment and the GitHub
Actions release path need. It is applied by an operator with an administrative AWS profile, uses
local state, and is never run by CI (ADR-004).

## What it creates

- `${name_prefix}-tfstate`: the S3 bucket for the main deployment's Terraform state. Versioned,
  encrypted with SSE-S3, public access blocked, ACLs disabled.
- `${name_prefix}-artifacts`: the release artifact bucket. Versioned, encrypted with SSE-S3,
  public access blocked, ACLs disabled. Releases upload `render-worker.zip` as
  `<release>/render-worker.zip`.
- The GitHub OIDC provider `token.actions.githubusercontent.com`, created or looked up.
- `${name_prefix}-deploy`: the deployment role. GitHub can assume it only from
  `repo:<github_owner>/<github_repo>:ref:refs/heads/main`.
- `${name_prefix}-plan`: the read-only plan role. GitHub can assume it only from
  `repo:<github_owner>/<github_repo>:pull_request`.

The state and artifacts buckets and both roles live outside the main deployment's lifecycle, so a
`terraform destroy` in `infra/` cannot remove them.

## Prerequisites

- Terraform 1.11 or newer.
- AWS credentials for an administrator in the target account and region. The OIDC roles created
  here cannot bootstrap the state bucket they depend on.
- The GitHub organization/user and repository name.
- Globally unique S3 bucket names. The defaults are `<name_prefix>-tfstate` and
  `<name_prefix>-artifacts`; override them with `state_bucket_name` and `artifacts_bucket_name` if
  they are already taken.

There is no VPC, application resource or environment in this root module.

## Apply

```sh
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
# Edit terraform.tfvars: set github_owner and github_repo.
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
```

`terraform.tfvars`, the plan file and the state file are ignored by Git. Keep them out of commits
and shared chat.

> [!IMPORTANT]
> Re-apply bootstrap before the first main apply. This version adds management of the
> generated `<name_prefix>-caller` role, the EC2/VPC permissions required by the network module,
> and — for provided worker roles — `iam:PassRole` plus `iam:GetRole` through
> `additional_worker_role_arns`. The previous deploy role cannot create the caller role or
> validate/pass a provided worker role.

If the account already has the GitHub OIDC provider, set `create_oidc_provider = false`. The
module then looks up `token.actions.githubusercontent.com` instead of creating a duplicate. The
existing provider must trust the `sts.amazonaws.com` audience.

## Provided worker roles

The deploy role can pass its generated worker roles to Lambda. When the main deployment uses
`worker_role_mode = "existing"`, add the provided role ARN to `additional_worker_role_arns` in
`infra/bootstrap/terraform.tfvars` and re-apply bootstrap. The variable accepts only explicit
same-account, same-partition IAM role ARNs without wildcards. Bootstrap grants `iam:GetRole` on
those ARNs so the main stack can validate that the role exists and trusts `lambda.amazonaws.com`,
and `iam:PassRole` so Lambda can use it. Provided roles are not modified. The GitHub OIDC trust
policy is unchanged.

## Outputs

```sh
terraform -chdir=infra/bootstrap output
```

| Output              | Use                                                                |
| ------------------- | ------------------------------------------------------------------ |
| `state_bucket`      | `TF_STATE_BUCKET` repository variable and the main backend bucket  |
| `artifacts_bucket`  | `ARTIFACTS_BUCKET` repository variable and the worker zip location |
| `deploy_role_arn`   | `AWS_DEPLOY_ROLE_ARN` repository variable                          |
| `plan_role_arn`     | `AWS_PLAN_ROLE_ARN` repository variable                            |
| `oidc_provider_arn` | Reference for the two role trust policies                          |

The main deployment uses the state bucket with S3 native locking, key
`printer/terraform.tfstate`:

```sh
terraform -chdir=infra init \
  -backend-config="bucket=$(terraform -chdir=infra/bootstrap output -raw state_bucket)" \
  -backend-config="key=printer/terraform.tfstate" \
  -backend-config="region=eu-central-1"
```

## Secure state storage

Bootstrap intentionally uses local state because the state bucket does not exist yet (ADR-004).

1. After a successful apply, encrypt `infra/bootstrap/terraform.tfstate` and store it in the
   team's secret store (for example 1Password, Vault or an encrypted operations bucket with
   restricted access). The file contains resource identifiers and configuration, not application
   secrets, but it is still sensitive.
2. Never commit `terraform.tfstate`, `terraform.tfstate.backup`, a plan file or
   `terraform.tfvars`. The local `.gitignore` covers them.
3. Keep the stored state until the bootstrap resources are intentionally decommissioned. Losing
   it requires re-importing the buckets, OIDC provider and roles.
4. Do not run `terraform destroy` here to "reset" an environment. It would delete the state and
   artifacts buckets and both GitHub roles; the main deployment would lose its backend and release
   path.

## GitHub repository variables

Set these as repository variables (not secrets) in the GitHub repository settings:

| Variable              | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| `AWS_REGION`          | `region` from `terraform.tfvars`, default `eu-central-1` |
| `AWS_DEPLOY_ROLE_ARN` | `deploy_role_arn` output                                 |
| `AWS_PLAN_ROLE_ARN`   | `plan_role_arn` output                                   |
| `TF_STATE_BUCKET`     | `state_bucket` output                                    |
| `TF_STATE_KEY`        | `printer/terraform.tfstate`                              |
| `ARTIFACTS_BUCKET`    | `artifacts_bucket` output                                |

Workflows use GitHub OIDC and these role ARNs; they must not use static AWS access keys.

## Deploy role scope and naming contract

The deploy role has no administrator policy. Its inline policy is limited to:

- read/write on the state bucket and read/write on the artifacts bucket;
- bucket configuration on the prints bucket, named with the prefix
  `<name_prefix>-prints`;
- the project's SQS queues, named with the prefix `<name_prefix>-`, including sending the release
  smoke job and polling the smoke-results queue;
- KMS key creation, plus KMS aliases named `<name_prefix>-`; administration of the project
  key is granted by that key's key policy and the deploy identity policy is scoped by the
  `Project=<name_prefix>` resource tag;
- Lambda functions and event source mappings named with the prefix `<name_prefix>-`;
- IAM roles and inline or customer-managed policies whose names contain `worker` or start with
  `lambda` after the `<name_prefix>-` prefix, plus the generated `<name_prefix>-caller` role;
- Lambda log groups under `/aws/lambda/<name_prefix>-` and project log groups named
  `<name_prefix>-`;
- CloudWatch alarms named with the prefix `<name_prefix>-`;
- EventBridge rules and targets named `<name_prefix>-jobs`, including rule/target reads and tags,
  so the optional `job_rule` ingress can be managed through the release role;
- EC2/VPC resources for `vpc_mode = create` or `lookup`: VPCs, subnets, route tables, internet and
  NAT gateways, VPC endpoints, security groups and Elastic IPs. Create calls use `Resource: "*"`
  with `aws:RequestTag/Project`; configure and delete calls use project resource ARNs with
  `aws:ResourceTag/Project`; tag-on-create uses `ec2:CreateAction`, and both tag paths restrict
  `aws:TagKeys` to the project tag set (`Project`, `Name`, `Tier` plus bootstrap `tags` keys).
  Every EC2 statement carries `aws:RequestedRegion`. Create actions and `Describe*` calls use
  `Resource: "*"`: create actions because the resource does not exist yet, and describes because
  EC2 has no resource-level authorization for them. All other mutating statements use project
  ARNs, including `security-group-rule/*` for rule tagging and `ec2:ModifySecurityGroupRules`.
  Bootstrap `tags` must include every extra tag key applied to network resources, or the tag key
  allowlist denies the apply;
- `iam:GetRole` (read-only) on every ARN in `additional_worker_role_arns`, so the main module can
  validate a provided worker role's existence and trust policy.

`iam:PassRole` is allowed only on the generated worker-role ARNs, the patterns above, and every ARN
in `additional_worker_role_arns`, and only when the role is passed to `lambda.amazonaws.com`. The
deploy role cannot modify itself or the plan role. When the main deployment uses
`worker_role_mode = "existing"`, add the provided ARN to `additional_worker_role_arns` and re-apply
bootstrap before applying the main stack; otherwise Lambda creation fails on `iam:PassRole` or the
provider cannot read the role for trust validation. The
main module must grant the deploy role key administration in the project KMS key policy **and tag
the key with `Project = <name_prefix>`**; the deploy identity policy uses `aws:ResourceTag/Project`
so it cannot administer unrelated customer-managed keys. KMS tag authorization is eventually
consistent: if the first apply fails with `AccessDenied` on the newly created key, retry after the
tag has propagated (up to five minutes). The release smoke expects the jobs queue to start with
`<name_prefix>-jobs` and the smoke-results queue name to contain `smoke`; adjust the resource
patterns here if the main module uses different names.

The plan role attaches the AWS-managed `ReadOnlyAccess` policy plus explicit read access to the
state bucket. It is read-only: it does not write state. Because the main backend enables
`use_lockfile = true`, a `terraform plan` also tries to write
`printer/terraform.tfstate.tflock`. The CI plan must use `-lock=false`, or it must be given a
narrow write grant for that one lock object. This bootstrap deliberately keeps the plan role
read-only, so that decision belongs to the CI workflow.
