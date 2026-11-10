# Infrastructure impact

- **Chromium:** bundle @sparticuz/chromium (~65 MB) external in esbuild; Lambda 1,536 MB start,
  60 s timeout; browser reuse/relaunch; `/tmp` decompression.
- **PDF/A:** pdf-lib and `sRGB2014.icc` in the bundle; one extra parse/save pass.
- **Channels:** IAM for Lambda invoke, SQS send, EventBridge PutEvents; HTTP egress via VPC/NAT
  when configured; S3 presigned PUT needs no destination permission.
- **Alarms:** DLQ depth and worker errors to SNS, opt-in.
- **Bootstrap:** deploy role needs EC2/VPC management for network modes and `iam:PassRole` for
  provided worker roles; add `additional_worker_role_arns`.
- **Roles:** conditional `aws_iam_role`/policy for caller and worker; generated caller role trust;
  provided roles use ARNs without IAM mutation; queue policy includes the caller ARN.
- **Release:** plain + PDF/A smoke; manifest asset; rollback.
- **Network:** existing module; apply through the expanded deploy role.

## Operator inputs

AWS account/region, VPC mode/IDs, throughput target, SNS topic, callback targets/allowlist, caller
trust/provided ARNs, worker provided ARN, remote/branch protection.

## Risks

| Risk | Mitigation |
|---|---|
| Chromium cold start/zip | Pin, measure, load test |
| PDF/A conformance | Best effort, checks, docs |
| Provided role over-privilege | Owner responsibility, docs, least-privilege generated default |
| PassRole misconfiguration | Bootstrap variable + plan/output docs |
| VPC cost/apply | Default none, plan review |
| Memory/cost | Power Tuning |
