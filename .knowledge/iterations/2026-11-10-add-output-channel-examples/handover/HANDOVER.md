# Handover — output channel examples

- Iteration: `2026-11-10-add-output-channel-examples`
- Status: closed; G8 handover
- Scope: examples plus SQS payload documentation/validation

## What changed

Eight example folders show the job body and Terraform inputs for each output path: HTTP
(standard/PDF-A/private VPC), Lambda, SQS FIFO, EventBridge and S3 PDF/A, plus EventBridge ingress.
Every folder contains a `README.md`, `config.tfvars.example` and the exact `sqs-payload.json`;
ingress also has `event.json`.

## Reading order

1. `examples/README.md` — matrix, SQS payload shape and send command.
2. `examples/01-http-standard/` — base HTTP job + allowlist config.
3. `examples/02-http-pdfa/` — PDF/A option.
4. `examples/03-lambda-callback/` — callback ARN + async invocation.
5. `examples/04-sqs-fifo/` — FIFO callback.
6. `examples/05-eventbridge-callback/` — bus detail events.
7. `examples/06-s3-pdfa/` — presigned PUT, no print storage.
8. `examples/07-private-http-vpc/` — VPC mode + private callback.
9. `examples/08-eventbridge-ingress/` — optional `job_rule` ingress.
10. `tests/examples/examples.test.ts` — contract/folder validation.

## How to run and test

```sh
pnpm exec vitest run tests/examples
pnpm test
pnpm typecheck
pnpm lint
pnpm exec prettier --check .
```

## How to use

Pick the closest folder, merge its `config.tfvars.example` into `TF_VARS`/manual tfvars, deploy,
then send `sqs-payload.json` with `aws sqs send-message`. Replace placeholders and do not commit
secrets/presigned URLs.

## Rollback

Remove the `examples/` and `tests/examples/` additions; they are documentation/test-only and do not
affect runtime behavior.

## Risks

- No live channel delivery test.
- Placeholders for hosts, ARNs, accounts and presigned URLs must be replaced.
- S3 success-only; failure uses HTTP/Lambda/SQS/EventBridge.
