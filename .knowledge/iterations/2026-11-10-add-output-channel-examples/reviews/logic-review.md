# Logic review — output channel examples

- Iteration: `2026-11-10-add-output-channel-examples`
- Scope: eight examples, explicit SQS payloads, config snippets and contract validation

## Verdict

Recommend G6 approval. The examples cover all five output channels plus PDF/A, VPC and EventBridge
ingress; every SQS payload validates; the EventBridge ingress detail matches its SQS body. No
blocking finding.

## Evidence

| Check | Result |
| --- | --- |
| `pnpm exec vitest run tests/examples` | PASS — 2/2 |
| `pnpm test` | PASS — 618 tests |
| typecheck / lint / Prettier | PASS |
| Examples count and folder structure | 8, expected files present |
| Channel coverage | http, lambda, sqs, eventBridge, s3 |
| SQS payloads | all valid `validateJob`, unique refIds |
| EventBridge ingress | `event.json.detail` equals `sqs-payload.json` |
| README/usage links | SQS payload and examples linked |

## Residual risks

- No live sends; placeholders (example.com, account ids, ARNs, presigned URL) must be replaced.
- Contract validation checks job shape, not live channel delivery.
- Presigned S3 URLs are success-only; failure uses HTTP in example 6.
