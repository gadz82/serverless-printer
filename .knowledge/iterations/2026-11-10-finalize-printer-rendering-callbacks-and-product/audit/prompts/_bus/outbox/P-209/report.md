# P-209 implementation report

- Prompt: P-209 — Add plain and PDF/A release smoke and Chromium packaging
- Status: complete

## Delivered

- `build-worker.mjs` externalizes `@sparticuz/chromium` and packages the full package including
  `bin/chromium.br`, `al2023.tar.br`, `fonts.tar.br`, `swiftshader.tar.br`; resolves and copies the
  19-package runtime closure (`tar-fs`, `pump`, `tar-stream`, `bare-*`, `streamx`, `b4a`, etc.) as
  real directories through the pnpm layout; copies templates, manifest and the sRGB ICC.
- Zip assertions cover every closure package plus the Chromium binaries; the build imports the
  bundled handler and the external Chromium closure, guards the 50 MiB minimum zip and 240 MiB
  unzipped Lambda limit, and uses `zip -X` to drop extra attributes.
- `smoke-test.mjs` sends one plain and one `PDF/A-2b` `_smoke` job with unique refIds and SQS
  success/failure callbacks, waits up to 180 s for both, validates the result contract, asserts
  success/slug/release/`pdfA`/SHA-256/size, deletes received results, and fails on timeout.
  `PDFA_LEVEL_NOT_ALLOWED` gets an explicit allowlist hint.
- Release workflow keeps OIDC/apply/rollback and runs both smoke scenarios; comment records that
  `pdfa_allowed_levels` must include `PDF/A-2b` (Terraform defaults include all eight).

## Zip evidence

| Item | Value |
| --- | --- |
| `dist/render-worker.zip` | 73,645,853 bytes (331 entries) |
| Unzipped payload | 83,622,603 bytes |
| Runtime packages | 19 |
| Chromium binaries | `chromium.br`, `al2023.tar.br`, `fonts.tar.br`, `swiftshader.tar.br` |
| Other required entries | `handler.mjs`, `templates/_smoke/index.html`, `templates.manifest.json`, `pdfa/sRGB2014.icc` |
| Symlinks in zip | 0 |

## Smoke matrix

| Scenario | `options.pdfA` | Expected result `pdfA` | Callback |
| --- | --- | --- | --- |
| plain | `false` | `null` | SQS success + failure |
| pdfa-2b | `"PDF/A-2b"` | `"PDF/A-2b"` | SQS success + failure |

## Acceptance

| Command | Result |
| --- | --- |
| `pnpm build:worker` | PASS — 73,645,853-byte zip, 19 packages |
| `node --check scripts/build-worker.mjs` | PASS |
| `node --check scripts/smoke-test.mjs` | PASS |
| Prettier on release.yml/build-worker/smoke-test | PASS |
| Extracted handler + Chromium closure import | PASS |
| `pnpm test` / typecheck / lint on main | PASS — 614 tests |
| Fake-SQS two-job smoke flow | PASS — both results validated, failure path tested |
| Live AWS smoke | Not run — operator/deploy step |

## Review

Two independent reviewers: PASS. Fixed smoke headroom (180 s), SQS failure webhook, clear
`PDFA_LEVEL_NOT_ALLOWED` diagnostics, full 19-package zip assertions, unzipped-size guard and
`zip -X`.

## Residual risks

- Live Lambda Chromium extraction/launch from the packaged zip is operator-verified only.
- Rollback to a release predating PDF/A will fail the PDF/A smoke by design.
- A `TF_VARS` allowlist without `PDF/A-2b` blocks releases; the workflow comment and smoke error
  document the requirement rather than overriding operator policy.
- `/tmp` must hold the decompressed Chromium payload (~210 MiB); Lambda provides 512 MB.
- Packaging is validated in the release job, not PR CI.
