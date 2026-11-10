# PRD — Complete the Printer service

- Iteration: `2026-11-10-complete-the-printer-service-with-templates-rend`
- Technical only: no
- Source: `SPEC.md` v0.4, remaining kickoff phases 2–4 plus the first cloud verification

## Problem

The Phase 1 foundation exists: contracts, the domain use case, an SQS/Lambda worker with a
placeholder renderer, transient S3 storage, SQS result delivery, Terraform bootstrap/module,
LocalStack and the release workflow. The service still cannot do the job the specification
describes: it cannot render real HTML/Handlebars templates, cannot produce PDF/A, cannot deliver
results over any channel except SQS, has no template authoring/validation tooling, no optional
network support, no render regression or load evidence, and no production runbook.

Callers cannot yet send a real business template and receive a production PDF through their
chosen callback. Template maintainers cannot create, validate or preview templates. Operators
cannot verify the service in AWS or run it confidently.

## Users and personas

- **Caller teams** — submit jobs for real templates and receive PDFs through their chosen
  callback.
- **Template maintainers** — add, validate, preview and evolve templates in Git.
- **Operators** — deploy, monitor, roll back, redrive DLQ messages and remove templates safely.
- **Developers** — extend the renderer, channels and templates with a reliable local path.

## Current behaviour

- The renderer is a deterministic placeholder; payload and template content are ignored.
- Only the `sqs` result channel exists; `http`, `lambda`, `eventBridge` and `s3` are rejected.
- PDF/A requests are rejected because no archiver exists.
- There is no template engine, no `template:*` tooling, no placeholder AST and no real business
  template.
- `vpc_mode` only supports `none`.
- No render regression, no load test, no production alarms/runbook, and no deployed AWS
  verification.

## Desired outcome

Complete the specification's remaining product behaviour in three staged slices, in this order:

1. **Templates and network** — a real template engine and tooling; a real template renders by id
   and slug; the optional network module supports the documented VPC modes.
2. **Rendering and delivery** — Chromium rendering, PDF/A post-processing at every level, all
   five result channels, ping and callback allowlist/SSRF enforcement.
3. **Production readiness and cloud verification** — render regression, throughput evidence,
   alarms, runbook, plain and PDF/A smoke tests, first real template live, bootstrap/OIDC deploy,
   rollback and branch protection.

The iteration may split into follow-up iterations at the planning gate if the cost estimate
exceeds the configured budget; the slices above are the delivery order.

## Flows

### Caller flow

1. A caller submits a job with a template id or slug, payload, optional PDF/A level, success and
   failure callbacks.
2. The worker validates, resolves the template, renders HTML/Handlebars with the agreed mode and
   helpers, and produces a PDF.
3. If requested, PDF/A post-processing converts the PDF to the requested level.
4. The worker stores the print unless the success channel is `s3`, then delivers the result on
   the chosen channel and sends the ping.
5. The caller receives the success result with the print URL/hash/template metadata, or a
   failure result with the documented code.

### Template-maintainer flow

1. `pnpm template:new <slug>` creates the folder and a fresh UUID identity.
2. The maintainer edits the Handlebars template, CSS, fonts, assets and `sample.json`.
3. `pnpm template:validate` checks identity, compilation, sample data and bundled-font warnings.
4. `pnpm template:check --base origin/main` rejects id/slug changes and slug reuse.
5. `pnpm template:preview <slug>` renders the sample or supplied data locally, optionally as
   PDF/A.
6. The manifest is regenerated, bundled and attached to releases; a template renders by id and
   slug after deploy.

### Operator flow

1. Apply bootstrap once, configure repository variables and enable branch protection.
2. Push to `main`; semantic-release cuts a release, builds/uploads the worker and applies
   Terraform through OIDC.
3. The release workflow runs plain and PDF/A smoke jobs.
4. Alarms, the runbook, DLQ redrive and rollback cover failures.
5. Dispatching an earlier release rolls back.

## Business rules

- One message produces exactly one print; the queue is the only entry point.
- Templates are static folders in Git; identity is an immutable UUID and slug; no versions or
  statuses. Removing a template makes queued jobs fail with `TEMPLATE_NOT_FOUND`.
- Handlebars is the template language, with a fixed helper set and prototype access disabled.
  `HANDLEBARS_MODE` controls lenient, strict and assume-objects behaviour.
- The renderer runs with JavaScript disabled and blocks every request except bundled files and
  data URIs.
- PDF/A is a per-job option; conformance is best effort, not validated by CI or production.
- The service never keeps prints beyond the one-day lifecycle.
- `refId` is echoed unchanged; `printId` is deterministic; callers deduplicate.
- Callbacks are restricted by the allowlist and `callback_target_arns`; DNS and SSRF checks apply.
- No API, UI, database, environment, template upload or template versioning.
- No static AWS credentials anywhere; OIDC only.

## Success metrics

- A real template added in the repository renders by id **and** by slug after deploy, plain and
  as PDF/A-2b.
- All five result channels pass end-to-end with and without PDF/A, including ping and the
  documented failure paths.
- `template:new`, `validate`, `check` and `preview` work; invalid identities, compilation errors
  and sample mismatches fail; font warnings appear without failing.
- The render regression suite passes on `ubuntu-latest`/x86_64, covering plain and PDF/A output.
- The load test meets the agreed throughput target (to be fixed in assessment; candidate: 10
  jobs/min peak, 20-page document, p95 under 30 seconds).
- Deployed smoke passes once plain and once with PDF/A; rollback to an earlier release passes.
- The runbook covers rollback, DLQ redrive, template removal, KMS/state recovery and alarm response.
- No static AWS keys; least-privilege IAM covers the new channels and network.

## Non-goals

- Template editor, UI or API; runtime template upload; template versioning or statuses.
- Multiple environments; a database; third-party monitoring; PDF/A validation.
- A human-facing endpoint; the SQS queue remains the only entry point.
- Rewriting the Phase 1 contracts unless a genuine breaking change is required and recorded.

## Assumptions and risks

- **Staged delivery:** the remaining scope is large. Planning may split it into follow-up
  iterations while preserving this order.
- **AWS/remote:** the first cloud verification needs the GitHub remote, AWS account, bootstrap
  apply, `TF_VARS` and repository variables; the operator supplies them.
- **Chromium packaging:** `puppeteer-core` must match the Chromium major shipped by
  `@sparticuz/chromium` and run on Node 24/x86_64; CI uses the package and local preview uses an
  installed Chrome.
- **PDF/A:** conformance is best effort; part-1 and `a` levels may be limited by Chromium output.
- **Network:** create/lookup modes, endpoints and NAT add cost and apply-time complexity.
- **Throughput:** the specification's open item is still unresolved; the target must be agreed
  before load testing.
- **Template content:** a real template must be authored or supplied; the spec's
  generic business report (`generic-report`) is the candidate.

## Open questions

- Confirm the throughput target (jobs/minute, acceptable latency, document size mix).
- Confirm the AWS account/region and the VPC mode/inputs for cloud verification.
- Confirm the real template content and sample data to ship first.
- Confirm the alarm SNS topic and callback allowlist/targets for the first deployment.

These are assessment/operator inputs, not blockers for the intent gate.
