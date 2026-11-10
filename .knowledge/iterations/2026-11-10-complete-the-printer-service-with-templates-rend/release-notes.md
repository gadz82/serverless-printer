# Release notes — Slice 1: templates and network

## Shipped

- Shared `@printer/template-engine`: Handlebars lenient/strict/assume-objects modes, fixed helpers,
  prototype-safe placeholder AST, deterministic hashing and manifest construction.
- Template CLI: `template:new`, `template:validate`, `template:check`, `template:preview` and
  `template:manifest`.
- Real `generic-report` template with a stable UUID identity, semantic HTML, self-contained CSS
  and generic sample data.
- Local Chrome preview with JavaScript disabled, external requests blocked, A4/tagged output and
  the same page settings the Lambda renderer will use.
- Optional `infra/modules/network` with `none` (default), `create` and `lookup`, endpoints,
  optional NAT and conditional worker VPC/ENI configuration.
- CI template validation and identity checks.

## Verification

- 411 tests pass, including engine, CLI, worker and LocalStack suites.
- `template:validate` and `template:check --base HEAD` pass; `generic-report` previews to PDF.
- Terraform fmt/init/validate/TFLint pass; `none`/`create`/`lookup` plans were exercised.
- Lint, typecheck, Prettier, `orchid-sdd lint` (19 anchors/docblocks) and index checks pass.

## Known limitations and follow-ups

- **Slice 2:** Chromium Lambda packaging, PDF/A post-processing, HTTP/Lambda/EventBridge/S3
  callbacks, ping, allowlist/SSRF enforcement and render regression.
- **Slice 3:** throughput target, Power Tuning, load test, alarms, runbook, plain/PDF-A smoke,
  first real template live and first cloud verification.
- VPC apply through the OIDC deploy role needs the bootstrap deploy role's EC2/VPC permissions
  expanded; `vpc_mode = none` is unaffected.
- PDF/A preview is rejected until Slice 2.
- Local Chrome `file:` requests are not yet scoped to the template directory; required before
  Lambda reuse.
- Branch protection and the required `templates` CI check must be enabled on the remote.
