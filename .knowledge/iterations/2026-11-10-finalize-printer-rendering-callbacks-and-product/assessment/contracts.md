# Contract assessment

## Job/result contract

No breaking change. Phase 3 implements the already-modelled `pdfA` levels and all five channels;
the result shape and error codes remain. `PDFA_ALLOWED_LEVELS` returns to every level by default.

## Delivery contract

- HTTP: POST JSON, `X-Printer-Print-Id`, 5 s timeout, 2xx delivered, ping after.
- Lambda: `Invoke` Event; body is the result.
- SQS: existing FIFO rules; ping after.
- EventBridge: `PutEvents` with `EVENT_SOURCE` and `printer.print.succeeded|failed`.
- S3: presigned PUT, `Content-Type: application/pdf`; `printing`/`printingExpiresAt` omitted.
- Failures follow the existing error codes and retry/terminal rules.

## Terraform role contract

| Variable | Mode | Meaning |
|---|---|---|
| `caller_role_mode` | `create` (default) / `existing` | Generate the integrator role or use an ARN |
| `caller_role_arn` | existing | Provided caller role; added to jobs queue senders, not modified |
| `caller_trusted_principal_arns` | create | Principals allowed to assume the generated caller role (default: deployer account root) |
| `worker_role_mode` | `create` (default) / `existing` | Generate the Lambda execution role or use an ARN |
| `worker_role_arn` | existing | Same-account role trusting `lambda.amazonaws.com`; not modified |
| `additional_worker_role_arns` (bootstrap) | existing | ARNs the deploy role may pass to Lambda |

Outputs: `caller_role_arn`, `worker_role_arn`, `caller_role_created`, `worker_role_created`.

## Role policies

- **Generated caller:** `sqs:SendMessage` only on the jobs queue; trust configured principals.
- **Generated worker:** consume jobs; S3 prints/KMS/logs; `lambda:InvokeFunction`,
  `sqs:SendMessage`, `events:PutEvents` only on `callback_target_arns`; smoke queue send; VPC ENI
  when selected. No jobs-queue send.
- **Provided:** owner supplies equivalent permissions/trust; the stack does not attach policies.

## Compatibility

Caller role: cross-account via trust is allowed. Worker role: same-account only. A shared role is
rejected by design. Any contract/role change is additive or documented with an ADR.
