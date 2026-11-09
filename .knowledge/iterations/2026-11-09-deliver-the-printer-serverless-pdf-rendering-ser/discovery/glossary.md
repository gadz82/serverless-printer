# Discovery glossary

| Term | Meaning in this project |
|---|---|
| **Job** | One inbound SQS message that describes a template, a payload, options and callback destinations. One job produces exactly one print. |
| **Print** | The single PDF produced by one job. It is transient and never retained beyond the configured expiry. |
| **printId** | Deterministic identifier `UUIDv5(namespace, inbound SQS messageId)`. A retry overwrites the same print object. |
| **refId** | Caller-supplied string, number or object echoed unchanged in the result and used by the caller to correlate the job. |
| **Template** | One folder under `templates/`, identified by an immutable UUID `id` and an immutable unique `slug`. The folder is the template; there are no versions or statuses. |
| **templateId** | A job field that accepts either the template `id` or its `slug`. |
| **Slug** | Human-readable template identifier matching `^[a-z][a-z0-9-]{2,63}$`, immutable and unique. `_smoke` is the single reserved internal exception (ADR-006). |
| **Manifest** | Build-time JSON that lists template identities, bundle paths, content hashes and placeholders; bundled into the worker and attached to releases. In this increment it contains the minimal `_smoke` entry. |
| **Content hash** | SHA-256 over a template's sorted files, reported on every print for traceability. |
| **Callback** | The channel where the result is delivered: `http`, `lambda`, `sqs`, `eventBridge` or `s3`. This increment implements `sqs` only. |
| **Ping** | Optional POST to `pingUrl` after result delivery. Deferred with the non-SQS channels. |
| **Jobs queue** | The SQS queue that is the only entry point into the service. |
| **DLQ** | Dead-letter queue that receives jobs after the configured receive count when failure handling cannot complete. |
| **Prints bucket** | S3 bucket holding transient PDFs with encryption, blocked public access and a one-day lifecycle expiry. |
| **Artifacts bucket** | S3 bucket created by `bootstrap/` that holds one worker zip folder per release. |
| **Bootstrap** | The Terraform root applied once by an administrator to create the state bucket, artifacts bucket and GitHub OIDC roles. |
| **Printer module** | The Terraform module that creates the queue, DLQ, prints bucket, KMS key, worker Lambda, IAM and logs. |
| **Worker** | The Lambda that consumes jobs, applies the use case and delivers results. |
| **Placeholder renderer** | Deterministic PDF producer used behind the `PdfRenderer` boundary in this increment; Chromium replaces it in Phase 3. |
| **PDF/A** | Optional archival PDF level requested per job. The contract supports it; production post-processing is deferred to Phase 3. |
| **Allowed sender** | An AWS account, principal ARN or organization permitted by the queue policy to enqueue jobs. |
| **Callback target** | An ARN pattern the worker is permitted to invoke, send to or publish to. |
| **Allowlist** | Configured `scheme://host[:port]` patterns for HTTP callbacks, bounded by the Lambda environment size limit. |
| **Release** | A SemVer tag such as `v1.4.0`, or `sha-<short>` when the commits do not warrant a release. It names the worker zip folder deployed by Terraform. |
| **Smoke test** | Post-deploy job using the `_smoke` template and an SQS callback queue that proves the release path. |
| **Conventional Commit** | Commit message format that drives semantic-release and is enforced locally and in CI. |
| **LocalStack** | Local AWS emulator used for SQS and S3 integration tests and local development. |
| **Callback sink** | Local process that records deliveries during local development. |
