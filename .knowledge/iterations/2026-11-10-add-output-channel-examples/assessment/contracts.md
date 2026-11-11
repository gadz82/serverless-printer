# Contracts

- Each `job.json` must satisfy the existing job JSON Schema (`templateId`, `refId`, `webhooks`,
  optional `options.pdfA`, optional `payload`).
- The EventBridge ingress `event.json.detail` must satisfy the same job schema.
- `config.tfvars.example` files are snippets for `TF_VARS`/manual tfvars, not standalone files.
- No contract or worker change.
