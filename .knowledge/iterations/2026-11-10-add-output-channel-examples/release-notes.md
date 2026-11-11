# Release notes — output channel examples

## Shipped

- `examples/` with eight focus areas: HTTP standard, HTTP PDF/A-2b, Lambda, SQS FIFO, EventBridge,
  S3 PDF/A, private HTTP via VPC and EventBridge ingress.
- Every folder has `README.md`, `config.tfvars.example` and an explicit `sqs-payload.json`
  (`event.json` for ingress).
- Root README SQS payload guide and examples link; usage guide links the examples.
- `tests/examples/examples.test.ts` validates all payloads, ingress detail, required files,
  example count, unique refIds and channel coverage.

## Verification

- Examples tests 2/2; repository suite 618 tests; typecheck, lint, Prettier pass.
- No live sends; placeholders require replacement.

## Limitations

- Examples are configuration references, not deployed resources.
- Presigned S3 URLs/ARNs/account ids are placeholders.
- Contract validation does not prove live channel delivery.
