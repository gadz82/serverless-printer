# P-202 implementation report

- Prompt: P-202 — Implement the PDF/A archiver for all levels
- Branch: `orchid/2026-11-10-finalize-printer-rendering-callbacks-and-product/P-202`
- Status: complete

## Delivered

- `PdfArchiver` port and `ProcessPrintJob` integration: archive after render only when a level is
  requested; failures map to non-retryable `PDFA_CONVERSION_FAILED` before storage.
- pdf-lib adapter for all eight levels: PDF version/document ID, sRGB ICC output intent, XMP
  part/conformance UTF-8, Info producer/title/date/language, Creator → CreatorTool consistency.
- Encryption, JavaScript and unembedded-font safety checks (Type1/Type0/Type3); strict malformed
  object handling.
- Bundled ICC-published sRGB2014 profile with source/license/hash documentation.
- Composition root injects the archiver but keeps the interim empty PDF/A allowlist until P-204.

## Review

Two independent reviewers; fixed critical XMP UTF-8 encoding, PDF/A-1 Creator/XMP consistency,
interim allowlist behavior, dead header assignment, malformed-object parsing, and font coverage.
Final verdicts: PASS/APPROVE.

## Acceptance

| Check | Result |
|---|---|
| `pnpm --filter @printer/domain test` | PASS — 30 tests |
| `pnpm --filter @printer/render-worker test` | PASS — 151 tests |
| Domain/worker typecheck, lint, Prettier | PASS |
| `pnpm test` on main after merge | PASS — 472 tests |
| `xmllint` on emitted XMP | PASS |

## Residual risks

- PDF/A remains best effort; part-1/a accessibility/transparency and no validator.
- Info entries other than Creator (Author/Subject/Keywords) are not mirrored; Chromium currently
  does not emit them.
- Chromium non-ASCII title mojibake is preserved; P-204/P-205 should revisit metadata/title.
- Header rewrite assumes pdf-lib's fixed 8-byte header.
- P-204 must switch the allowlist to config, remove the interim warning and wire the Chromium
  renderer; the handoff is recorded in this report.
