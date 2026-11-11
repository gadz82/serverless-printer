# PRD — Output channel examples

## Problem

The README and usage guide describe the five callback channels, but there is no set of
copy-pasteable, validated examples showing the job JSON and Terraform configuration each channel
needs. Callers must assemble this from the specification and provider docs.

## Scope

Create an `examples/` folder with at most eight focused examples. Each example contains a valid
job (or EventBridge event), a README explaining the channel and prerequisites, and a
`config.tfvars.example` snippet for the required Terraform inputs.

The eight examples focus on the output path:

1. HTTP callback, standard PDF.
2. HTTP callback, PDF/A-2b.
3. Lambda callback.
4. SQS FIFO callback.
5. EventBridge callback.
6. S3 presigned-PUT callback, PDF/A-2b.
7. Private HTTP callback through a VPC.
8. Optional EventBridge job ingress (event `detail` → jobs queue).

Add a test that validates every `job.json` (and the ingress event `detail`) against
`@printer/contracts` and checks the folder structure, so examples cannot silently rot.

## Out of scope

- Application, worker, Terraform module or infrastructure changes.
- Real AWS deployment or sending the examples.
- Additional channels beyond the documented five.
- More than eight examples.

## Acceptance

- `examples/README.md` links every example and states the channel/configuration matrix.
- Every example has `README.md`, a valid job/event JSON and `config.tfvars.example`.
- `pnpm test` validates all examples against the contracts.
- Markdown links/anchors resolve; Prettier/lint/typecheck pass.
- Root README links the examples index.

## Decisions

- Work stays on `main` with a short-lived prompt branch, consistent with the previous small
  follow-up.
- Placeholders (`example.com`, AWS account `123456789012`) are non-secret and intended to be
  replaced.
