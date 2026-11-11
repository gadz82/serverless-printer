# TRD — Output channel examples

## Layout

```text
examples/
├── README.md
├── 01-http-standard/
│   ├── README.md
│   ├── job.json
│   └── config.tfvars.example
├── 02-http-pdfa/
├── 03-lambda-callback/
├── 04-sqs-fifo/
├── 05-eventbridge-callback/
├── 06-s3-pdfa/
├── 07-private-http-vpc/
└── 08-eventbridge-ingress/
    ├── README.md
    ├── event.json
    └── config.tfvars.example
```

Each `job.json` is a complete SQS message body using the `generic-report` template with synthetic
data. The ingress example uses an EventBridge event whose `detail` is the job body.

## Example contract

- `job.json`: `templateId`, `refId`, `options`, `webhooks`, `payload`; valid against
  `packages/contracts`.
- `config.tfvars.example`: only the inputs relevant to the example, with comments; callers append
  them to `TF_VARS` or a manual tfvars file.
- `README.md`: what it demonstrates, required config, expected delivery/result, security notes and
  a send command.
- Channel-specific placeholders:
  - HTTP: allowlisted HTTPS URL and optional ping.
  - Lambda/EventBridge/SQS: matching `callback_target_arns` ARN.
  - S3: HTTPS presigned PUT URL; failure uses HTTP or SQS.
  - VPC: `vpc_mode`, subnet/security group inputs and private callback allowlist.
  - Ingress: `job_rule` and an output callback target.

## Validation

Add `tests/examples/examples.test.ts` (Vitest) that:

- enumerates `examples/*/`;
- requires `README.md`, `config.tfvars.example` and `job.json` or `event.json`;
- validates `job.json` with `validateJob`;
- validates the ingress `event.json.detail` with `validateJob`;
- asserts at least six and at most eight examples and unique refIds/channels.

No runtime dependency is added; the test imports the contracts package and Node fs.

## Docs

- `examples/README.md` is the matrix and usage guide.
- Root `README.md` links it under documentation.
- `docs/usage.md` links the examples for each channel.

## Risks

- Placeholders can be mistaken for real resources; each README states replacement is required.
- Examples can drift from contracts; the test prevents that for job shape.
- No live delivery is tested; examples are configuration/job references.
