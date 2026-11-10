# P-205 implementation report

- Prompt: P-205 — Add render regression and cross-channel integration tests
- Status: complete

## Delivered

- `scripts/render-regression.mjs`: renders `generic-report` with the real Lambda
  `ChromiumPdfRenderer` and `PdfLibPdfArchiver`, compares page count (`pdfinfo`), layout text
  (`pdftotext -layout`) and one SHA-256 per 72 dpi grayscale page (`pdftoppm`), with
  `--update`/`--check`/`--allow-skip`, poppler timeouts and `renderer.close()`.
- `FONTCONFIG_PATH=/tmp/fonts` is set for the runner so CI uses the same bundled Open Sans
  fonts that Lambda uses instead of host fonts; the references embed `OpenSans-Regular/Bold`.
- PDF/A-2b marker guard reads the decompressed XMP and requires `%PDF-1.7`,
  `pdfaid:part=2`, `pdfaid:conformance=B` and the `GTS_PDFA1` output intent, so a no-op
  archiver cannot pass.
- Committed reference PDFs for plain and PDF/A-2b plus the deliberate-template-change test.
- `test:render` script and a dedicated read-only CI job on `ubuntu-latest` x86_64 that installs
  poppler-utils and sets `RENDER_REGRESSION_REQUIRED=1`, so missing prerequisites fail the job.
- `tests/render/README.md` update procedure, comparison surface and pinned environment.

## Reference evidence

| Reference | SHA-256 | Pages | Text SHA-256 | Page-image SHA-256 |
| --- | --- | --- | --- | --- |
| `plain.pdf` | `ab361e62a6d90836bf90a9a905d50be300d7b35d018662ad6874a95288568f5d` | 1 | `0fe694477fa3ac5748cb73bcb42ebe38118c93064e64ed6ab22e9b6aac2a7c6d` | `23265a1fe55f4f5cc2e539b72ebc8d21026633061747db7a8a02060027206c93` |
| `pdfa-2b.pdf` | `26acd1a03779b70bf8fb6fb025fb7dbc7a6acfc5ad50a8e7f16f9fb9733ef8be` | 1 | same | same |

The two PDFs have identical text and page images (PDF/A only adds archival metadata). References
were generated and verified on Ubuntu 24.04 x86_64, Node 24.21.0, pnpm 10.34.9, poppler 24.02.0.

## Failure evidence

- A deliberate change from `Business report` to `Changed report` fails with a `text:` difference.
- `RENDER_REGRESSION_REQUIRED=1` on macOS fails the prerequisite test instead of silently skipping.
- A no-op archiver is rejected by the PDF/A marker check.

## Acceptance

| Command | Result |
| --- | --- |
| `pnpm test:render` on macOS | PASS — 8 passed, 2 skipped (render-only) |
| `RENDER_REGRESSION_REQUIRED=1 pnpm test:render` on Ubuntu 24.04 x64 | PASS — 10/10, including reference match and deliberate-change failure |
| `node scripts/render-regression.mjs --check` on Ubuntu 24.04 x64 | PASS — plain, pdfa-2b |
| `pnpm --filter @printer/render-worker test` | PASS — 286 tests |
| `pnpm test` / typecheck / lint / Prettier on main | PASS — 614 tests |

## Scope note

`package.json` was not in the original P-205 write list but is required by the `pnpm test:render`
acceptance command and to keep `tests/render` out of the default unit suite. The plan scope was
amended before merge.

## Residual risks

- The new CI job only blocks merges once added to branch protection.
- Page-image hashes are poppler-rendered from committed PDFs, so they are robust to host fonts,
  but a future `ubuntu-latest`/poppler change could still require a reference refresh.
- Lambda production font parity depends on `@sparticuz/chromium` detecting AL2023; the runner
  explicitly mirrors that with `FONTCONFIG_PATH=/tmp/fonts`.
- PDF/A remains best effort; the marker check is not a validator.
