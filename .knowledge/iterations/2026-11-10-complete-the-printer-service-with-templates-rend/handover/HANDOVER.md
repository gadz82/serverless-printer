# Handover — Slice 1: templates and network

- Iteration: `2026-11-10-complete-the-printer-service-with-templates-rend`
- Status: closed; G8 handover review
- Approved scope: Slice 1 (R-101–R-106), with Slices 2–3 as follow-up iterations (ADR-107)

## What changed and why

The service can now author and validate real templates with one shared Handlebars engine, render a
real `generic-report` template to PDF with locally installed Chrome, and optionally run the worker
inside a created or looked-up VPC.

This is the first half of the remaining specification work. Chromium Lambda packaging, PDF/A, the
other four result channels, render regression, load testing, alarms, runbook, plain/PDF-A smoke and
the first cloud verification are the follow-up Slices 2–3.

## Architecture delta

- `packages/template-engine` — Handlebars modes, fixed helpers, prototype-safe placeholder AST,
  deterministic hashing, manifest, descriptor validation.
- `scripts/template-new|validate|check|preview|manifest` — template authoring, guard and preview.
- `templates/generic-report` — the first real self-contained generic business template.
- `apps/render-worker/src/rendering/local-chrome-renderer.ts` — local Chrome preview with JS off,
  request blocking and the page settings Slice 2 will reuse.
- `infra/modules/network` — `none`/`create`/`lookup`, private subnets, optional NAT, S3 gateway and
  SQS/Lambda/Events interface endpoints; printer/root VPC wiring and conditional ENI IAM.
- `.github/workflows/ci.yml` — a `templates` job running validate and identity check.
- README/tfvars/docs updated for the template and network workflows.

## Decisions and rejected alternatives

- **ADR-101** — shared engine + thin CLI; rejected scripts-only duplication.
- **ADR-102** — local Chrome now, `puppeteer-core`/`@sparticuz/chromium` for Slice 2; rejected
  custom images.
- **ADR-103** — pdf-lib PDF/A best effort; rejected binary archivers and false claims.
- **ADR-104** — five channel adapters behind one delivery port and one callback policy.
- **ADR-105** — optional network with `none` default; rejected always-VPC.
- **ADR-106** — candidate throughput target pending confirmation.
- **ADR-107** — three staged slices; this iteration is Slice 1.

The example template in `SPEC.md` is illustrative only; the iteration implements the generic
`generic-report` template.

## Reading order

1. `packages/template-engine/src/compile-template.ts#compileTemplate` — ORCHID-MEM:
   `01a1c51f-3f91-786a-b869-f8fc6cc335f4` — modes/helpers/security — engine tests
2. `packages/template-engine/src/extract-placeholders.ts#extractPlaceholders` — ORCHID-MEM:
   `01a1c51f-4010-7adb-9a80-cc229f720c94` — placeholder AST — engine tests
3. `packages/template-engine/src/build-manifest.ts#buildManifest` — ORCHID-MEM:
   `01a1c51f-4088-78ce-b103-197da857f991` — hashing/manifest — engine tests
4. `apps/render-worker/src/rendering/local-chrome-renderer.ts#LocalChromeRenderer` — ORCHID-MEM:
   `01a1c51f-4103-7564-a29a-ff3468f66402` — local preview — worker tests
5. `scripts/template-validate.mjs#validateTemplates` — ORCHID-MEM:
   `01a1c51f-4183-76ad-b5fd-a13d1ce22f96` — validation — CLI tests
6. `scripts/template-check.mjs#checkTemplates` — ORCHID-MEM:
   `01a1c51f-4207-7ab3-ac69-281c356e1ffe` — identity guard — CLI tests
7. `scripts/template-preview.mjs#previewTemplate` — ORCHID-MEM:
   `01a1c51f-4289-7e73-8075-584669d85127` — preview CLI — CLI tests
8. `templates/generic-report/index.html` — the real template and sample data
9. `infra/modules/network/main.tf` — `none`/`create`/`lookup` network
10. `infra/modules/printer/lambda.tf` and `infra/modules/printer/iam.tf` — conditional VPC config and ENI IAM
11. `.github/workflows/ci.yml` — the `templates` job
12. `README.md` and `infra/README.md` — commands, modes and Slice 2/3 scope

## How to run and test

```bash
pnpm install --frozen-lockfile
pnpm template:validate
pnpm template:check --base HEAD
pnpm template:preview generic-report
pnpm --filter @printer/template-engine test
pnpm --filter @printer/render-worker test
pnpm test
pnpm lint
pnpm typecheck
pnpm exec prettier --check .
orchid-sdd lint
orchid-sdd index --check
terraform -chdir=infra init -backend=false -input=false
terraform -chdir=infra validate
tflint --config="$PWD/tflint.hcl" --chdir=infra --call-module-type=all
```

`template:preview` needs an installed Chrome or `CHROME_PATH`. CI uses `origin/main` for the
identity check and must mark the `templates` job required.

## How to roll back

- Revert the Slice 1 commits on `main`; there is no database or persistent business data.
- Set `vpc_mode = none` (the default) to detach the worker from a VPC; no network resources are
  created in that mode.
- Remove `templates/generic-report` and regenerate the manifest; queued jobs for it then fail with
  `TEMPLATE_NOT_FOUND`. `_smoke` remains.
- Revert the `templates` CI job independently if it blocks merges.
- No production data migration is required; prints remain transient.

## Risks, gaps, and follow-ups

- **Slice 2:** Chromium Lambda packaging, PDF/A, HTTP/Lambda/EventBridge/S3 channels, ping,
  allowlist/SSRF enforcement, render regression.
- **Slice 3:** throughput target, Power Tuning, load test, alarms, runbook, plain/PDF-A smoke,
  first real template live, first cloud verification.
- **Bootstrap deploy role** lacks EC2/VPC permissions; VPC-mode apply needs an admin profile or a
  bootstrap policy expansion. `none` is unaffected.
- **Local Chrome** allows all `file:` URLs; scope to the template/bundle directory before Lambda
  reuse.
- **Placeholder extraction** flattens `../` depth and does not expand item fields; runtime mode
  wrappers cover the control/helper cases.
- **Branch protection** and the required `templates` check must be enabled on the remote.
- **No live AWS/CI** has run yet; the first cloud verification remains deferred.
