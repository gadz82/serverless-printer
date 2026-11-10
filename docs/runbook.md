# Operations runbook

This is the operator guide for the single printer deployment in `infra/`. It covers the opt-in
alarms, rollback, dead-letter queue (DLQ) redrive, template removal, KMS and Terraform state
recovery, the caller and worker role modes, VPC operations and the first cloud verification.

Use it with [`infra/README.md`](../infra/README.md), which documents the inputs, outputs and
permissions. The deployment is intentionally small: an SQS jobs queue, a render worker Lambda, a
transient S3 prints bucket and an optional VPC. There is no database, API, UI or monitoring vendor.

## Scope and safety rules

- There is one deployment and one Terraform state. Do not create environments or workspaces.
- Never run `terraform destroy` to reset the service. It deletes the jobs queue, the prints bucket
  and the KMS key; the state and artifacts buckets are outside this stack but a destroy still
  causes an outage.
- Use an operator identity with the permissions required by the task. The GitHub OIDC deploy role
  can apply the stack but is not a general incident role: it cannot receive messages from the
  jobs queue or DLQ and
  cannot start a message move.
- Read first, change second. Before any apply, save the plan and confirm it contains only the
  expected changes.
- Do not paste message bodies, callback URLs, Terraform state or AWS credentials into tickets or
  chat. The worker logs deliberately exclude payloads, `refId` and rendered content.
- A rollback restores the worker artifact, not the repository configuration. Infrastructure changes
  merged after the release remain applied unless they are reverted separately.

## Common environment

Set these values once per shell. Read the bucket, role and queue values from the bootstrap outputs
and `terraform output`; do not hard-code account IDs into the repository.

```sh
export AWS_REGION="eu-central-1"
export NAME_PREFIX="printer"
export TF_STATE_BUCKET="<state-bucket>"
export TF_STATE_KEY="printer/terraform.tfstate"
export ARTIFACTS_BUCKET="<artifacts-bucket>"
export DEPLOY_ROLE_ARN="<deploy-role-arn>"
export RELEASE="<release>"
```

After `terraform init`, read the queue and function identifiers:

```sh
export JOBS_QUEUE_URL="$(terraform -chdir=infra output -raw jobs_queue_url)"
export JOBS_QUEUE_ARN="$(terraform -chdir=infra output -raw jobs_queue_arn)"
export DLQ_URL="$(terraform -chdir=infra output -raw jobs_dlq_url)"
export DLQ_ARN="$(terraform -chdir=infra output -raw jobs_dlq_arn)"
export SMOKE_QUEUE_URL="$(terraform -chdir=infra output -raw smoke_queue_url)"
export SMOKE_QUEUE_ARN="$(terraform -chdir=infra output -raw smoke_queue_arn)"
export FUNCTION_NAME="$(terraform -chdir=infra output -raw function_name)"
export KMS_KEY_ARN="$(terraform -chdir=infra output -raw kms_key_arn)"
```

Confirm the identity and region before changing anything:

```sh
aws sts get-caller-identity
aws configure get region
```

## Alarm definitions and response

The module creates two CloudWatch alarms only when `enable_alarms = true`. The default is `false`.
Terraform does not create the SNS topic or its subscriptions; `alarm_sns_topic_arn` must name an
existing topic in the deployment region, with a topic policy allowing `cloudwatch.amazonaws.com`
to publish (and a KMS key policy if the topic is encrypted). The plan fails when alarms are enabled
without the ARN. Both alarms publish their `ALARM` state transitions to that topic.

| Alarm                                | Namespace / metric                             | Dimension                                  | Statistic and period | Threshold |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------ | -------------------- | --------- |
| `<name_prefix>-jobs-dlq-depth`       | `AWS/SQS` `ApproximateNumberOfMessagesVisible` | `QueueName=<name_prefix>-jobs-dlq`         | `Maximum`, 300 s     | `>= 1`    |
| `<name_prefix>-render-worker-errors` | `AWS/Lambda` `Errors`                          | `FunctionName=<name_prefix>-render-worker` | `Sum`, 300 s         | `>= 1`    |

Both use one evaluation period and treat missing data as not breaching. There is no automatic
remediation and no OK action, so a recovered alarm does not send a second notification. Confirm
recovery from the metric and the logs.

### Enable and verify alarms

Set the following in `infra/terraform.tfvars` (or in the repository `TF_VARS` variable used by the
release workflow):

```hcl
enable_alarms       = true
alarm_sns_topic_arn = "arn:aws:sns:eu-central-1:123456789012:printer-alerts"
```

Then apply through the normal release workflow or a reviewed manual apply. After the apply:

```sh
aws cloudwatch describe-alarms \
  --alarm-name-prefix "${NAME_PREFIX}-" \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Metric:MetricName}' \
  --output table

aws sns list-subscriptions-by-topic --topic-arn "<alarm-sns-topic-arn>"
```

At least one confirmed subscription must exist. A pending subscription receives nothing.

To prove the notification path without waiting for a real failure, set an alarm state manually
during a maintenance window, then reset it:

```sh
aws cloudwatch set-alarm-state \
  --alarm-name "${NAME_PREFIX}-jobs-dlq-depth" \
  --state-value ALARM \
  --state-reason "runbook notification check"

# Confirm the SNS delivery, then clear the manual state.
aws cloudwatch set-alarm-state \
  --alarm-name "${NAME_PREFIX}-jobs-dlq-depth" \
  --state-value OK \
  --state-reason "runbook notification check complete"
```

### DLQ-depth alarm

`jobs-dlq-depth` means at least one failed message is visible in the DLQ for a five-minute period.
A message reaches the DLQ when it is received `max_receive_count` times (default 5), when an
invalid message has no readable failure callback, or when a failure result itself cannot be
delivered.

1. Check the DLQ and jobs queue counts:

   ```sh
   aws sqs get-queue-attributes \
     --queue-url "$DLQ_URL" \
     --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed

   aws sqs get-queue-attributes \
     --queue-url "$JOBS_QUEUE_URL" \
     --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
   ```

2. Peek at the oldest messages without hiding them. A zero visibility timeout leaves them
   available for the redrive or for the next operator:

   ```sh
   aws sqs receive-message \
     --queue-url "$DLQ_URL" \
     --max-number-of-messages 10 \
     --visibility-timeout 0 \
     --attribute-names All \
     --message-attribute-names All \
     --wait-time-seconds 0
   ```

   Inspect the body, `ApproximateReceiveCount` and any result metadata. Do not delete a message
   until its cause is understood.

3. Correlate with the worker log group `/aws/lambda/<name_prefix>-render-worker`. Filter on the
   message ID, or look for the failure events:

   ```text
   fields @timestamp, level, event, messageId, printId, templateId, attempt, errorCode
   | filter event in ["print_job_failed", "print_job_retry", "print_job_batch_failure", "print_job_failure_undeliverable"]
   | sort @timestamp desc
   ```

4. Classify the failure before redriving:

   | Evidence                                                                     | Likely cause                                                           | Action                                                                                                    |
   | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
   | `TEMPLATE_NOT_FOUND`, `template: null`                                       | Template removed or caller uses the wrong id/slug                      | Fix the caller or roll back the worker; see [template removal](#template-removal-and-template_not_found)  |
   | `INVALID_MESSAGE` and no failure callback                                    | Malformed body and no readable callback                                | Notify the caller; delete after retention or fix the producer                                             |
   | `CALLBACK_NOT_ALLOWED`                                                       | HTTP host or ping URL outside the allowlist, or an unsupported channel | Correct the allowlist/target; redrive after the fix                                                       |
   | `DELIVERY_FAILED`, `PDF_RENDER_FAILED`                                       | Transient callback, rendering, S3 or KMS failure                       | Fix the dependency, then redrive                                                                          |
   | `PDFA_CONVERSION_FAILED`, `TEMPLATE_RENDER_FAILED`, `PDFA_LEVEL_NOT_ALLOWED` | Deterministic renderer/template/options failure                        | Fix the template or caller; redrive only after the fix                                                    |
   | Timeouts, `KMS.DisabledException`, S3 `AccessDenied`                         | KMS, IAM or network outage                                             | Follow [KMS recovery](#kms-and-terraform-state-recovery) or the [VPC checks](#vpc-and-network-operations) |

5. If the cause is fixed, redrive the DLQ. If the cause is a template removal, an invalid message
   or an unreadable callback, redriving without changing anything only repeats the failure.

### Worker-error alarm

`render-worker-errors` means the Lambda reported at least one invocation error in five minutes.
Check the same log group for cold-start configuration errors, unhandled failures and batch
failures. Then check the Lambda configuration and the dependency path:

```sh
aws lambda get-function-configuration --function-name "$FUNCTION_NAME"
aws lambda get-event-source-mapping \
  --uuid "$(aws lambda list-event-source-mappings --function-name "$FUNCTION_NAME" --query 'EventSourceMappings[0].UUID' --output text)"
```

- A burst of `print_job_batch_failure` is normal for a transient renderer/SQS outage; follow the
  DLQ path if it persists.
- `ConfigError` at cold start means an environment variable is missing or malformed. Inspect the
  Lambda environment and the Terraform plan; do not edit the function directly.
- Timeouts and high duration can indicate a Chromium cold start, memory pressure or a network
  problem. Use the Lambda `Duration`, `ConcurrentExecutions` and `Throttles` metrics as
  diagnostics; they are not additional alarms.
- `KMS.DisabledException`, S3 access errors or VPC timeouts need the corresponding recovery steps
  below.
- After a deployment, a small number of errors can be old alias invocations. Correlate the log
  timestamp with the release time before rolling back.

## Rollback

Rollback is a forward Terraform apply of an earlier worker release, followed by the same smoke
test. It does not use `terraform destroy` and does not move the state backwards.

The earlier artifact must still exist at
`s3://<artifacts_bucket>/<release>/render-worker.zip`. Verify it before dispatching:

```sh
aws s3api head-object \
  --bucket "$ARTIFACTS_BUCKET" \
  --key "${RELEASE}/render-worker.zip"
```

### Rollback through the release workflow (preferred)

1. Choose a previously successful SemVer tag or `sha-<short>` release.
2. From `main`, dispatch `release.yml` with that release. The OIDC trust only accepts
   `refs/heads/main`.

   ```sh
   gh workflow run release.yml --ref main -f release=v1.2.3
   gh run list --workflow release.yml --limit 5
   ```

   The dispatch skips semantic-release, the build and the upload. It applies the existing artifact
   and runs the release smoke test. An empty dispatch input is not a rollback; it targets the
   current commit's `sha-<short>` release.

3. Wait for the workflow to finish green. Its smoke step reads `jobs_queue_url`,
   `smoke_queue_url` and `smoke_queue_arn` from the fresh Terraform outputs.
4. Confirm that the Lambda alias and the deployed release agree:

   ```sh
   aws lambda get-alias \
     --function-name "$FUNCTION_NAME" \
     --name live \
     --query '{Name:Name,Version:FunctionVersion,Description:Description}'
   ```

### Manual Terraform rollback

Use this only when the release workflow is unavailable, and do not run it while a release or
another apply is in progress. Initialize the same S3 backend and use the same release, artifacts,
region and deploy-role inputs as the workflow:

```sh
terraform -chdir=infra init -input=false \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=$TF_STATE_KEY" \
  -backend-config="region=$AWS_REGION"

terraform -chdir=infra plan -input=false \
  -var-file=terraform.tfvars \
  -var "release=$RELEASE" \
  -var "artifacts_bucket=$ARTIFACTS_BUCKET" \
  -var "region=$AWS_REGION" \
  -var "deploy_role_arn=$DEPLOY_ROLE_ARN" \
  -out=rollback.tfplan
```

Read the plan. A release-only rollback should change the Lambda object key/version and the `live`
alias, not delete queues, buckets, the KMS key or IAM roles. Apply the saved plan and remove it:

```sh
terraform -chdir=infra apply rollback.tfplan
rm infra/rollback.tfplan
```

Then run the deployed smoke test with the outputs from this state:

```sh
AWS_REGION="$AWS_REGION" \
JOBS_QUEUE_URL="$JOBS_QUEUE_URL" \
SMOKE_QUEUE_URL="$SMOKE_QUEUE_URL" \
SMOKE_QUEUE_ARN="$SMOKE_QUEUE_ARN" \
RELEASE="$RELEASE" \
pnpm smoke:test
```

If the rollback needs to revert Terraform configuration rather than only the worker artifact, use
a clean worktree at the earlier commit/series of commits, review its plan against the same backend,
and apply from there. Do not hand-edit resources in the console to imitate a rollback.

### After a rollback

- Confirm the smoke result reports the expected `template.release`.
- Check `print_job_succeeded` and `print_job_failed` events for the first few minutes.
- Keep the failed release evidence: workflow run, plan, smoke refId and CloudWatch log window.
- Do not redrive DLQ messages until the release that can process them is live.

## DLQ redrive

Redrive returns messages to the jobs queue for another delivery cycle. Fix the cause first,
otherwise the messages return to the DLQ. The queues use SQS-managed encryption, four-day
retention and a redrive allow policy limited to `<name_prefix>-jobs`.

Use an operator identity with `sqs:ReceiveMessage`, `sqs:DeleteMessage`,
`sqs:GetQueueAttributes`, `sqs:SendMessage` on the destination jobs queue,
`sqs:StartMessageMoveTask`, `sqs:ListMessageMoveTasks` and `sqs:CancelMessageMoveTask` on the
project queues. The GitHub deploy role does not have the receive/move permissions.

1. Capture evidence before moving anything:

   ```sh
   aws sqs get-queue-attributes \
     --queue-url "$DLQ_URL" \
     --attribute-names All

   aws sqs receive-message \
     --queue-url "$DLQ_URL" \
     --max-number-of-messages 10 \
     --visibility-timeout 30 \
     --attribute-names All \
     --message-attribute-names All \
     --wait-time-seconds 0
   ```

   The 30-second visibility timeout prevents another operator from receiving the same message
   while you inspect it; it does not delete it. Preserve the message ID, receive count and error
   evidence, not the full body if it contains caller data.

2. Delete only permanently invalid messages after notifying the caller. A delete needs the receipt
   handle from the receive response:

   ```sh
   aws sqs delete-message \
     --queue-url "$DLQ_URL" \
     --receipt-handle "<receipt-handle>"
   ```

3. Start the redrive from the DLQ ARN to the jobs queue ARN. Throttle it so the worker and callers
   are not surprised:

   ```sh
   aws sqs start-message-move-task \
     --source-arn "$DLQ_ARN" \
     --destination-arn "$JOBS_QUEUE_ARN" \
     --max-number-of-messages-per-second 10
   ```

4. Watch the move task and both queues:

   ```sh
   aws sqs list-message-move-tasks --source-arn "$DLQ_ARN" --max-results 10

   aws sqs get-queue-attributes \
     --queue-url "$DLQ_URL" \
     --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible

   aws sqs get-queue-attributes \
     --queue-url "$JOBS_QUEUE_URL" \
     --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
   ```

5. Confirm successes in the worker logs and with the caller. Results are idempotent per inbound
   message ID (`printId` is derived from it), but SQS is at-least-once: callers must still
   deduplicate deliveries on `printId`.

If a move task must be stopped, use `aws sqs cancel-message-move-task --task-handle <handle>`.
Do not purge either queue as a shortcut. Purging the jobs queue destroys live jobs; purging the
DLQ destroys the evidence needed to fix the producer. Either action needs an incident lead's
approval.

## Template removal and `TEMPLATE_NOT_FOUND`

Templates are static files in `templates/<slug>/`, bundled into the worker zip with a manifest at
build time. There is no runtime template registry, so a removal only takes effect when a new
release is deployed.

`TEMPLATE_NOT_FOUND` is non-retryable. When the deployed manifest has no matching id or slug, the
worker returns a failure result with `template: null` to the job's failure callback. If the job has
no readable failure callback, the message goes to the DLQ.

### Identify the deployed template

Use the GitHub Release asset when the release was cut by semantic-release:

```sh
gh release download "$RELEASE" --pattern templates.manifest.json --output /tmp/templates.manifest.json
jq -r '.templates[] | [.id, .slug, .contentHash] | @tsv' /tmp/templates.manifest.json
```

For a `sha-<short>` release, read the manifest from the artifact instead:

```sh
aws s3 cp "s3://$ARTIFACTS_BUCKET/$RELEASE/render-worker.zip" /tmp/render-worker.zip
unzip -p /tmp/render-worker.zip templates.manifest.json |
  jq -r '.templates[] | [.id, .slug, .contentHash] | @tsv'
```

Then verify that the id or slug in the job appears in that list. If it does not, the caller is
using a template that is not in the deployed bundle.

### Remove a template safely

1. Identify the template's owner and callers. The worker logs contain `templateId` but not the
   payload, so use the manifest and caller contracts to find consumers.
2. Tell callers to stop submitting the id and slug, and to migrate to a replacement template.
3. Let the jobs queue drain. The queue retains messages for four days, so a removal can strand a
   job queued just before the deploy. Removing a template while jobs are still queued is accepted
   by the specification, but it is not a safe customer experience.
4. Remove the template folder and let CI run `pnpm template:validate` and
   `pnpm template:check --base origin/main`. The check reports the removal but does not fail merely
   because a template disappeared; identity changes, moves, slug reuse and invalid descriptors
   still fail, and validation checks the remaining templates.
5. Deploy through the normal release workflow.
6. Watch for `TEMPLATE_NOT_FOUND` failures and DLQ growth:

   ```text
   fields @timestamp, event, messageId, templateId, errorCode
   | filter event = "print_job_failed" and errorCode = "TEMPLATE_NOT_FOUND"
   | sort @timestamp desc
   ```

### Recover an accidental removal

Roll back to the release that still contains the template (see [rollback](#rollback)), then
redrive the affected DLQ messages after the alias points at that release. If the job has already
been delivered as a failure, the caller must resubmit; the worker does not retry non-retryable
failures.

A template edit does not change its id or slug; only removal makes existing ids disappear. Editing
files changes the output from the next deploy, so remove only after caller migration, never as a
way to "hide" a broken template.

## KMS and Terraform state recovery

### KMS key

The prints bucket uses SSE-KMS with the project key `alias/<name_prefix>-prints`. The key is
rotated, the deploy role administers it through the key policy, and the worker has
`kms:Decrypt`/`kms:GenerateDataKey`. Prints expire after one day, so a short KMS interruption is
recoverable; the bucket and key are still shared infrastructure and must not be deleted.

Inspect the key:

```sh
aws kms describe-key --key-id "$KMS_KEY_ARN" \
  --query 'KeyMetadata.{Id:KeyId,State:KeyState,Enabled:Enabled,DeletionDate:DeletionDate}'
aws kms get-key-rotation-status --key-id "$KMS_KEY_ARN"
aws kms list-resource-tags --key-id "$KMS_KEY_ARN"
```

If the key is scheduled for deletion, cancel deletion before doing anything else. If it is disabled
but not pending deletion, enable it instead:

```sh
# Pending deletion:
aws kms cancel-key-deletion --key-id "$KMS_KEY_ARN"

# Disabled but not pending deletion:
aws kms enable-key --key-id "$KMS_KEY_ARN"
```

A key cannot be enabled while it is pending deletion, so cancel that first. Both commands need KMS
administration outside the worker role; the account root in the key policy can delegate this to an
operator. After re-enabling, retry the failed jobs or redrive the DLQ.

If the key tag was changed or removed and Terraform now fails:

1. Check that the key carries `Project = <name_prefix>`. The bootstrap deploy identity scopes KMS
   administration with `aws:ResourceTag/Project`.
2. Restore the tag with an operator identity:

   ```sh
   aws kms tag-resource \
     --key-id "$KMS_KEY_ARN" \
     --tags TagKey=Project,TagValue="$NAME_PREFIX"
   ```

3. Re-run the normal plan. If the key policy itself was changed, restore the module's policy from a
   reviewed plan using an identity that the key policy still allows; do not delete the key.

The first apply after KMS key creation can fail with `AccessDenied` because KMS tag authorization
is eventually consistent. Wait up to five minutes and retry. The release workflow already retries
the apply three times with a 60-second delay.

If a key is permanently lost after its deletion window, existing print objects cannot be decrypted;
there is no exportable symmetric key material to recover. The service can still render new prints
after a replacement key is provisioned, and old objects disappear through the one-day lifecycle.
Treat that as a data-loss incident for uncollected prints and involve AWS Support before taking
further action.

### Main Terraform state

The main stack uses the versioned S3 backend:

- bucket: the bootstrap `state_bucket` output;
- key: `printer/terraform.tfstate`;
- locking: S3 native lock file (`use_lockfile = true`, object
  `printer/terraform.tfstate.tflock`);
- encryption: SSE-S3 and public access blocked.

The state contains resource identifiers and configuration, not application secrets, but it is
sensitive. Keep it out of chat and tickets.

Back up the current state before a recovery:

```sh
terraform -chdir=infra init -input=false \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=$TF_STATE_KEY" \
  -backend-config="region=$AWS_REGION"

terraform -chdir=infra state pull > "/tmp/printer-state-$(date +%Y%m%dT%H%M%S).json"
```

If a bad operation overwrote or corrupted state, inspect the object versions:

```sh
aws s3api list-object-versions \
  --bucket "$TF_STATE_BUCKET" \
  --prefix "$TF_STATE_KEY" \
  --query 'Versions[].{VersionId:VersionId,LastModified:LastModified,IsLatest:IsLatest}' \
  --output table
```

Download the last known-good version, verify that it is the expected state file, and push it
through Terraform rather than editing S3 in place:

```sh
aws s3api get-object \
  --bucket "$TF_STATE_BUCKET" \
  --key "$TF_STATE_KEY" \
  --version-id "<version-id>" \
  /tmp/printer-state-recovered.json

terraform -chdir=infra state pull > /tmp/printer-state-current.json
terraform -chdir=infra state push /tmp/printer-state-recovered.json
terraform -chdir=infra plan -input=false
```

`terraform state push` may refuse a state with different lineage or a higher serial. Do not use
`-force` without an incident lead's approval and a fresh backup. After the push, review a full plan
and reconcile any resources that were created or deleted after the restored serial.

If the state object was deleted but the bucket still exists, the same recovery works because
versioning retains the object. If the bucket itself was deleted, there is no configured backup
beyond AWS's bucket-level recovery options; stop and involve the account owner. Do not recreate the
bucket with a new name and assume the old resources are gone.

### Stale lock

A failed or interrupted apply can leave a lock file. First confirm no release workflow or operator
is applying, then use the lock ID from the Terraform error:

```sh
terraform -chdir=infra force-unlock "<lock-id>"
```

If `force-unlock` cannot clear an orphaned S3 native lock, delete the lock object only after the
same confirmation and with an incident lead's approval:

```sh
aws s3api delete-object \
  --bucket "$TF_STATE_BUCKET" \
  --key "${TF_STATE_KEY}.tflock"
```

Never delete the state object itself to clear a lock.

### Bootstrap state

`infra/bootstrap` deliberately uses local state because it creates the state bucket it would need.
Encrypt `infra/bootstrap/terraform.tfstate` and keep it in the team's secret store. If it is lost,
the bootstrap resources still exist; re-import the state bucket, artifacts bucket, OIDC provider
and deploy/plan roles rather than running `terraform destroy` or creating duplicates. The bootstrap
README lists the resources and outputs.

## Caller and worker role modes

The caller and worker are separate roles. The module can create each one or use a provided role;
the defaults are `create`/`create`.

| Role   | Mode               | What Terraform does                                                                                                                                                                | Operational consequence                                                                                              |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Caller | `create` (default) | Creates `<name_prefix>-caller`, trusts `caller_trusted_principal_arns` (default deployer account root), grants `sqs:SendMessage` only on the jobs queue, outputs `caller_role_arn` | Integrators assume the generated role; changing the role replaces the caller contract                                |
| Caller | `existing`         | Uses `caller_role_arn`, adds it to the jobs queue policy, creates or modifies no IAM                                                                                               | Owner maintains the identity policy and trust; the role may be cross-account                                         |
| Worker | `create` (default) | Creates `<name_prefix>-render-worker`, trusts `lambda.amazonaws.com`, grants queue consume, prints/KMS, logs, callbacks and VPC ENIs as configured                                 | Terraform owns the permissions and drift                                                                             |
| Worker | `existing`         | Uses the same-account `worker_role_arn`, validates its trust with `iam:GetRole`, creates or modifies no IAM                                                                        | Owner maintains permissions; bootstrap must grant `iam:PassRole`/`iam:GetRole` through `additional_worker_role_arns` |

Validation and switching rules:

- `caller_role_mode` and `worker_role_mode` accept only `create` or `existing`.
- A mode of `create` requires the matching ARN to be null; `existing` requires a non-null ARN.
- A provided worker role must be in the current account and trust `lambda.amazonaws.com`.
- The caller and worker must resolve to different roles.
- Switching from `create` to `existing` can destroy the generated role. Plan first and migrate
  callers/workers before applying; Terraform only removes resources it owns.
- Switching a provided worker role requires adding its ARN to
  `infra/bootstrap/terraform.tfvars`, re-applying bootstrap, then applying the main stack.
- The generated caller role's trust defaults to the deployer account root. Narrow it with
  `caller_trusted_principal_arns`; `existing` mode ignores that list.
- A provided caller role must allow `sqs:SendMessage` on `<name_prefix>-jobs`; the stack adds it to
  the queue policy but not to its identity policy.

Verify the resolved roles after an apply:

```sh
terraform -chdir=infra output caller_role_arn
terraform -chdir=infra output caller_role_created
terraform -chdir=infra output worker_role_arn
terraform -chdir=infra output worker_role_created
```

### Access-denied triage

- **Caller cannot send:** check the jobs queue policy principal, the caller role's identity policy,
  and the caller's trust policy. A cross-account caller also needs its own account to allow the
  role assumption.
- **Worker cannot start:** check that the role trusts `lambda.amazonaws.com`, that the bootstrap
  has `iam:PassRole` for a provided role, and that the role is same-account.
- **Worker cannot read jobs:** check `sqs:ReceiveMessage`/`DeleteMessage`/
  `ChangeMessageVisibility`/`GetQueueAttributes` on the jobs queue.
- **Worker cannot write prints:** check `s3:PutObject` on `prints/*`, `kms:GenerateDataKey` on the
  project key and the key policy's worker principal.
- **Worker cannot deliver:** check the action for the channel on the exact `callback_target_arns`
  entry and the target account's own resource policy. When `organization_id` is set, the worker policy
  also carries an `aws:ResourceOrgID` condition.
- **VPC worker cannot reach a dependency:** check the ENI permissions and the network path; see
  [VPC and network operations](#vpc-and-network-operations).

## VPC and network operations

The default `vpc_mode = "none"` runs the worker outside a VPC and is the lowest-cost, simplest
path. `create` owns a VPC; `lookup` attaches the worker to an existing VPC and subnets.

| Mode     | Terraform behaviour                                                                                                                 | When to use it                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `none`   | No VPC, subnets, endpoints or NAT                                                                                                   | Default; callbacks can reach public hosts over the internet |
| `create` | Creates private subnets and optional public/NAT resources; S3 gateway endpoint and SQS/Lambda/Events interface endpoints by default | You need private networking and want Terraform to own it    |
| `lookup` | Resolves an existing VPC/subnets and attaches the worker                                                                            | The network is owned by another team                        |

In `create` and `lookup`, the worker gets a `vpc_config`. In `none` it has no VPC configuration.
The worker security group allows outbound DNS and HTTPS. Without NAT, the worker can reach only
private hosts routable inside the VPC and its connected networks; `http` callbacks to public hosts
need either a private destination or `enable_nat_gateway = true`.

`lookup` takes exactly one of `vpc_id` or `vpc_tags`, and exactly one of `subnet_ids` or
`subnet_tags`; `enable_nat_gateway` is rejected in lookup mode because the existing network owns
its egress. `none` and `create` reject lookup/security-group inputs. These constraints fail at plan
time, so read the error before changing values.

### Change the network mode

1. Update the non-secret Terraform values and run a full plan with the release inputs.
2. Confirm the plan's network changes. `create` adds VPCs, subnets, route tables, endpoints and
   possibly a NAT gateway/EIP; `lookup` should add only the worker's VPC attachment and, when no
   groups are supplied, a managed worker security group.
3. Check the cost and connectivity implications before applying:
   - NAT gateways bill hourly, per GB processed, and the public IPv4 address is billed separately.
   - Interface endpoints bill hourly per AZ and per GB processed; the S3 gateway endpoint is free.
   - In `lookup`, the existing VPC must already provide S3/SQS/Lambda/Events connectivity and, for
     public HTTP callbacks, NAT.
4. Apply through the release workflow. Changing the worker's VPC configuration replaces its
   Hyperplane ENIs and can briefly delay new invocations.
5. Verify the attachment and routing:

   ```sh
   aws lambda get-function-configuration \
     --function-name "$FUNCTION_NAME" \
     --query '{VpcConfig:VpcConfig,State:State,LastUpdateStatus:LastUpdateStatus}'

   export VPC_ID="$(terraform -chdir=infra output -raw vpc_id)"
   aws ec2 describe-vpc-endpoints \
     --filters "Name=vpc-id,Values=$VPC_ID" \
     --query 'VpcEndpoints[].{Service:ServiceName,State:State,Type:VpcEndpointType}' \
     --output table

   aws ec2 describe-route-tables \
     --filters "Name=vpc-id,Values=$VPC_ID" \
     --query 'RouteTables[].{Id:RouteTableId,Routes:Routes[].{Destination:DestinationCidrBlock,Gateway:GatewayId,Nat:NatGatewayId}}' \
     --output json
   ```

### Network incident checks

- **Timeout calling SQS/Lambda/EventBridge:** confirm the interface endpoint exists, is available in
  the worker's AZ, and allows 443 from the worker security group. Confirm the private route table
  has the endpoint route or a NAT route.
- **Timeout calling S3:** confirm the S3 gateway endpoint is attached to the private route table.
  S3 traffic should stay on the AWS network.
- **Timeout calling a public HTTP callback:** without NAT there is no route; enable NAT or use a
  callback host reachable from the VPC.
- **Timeout calling KMS/S3 with KMS:** S3 performs the KMS operation service-side; check the key
  state and the worker's `kms:GenerateDataKey` permission before assuming a network fault.
- **ENI or `EC2` errors:** check that bootstrap has the EC2/VPC permissions and that the subnet and
  security group IDs still exist.
- **Lookup mode works in some AZs only:** verify the supplied subnets span the expected AZs and each
  has the endpoint/NAT path.
- **Do not manually delete** Terraform-managed VPC resources to "repair" a failed apply. Fix the
  plan or detach the worker first; otherwise Terraform's next apply can fail or leave orphaned
  resources.

To return to the default, set `vpc_mode = "none"` and apply. Terraform detaches the worker before
deleting the created network resources. `lookup` mode never destroys the looked-up VPC.

## First cloud verification checklist

Run this once for the first real deployment and repeat the redacted evidence fields for each major
infrastructure change. Record the account, region, operator, commit, release, workflow run URL,
smoke refIds and any exceptions in the release/change record.

### Before the first apply

- [ ] Bootstrap has been applied with the current repository; its outputs match
      `TF_STATE_BUCKET`, `ARTIFACTS_BUCKET`, `AWS_DEPLOY_ROLE_ARN` and the AWS region.
- [ ] Bootstrap state is stored in the team secret store or an encrypted location outside the repository.
- [ ] GitHub repository variables exist: `TF_VARS`, `AWS_DEPLOY_ROLE_ARN`, `AWS_PLAN_ROLE_ARN`,
      `AWS_REGION`, `TF_STATE_BUCKET`, `ARTIFACTS_BUCKET` and optionally `TF_STATE_KEY`.
- [ ] `TF_VARS` contains the non-secret operator values, including `name_prefix`, sender/callback
      settings, alarms and the selected `vpc_mode`.
- [ ] Branch protection/rulesets allow the release bot's `CHANGELOG.md` push and require the CI
      checks.
- [ ] `terraform -chdir=infra init` and a manual `plan` (or the PR plan) show no unexpected
      replacement of the KMS key, queues, buckets or roles.
- [ ] The selected VPC mode and its NAT/endpoints are intentional; `http` callbacks to public hosts
      require NAT or a private destination.

### First deploy

1. Push to `main`, or dispatch `release.yml` from `main`, and let the OIDC-authenticated workflow
   version, build, upload and apply. Do not use static AWS keys.
2. Open the workflow run and confirm:
   - semantic-release or the `sha-<short>` release was selected;
   - `render-worker.zip` exists under the release prefix;
   - Terraform apply succeeded;
   - the release smoke jobs completed.
3. Confirm the artifact and deployment:

   ```sh
   aws s3api head-object \
     --bucket "$ARTIFACTS_BUCKET" \
     --key "${RELEASE}/render-worker.zip" \
     --query '{Size:ContentLength,Version:VersionId}'

   aws lambda get-alias \
     --function-name "$FUNCTION_NAME" \
     --name live \
     --query '{Name:Name,Version:FunctionVersion,Description:Description}'

   aws logs describe-log-groups \
     --log-group-name-prefix "/aws/lambda/$FUNCTION_NAME" \
     --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays}'
   ```

### Functional and operational evidence

- [ ] The plain `_smoke` job succeeded and reported the deployed `template.release`.
- [ ] The PDF/A `_smoke` job succeeded with the requested level and reported the deployed release.
- [ ] The manifest is attached to the SemVer GitHub Release and lists the intended templates.
- [ ] A real template (`generic-report` or the first customer template) renders end to end through
      the caller role and the chosen callback channel.
- [ ] The jobs queue and DLQ exist with the expected redrive policy, retention and encryption.
- [ ] The Lambda has the expected memory, timeout, runtime, architecture, alias and VPC config.
- [ ] Alarms are either intentionally disabled or enabled with a confirmed SNS subscription; the
      notification path was tested with `set-alarm-state`.
- [ ] The DLQ can be inspected and redriven with an operator identity, and the redrive allow policy
      names only the jobs queue.
- [ ] A rollback dispatch to the previous release is green and both the plain and PDF/A smoke jobs
      pass.
- [ ] The caller and worker modes in `terraform output` match the intended ownership model; a
      provided worker role has the bootstrap `additional_worker_role_arns` grant.
- [ ] If a VPC mode is enabled, the worker reaches SQS/S3 and its callback path from every selected
      AZ, and the endpoint/NAT cost is recorded.

### Closeout

Remove temporary plan files and downloaded artifacts, rotate any temporary operator credentials,
and attach the evidence to the change record. Do not commit `terraform.tfstate`,
`terraform.tfvars`, plan files or downloaded message bodies.
