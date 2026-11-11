# P-001 implementation report

- Prompt: P-001 — Add eight output-channel examples and contract validation
- Status: complete

## Delivered

- `examples/README.md` matrix and SQS payload guide.
- Eight examples, each with `README.md`, `config.tfvars.example` and `sqs-payload.json`:
  1. HTTP standard
  2. HTTP PDF/A-2b
  3. Lambda callback
  4. SQS FIFO callback
  5. EventBridge callback
  6. S3 PDF/A presigned PUT
  7. Private HTTP via VPC
  8. EventBridge ingress (`event.json` + resulting SQS payload)
- Every SQS payload is a complete job body, not an SQS event envelope; the ingress `detail` equals
  its `sqs-payload.json`.
- `tests/examples/examples.test.ts`: 2 tests validating all payloads, ingress detail, required
  files, 6–8 cap, unique refIds and all five output channels.
- Root README SQS payload section and examples link; usage guide links the examples.

## Examples matrix

| # | Channel | PDF | Configuration |
| --- | --- | --- | --- |
| 1 | http | standard | allowlist + ping |
| 2 | http | PDF/A-2b | archival output |
| 3 | lambda | standard | async invocation |
| 4 | sqs | standard | FIFO callback |
| 5 | eventBridge | standard | bus detail |
| 6 | s3 | PDF/A-2b | presigned PUT, HTTP failure |
| 7 | http | standard | VPC private callback |
| 8 | EventBridge ingress | standard | `job_rule` + SQS output |

## Acceptance

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/examples` | PASS — 2/2 |
| `pnpm test` | PASS — 618 tests |
| `pnpm typecheck` / `lint` / Prettier | PASS |
| Relative link/anchor scan | PASS |

## Review

Independent review: PASS. Fixed the README payload/example mismatch and the documented test
command.

## Residual risks

- No live sends; examples are configuration references with placeholders.
- Presigned S3 URLs and ARNs must be replaced.
- Example contract validation covers the job shape, not live channel delivery.
