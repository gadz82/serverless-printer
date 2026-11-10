# P-201 implementation report

- Prompt: P-201 — Add the Lambda Chromium renderer and shared page settings
- Branch: `orchid/2026-11-10-finalize-printer-rendering-callbacks-and-product/P-201`
- Status: complete

## Delivered

- Shared page settings, request policy, HTML/base helpers and render-page flow for local and Lambda.
- `ChromiumPdfRenderer` with @sparticuz/chromium: one launch per instance, page per job, crash/
  target-closed relaunch with one retry, 50s render deadline below the 60s Lambda timeout, bounded
  2s cleanup, JS disabled, bundle/data/about-only requests, A4/background/CSS-size/tagged/page
  headers, and retryable error mapping.
- `puppeteer-core` pinned to 25.11.0 (Chrome 153) matching @sparticuz/chromium 153.0.0; pdf-lib
  added for P-202; lockfile refreshed.
- Local preview refactored onto the shared helpers; 131 worker tests.

## Review

Two independent reviewers: PASS after fixes.

1. Added the 50s sub-Lambda deadline and bounded launch/newPage/render/close; hanging cleanup
   cannot mask the original error; disconnected browsers are not closed.
2. Page crash/target-closed detection now relaunches and retries even when the browser stays
   connected.
3. File roots are required and realpath-based, blocking symlink escapes.
4. Puppeteer/Chromium versions aligned.
5. Scope note: P-204 owns the domain `PdfRenderer` bridge, template compilation and full worker
   wiring; P-206 owns further local-Chrome hardening.

## Acceptance

| Command | Result |
|---|---|
| `pnpm --filter @printer/render-worker test` | PASS — 131 tests |
| `pnpm --filter @printer/render-worker typecheck` | PASS |
| `pnpm lint`, Prettier | PASS |
| `pnpm test`/typecheck on main | PASS — 449 tests |
| `pnpm template:preview generic-report` | PASS — valid PDF |

## Residual risks

- The real @sparticuz Linux x86_64 launch/packaging is untested until P-205/P-209.
- 50s render + cleanup leaves little headroom for PDF/A/storage/delivery in the 60s Lambda; verify
  end to end in P-204/P-209.
- ProtocolError is broadly classified as a crash/retry.
- P-204 must supply the `@printer/template-engine` bridge and single renderer instance; P-209 must
  copy the Chromium bin/dependency closure.
