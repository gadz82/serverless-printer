# Regression and test plan

## Test levels

| Level | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Vitest | Domain entities, use case, error mapping, print-id derivation, config parsing, placeholder renderer determinism | Every PR and locally |
| Contract | Vitest + Ajv | Schema acceptance/rejection, fixture round-trips, generated-type compilation | Every PR |
| Integration | Vitest + LocalStack | Handler against real SQS/S3 APIs, DLQ redrive, callback delivery, presign | Every PR with LocalStack service container |
| Infrastructure | Terraform + tflint | `fmt -check`, `init -backend=false`, `validate`, `tflint`, `plan` | Every PR (plan via OIDC) |
| E2E | Deployed smoke | `_smoke` job through the deployed queue to the SQS callback | Every release and manual rollback |
| Local | docker-compose | Same worker as plain Node against LocalStack and callback sink | Developer command |

## Scenario coverage

| Scenario | Level | Primary assertion |
|---|---|---|
| S-001 | Unit + integration | One job produces one result |
| S-002 | Unit + contract | `refId` deep-equals the submitted value |
| S-003 | Contract | Valid fixture passes and generated type compiles |
| S-004 | Contract | Missing `templateId` fails; no handler work |
| S-005 | Integration | S3 object exists; success payload fields are correct |
| S-006 | Unit + integration | `TEMPLATE_NOT_FOUND`, no retry |
| S-007 | Integration | Receive count exhausts; message reaches DLQ |
| S-008 | Unit + integration | Failure result delivered with `attempts`; message deleted |
| S-009 | Infrastructure + integration | Lifecycle rule is one day; presign TTL matches config |
| S-010 | Infrastructure | Queue policy denies an unlisted principal |
| S-011 | Unit + infrastructure | Unsupported/unlisted target produces `CALLBACK_NOT_ALLOWED`; IAM policy is scoped |
| S-012 | E2E | SemVer release deploys via OIDC with no static keys |
| S-013 | E2E | `sha-<short>` release deploys without a tag |
| S-014 | E2E | Smoke result within 60 seconds |
| S-015 | E2E | Rollback applies an earlier release and passes smoke |
| S-016 | Infrastructure | Bootstrap outputs and backend locking exist |
| S-017 | Infrastructure | Queue, bucket, KMS, Lambda, alias and mapping exist; alarms off |
| S-018 | CI | All required checks pass for a valid PR |
| S-019 | CI | Invalid contract/Terraform fails the required check |
| S-020 | CI/local | Commitlint rejects a non-conventional message |
| S-021 | Repository policy | Squash merge yields one commit and linear history |
| S-022 | Local E2E | LocalStack object and sink success |
| S-023 | Local E2E | Sink records `TEMPLATE_NOT_FOUND` |

## Failure-path priorities

1. **Message validation:** malformed payload, missing required field, unknown field, wrong
   channel shape, disallowed PDF/A level.
2. **Template resolution:** unknown id/slug, ambiguous input, manifest corruption.
3. **Rendering:** placeholder throws, empty bytes, oversized output.
4. **Storage:** S3 failure, KMS denial, presign failure.
5. **Delivery:** SQS failure, missing callback, unsupported channel, IAM denial.
6. **Retry/terminal:** retryable error on attempts 1–4, last attempt sends failure, callback
   failure leaves the message for the DLQ.
7. **Security:** unlisted sender, unlisted callback ARN, environment parse failure, no secrets in
   logs.

## Contract test matrix

- Valid job: minimal (`templateId`, `refId`, `webhooks.success`).
- Valid job: full options, payload, failure callback, all five channel shapes.
- Invalid: missing `templateId`, missing `refId`, missing `webhooks.success`, wrong `refId` type,
  bad slug/UUID, bad `pdfA`, `s3` failure channel, non-HTTPS `http` value, unknown top-level
  field.
- Valid success result: SQS callback with `printing` + `printingExpiresAt`, `pdfA: null`, and a
  PDF/A level.
- Valid success result: `s3` callback without `printing`/`printingExpiresAt`.
- Valid failure result: `template: null` and non-null.
- Invalid: wrong hash length, negative size, unknown error code, missing attempts.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:integration
pnpm template:manifest
pnpm build:worker
pnpm smoke:local
terraform -chdir=infra fmt -check
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
tflint --chdir=infra
```

## Regression risks

| Risk | Guard |
|---|---|
| Placeholder renderer behaviour leaks into the real renderer | Keep it behind `PdfRenderer`; replace via composition root; test the use case with a fake |
| Contract drifts from the generated types | CI regenerates and fails on a dirty diff |
| LocalStack passes where AWS fails | Deployed smoke is authoritative; adapter tests use the AWS SDK, not hand-rolled fakes |
| Terraform changes destroy state/artifacts | Plan review; state bucket versioned; no lifecycle on state/artifacts |
| Smoke test flakiness | Bounded polling with backoff and a 60 s deadline; log the queue and job id |
| Logs leak PII | Logger allowlist and a unit test asserting payload/refId are not logged |
