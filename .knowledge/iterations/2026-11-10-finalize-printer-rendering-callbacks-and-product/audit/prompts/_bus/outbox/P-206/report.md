# P-206 implementation report

- Prompt: P-206 — Harden local Chrome file access and error handling
- Status: complete

## Delivered

- Invalid `CHROME_PATH` now fails with `ChromePathError`; unset/empty falls back.
- Browser-close failures preserve the original render error and are reported separately;
  successful renders still return the PDF.
- Request interception failures are surfaced via `onRequestError`, redacting URLs; existing
  file-root realpath/symlink blocking and network/JS tests remain green.
- Tests cover file/directory symlink escapes, inside-root symlinks, close/interception failures,
  empty/whitespace CHROME_PATH and real-Chrome preview.

## Review

Independent reviewer: PASS, no blocking findings. Low notes: unbounded local close, existence-only
CHROME_PATH check, callback exceptions, and Lambda `onRequestError` wiring.

## Acceptance

| Command | Result |
|---|---|
| Worker tests | PASS — 211 tests |
| Typecheck, lint, Prettier | PASS |
| `pnpm template:preview generic-report` | PASS |
| Invalid/empty/whitespace CHROME_PATH | Correct behavior |
| `pnpm test` on main | PASS — 532 tests |

## Residual risks

- Local close is unbounded; TOCTOU/hard-link escapes require write access to the template dir.
- Lambda request errors are silent until P-204 wires a redacting logger.
- Real-Chrome tests skip when Chrome is absent; CI must provide it.
