# Infrastructure impact

## Slice 1 — Templates and network

- No AWS resource change for the template engine itself; the worker zip grows slightly.
- `modules/network`:
  - `vpc_mode = none` remains the default and creates nothing.
  - `create`: VPC, private subnets across `az_count`, optional public subnets/NAT, S3 gateway
    endpoint, SQS/Lambda/Events interface endpoints, worker security group.
  - `lookup`: resolve `vpc_id`/`vpc_tags` and `subnet_ids`/`subnet_tags`; no new VPC.
- Printer module: VPC config only when a VPC is selected; optional `job_rule` EventBridge ingress
  and queue-policy principal; network inputs documented.
- No new secrets or static credentials.

## Slice 2 — Rendering and delivery

- Worker zip: Chromium (~65 MB) plus pdf-lib and the sRGB ICC profile; still under Lambda limits.
- Lambda memory: start at 1,536 MB; tune on 1-page/20-page with and without PDF/A.
- IAM: `lambda:InvokeFunction`, `sqs:SendMessage`, `events:PutEvents` on
  `callback_target_arns`; S3 presigned PUT for the `s3` channel; HTTP egress or VPC/NAT as
  configured.
- Env: retain the Phase 1 variables; `PDFA_ALLOWED_LEVELS` returns to all levels by default in
  Phase 3.
- No new buckets or databases.

## Slice 3 — Production readiness

- Alarms: DLQ depth and worker errors to `alarm_sns_topic_arn`, off by default.
- Capacity: `maximum_concurrency`, reserved concurrency and memory from the load test.
- EventBridge ingress rule optional; queue policy includes the rule principal.
- Runbook is documentation only; no runtime resource.
- Cloud verification: bootstrap apply, OIDC deploy role, artifacts bucket, branch protection.

## CI/CD

- Template validate/check in CI (Slice 1).
- Render regression on `ubuntu-latest` x86_64 with `@sparticuz/chromium` (Slice 2).
- Load test/Power Tuning is an operator/measurement step (Slice 3).
- Release smoke gains a PDF/A variant (Slice 3).

## Operator inputs

- AWS account/region, VPC mode and IDs/tags.
- Throughput target.
- Alarm SNS topic.
- Callback allowlist and target ARNs.
- Remote/branch protection and release-bot bypass.

## Risks

| Risk | Mitigation |
|---|---|
| Chromium zip/cold start | Pin package, measure cold start, bundle external |
| VPC/NAT cost | Default none; plan review; optional NAT |
| Endpoint coverage | Gateway S3, interface SQS/Lambda/Events |
| Memory/PDF-A cost | Power Tuning and load test |
| Callback IAM breadth | Resource-scoped ARNs and org condition |
