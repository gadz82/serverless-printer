# P-204 implementation report

- Prompt: P-204 — Implement all five delivery channels and worker integration
- Branch: `orchid/2026-11-10-finalize-printer-rendering-callbacks-and-product/P-204`
- Status: complete

## Delivered

- `TemplatePdfRenderer`: resolves `bundlePath`, compiles with the configured Handlebars mode and
  delegates to Chromium with the template directory as base.
- Composition wires Chromium (Lambda) or local Chrome (non-Lambda/`PDF_RENDERER`), pdf-lib
  archiver, callback policy, all five channels, ping, print repository and PDF/A config. PDF/A
  defaults to all eight levels when the env var is unset.
- HTTP with `X-Printer-Print-Id`, 5 s timeout, 2xx, allowlist/SSRF/pinned DNS/no redirects;
  Lambda Invoke Event; EventBridge PutEvents; SQS FIFO; S3 PDF PUT with HTTPS/SSRF guard, pinned
  transport, private-endpoint opt-in, timeout and no printing fields.
- Invalid-message failure webhooks support http/lambda/sqs/eventBridge with policy; s3 rejected.
- `PdfDestination` port for the S3 PDF path; `CallbackNotAllowed` preserved; optional printing
  fields for S3; worker docs updated.

## Review

Two independent reviewers. Fixed S3 loopback/private SSRF and DNS pinning, local-vs-Lambda
renderer selection, HTTP address fallback, S3 timeout/terminal errors, ping log code, catalog
pins, invalid-message channels, PDF/A defaults, and worker docs. Final verdicts: PASS/approve.
The release banner collision was fixed on main (`createRequire` alias); `pnpm build:worker` passes
but the zip still lacks Chromium packaging (P-209).

## Acceptance

| Check | Result |
|---|---|
| Domain/worker tests | PASS — 37 + 286 |
| Full `pnpm test` | PASS — 614 tests |
| Typecheck, lint, Prettier | PASS |
| Local integration (macOS) | PASS — 6/6, local Chrome |
| `pnpm build:worker` on main | PASS — 1.2 MB zip (no Chromium yet) |

## Residual risks

- P-209 must externalize/copy Chromium bin and dependency closure; the zip is incomplete.
- Terraform does not yet pass `PDF_RENDERER`/`S3_ALLOW_PRIVATE_ENDPOINT`; defaults are safe.
- S3 30 s timeout plus 50 s render leaves tight 60 s Lambda headroom.
- LocalStack S3 presigns HTTP; the S3 channel is unit-tested, not locally e2e.
- Root README still has Slice 1 wording (P-211).
