# P-101 implementation report

- Prompt: P-101 — Build the shared Handlebars template engine and manifest
- Branch: `orchid/2026-11-10-complete-the-printer-service-with-templates-rend/P-101`
- Status: complete

## Delivered

- `@printer/template-engine` with lenient/strict/assume-objects compilation, fixed helpers
  (`eq`, `formatCurrency`, `formatDate`), escaped output and prototype access disabled.
- Prototype-safe placeholder AST extraction for each/if/unless/with, bare and inverse sections,
  dotted paths and root-relative `this`/`./`/`@root`/`../` references.
- Strict/assume-objects pre-render checks plus mode-aware wrappers for `if`, `unless`, `each`,
  `with` and `eq`, so nested contexts enforce the missing-field rules.
- Deterministic SHA-256 hashing, descriptor validation (UUID v4 + required description),
  manifest construction and compile-before-manifest validation.
- External partials/decorators and `log`/`lookup` are rejected; unknown helpers fail compilation.
- `handlebars` and `puppeteer-core` catalog entries; `puppeteer-core` declared by the worker for
  P-103. README added.

## Review

Two independent reviewers. Initial findings included prototype pollution, incomplete icon
strict/assume-objects semantics, broken inverse sections and missing UUID validation; all were
fixed. Final verdicts: approved, no blocking findings.

## Acceptance

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm --filter @printer/template-engine test` | PASS — 80 tests |
| `pnpm --filter @printer/template-engine typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm exec prettier --check packages/template-engine` | PASS |
| `pnpm test` / `pnpm typecheck` on main after merge | PASS — 365 tests |

## Residual risks

- `../` depth semantics are flattened to root in placeholder extraction; nested-item fields remain
  coarsely modelled per SPEC §3.2, with strict/assume runtime wrappers covering the control helpers.
- UUID-shaped slugs can still collide with an id; cross-namespace uniqueness is a follow-up.
- Folders without `template.json` are skipped by the manifest builder; validation should catch them.
- Hash edge cases (empty input, symlinks) remain unspecified.
- The local `prettier` config needed `.serena/` ignored; committed separately.
