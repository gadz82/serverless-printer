# Render regression

The render regression suite renders the `generic-report` template with the
same Linux x86_64 Chromium that runs in Lambda, then compares the output with
two committed reference PDFs:

- `reference/generic-report/plain.pdf` — the unmodified render.
- `reference/generic-report/pdfa-2b.pdf` — the same render archived as
  PDF/A-2b by `PdfLibPdfArchiver`.

For each scenario the comparison checks the page count (`pdfinfo`), the layout
text (`pdftotext -layout`) and one SHA-256 per page image (`pdftoppm -r 72
-gray -pgm`). PDF metadata (creation dates, document IDs, XMP) is intentionally
not compared because PDF/A archiving legitimately changes it.

## Running

```sh
pnpm test:render
```

The suite requires Linux x86_64, `@sparticuz/chromium` (already a worker
dependency) and poppler-utils. On macOS or without poppler the suite skips
locally; CI sets `RENDER_REGRESSION_REQUIRED=1`, so missing prerequisites fail
the render-regression job instead of skipping it.

The same checks can be run without Vitest:

```sh
# --allow-skip exits 0 on macOS or without poppler; CI runs without it.
node scripts/render-regression.mjs --check --allow-skip
```

## Updating the references

Only update the reference PDFs for an intentional rendering change, and only
on Linux x86_64 with poppler-utils. The references are pinned to
`@sparticuz/chromium` 153.0.0 and its bundled Open Sans fonts. The runner sets
`FONTCONFIG_PATH` to the extracted `/tmp/fonts` directory, which is what the
package does on Lambda, so the references exercise the production font stack
and a different Chromium build must not be used to regenerate them.

1. Confirm the dependency versions in `pnpm-workspace.yaml`
   (`@sparticuz/chromium` and `puppeteer-core`).
2. Run the updater on Linux x86_64 (for example the render-regression CI
   container or a Linux workstation):

   ```sh
   pnpm install --frozen-lockfile
   node scripts/render-regression.mjs --update
   ```

3. Inspect the printed hashes and the two PDFs (`pdftotext`, `pdftoppm`) to
   confirm the change is the one you intended. The updater validates every
   scenario, including the PDF/A markers, before replacing any reference.
4. Run `pnpm test:render` twice to confirm the new references are stable.
5. Commit both PDFs with the change that caused them.

The references were generated and verified on Ubuntu 24.04 x86_64 with Node
24.21.0, pnpm 10.34.9 and poppler 24.02.0. Page-image hashes are produced by
poppler from the committed PDFs, so the CI runner's system font set does not
affect the comparison; the rendered pages themselves use the bundled Open
Sans fonts.

The deliberate-change test in `render-regression.test.ts` mutates the template
heading and asserts that the comparison fails, which guards against a suite
that silently compares a PDF with itself.

## CI

The `render-regression` job in `.github/workflows/ci.yml` installs
poppler-utils on `ubuntu-latest` and runs `pnpm test:render` with
`RENDER_REGRESSION_REQUIRED=1`. It is independent of the LocalStack
integration job.
