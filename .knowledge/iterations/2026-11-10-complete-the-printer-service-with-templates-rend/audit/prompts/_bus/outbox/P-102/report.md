# P-102 implementation report

- Prompt: P-102 — Implement template:new, validate, check and manifest
- Branch: `orchid/2026-11-10-complete-the-printer-service-with-templates-rend/P-102`
- Status: complete

## Delivered

- `template:new` with slug/description/UUID v4 validation, folder/skeleton creation and overwrite
  refusal.
- `template:validate` with descriptor schema, unique ids/slugs, compilation, sample-data checks in
  `assume-objects` mode, bundled-font warnings and per-template PASS/FAIL output.
- `template:check --base` with id/slug changes, slug reuse, new/removed templates, folder-move
  guard, clear base-ref errors and help notes.
- `template:manifest` replaced with the shared engine builder, preserving RELEASE/local and file
  shape.
- Root `template:new`, `validate`, `check`, `preview` scripts; preview forward-references P-103.
- 23 new tests plus the existing manifest suite; temp dirs/repos only.

## Review

Independent reviewer: PASS. Follow-ups applied: sample rendering relaxed to assume-objects so
optional nested leaves are allowed; folder-move rejection made explicit and tested; help notes the
need to run `template:validate` for uniqueness.

## Acceptance

| Command | Result |
|---|---|
| `pnpm template:validate` | PASS — `_smoke` |
| `pnpm template:check --base HEAD` | PASS — unchanged |
| New vitest suite | PASS — 23 tests |
| `pnpm lint`, Prettier | PASS |
| `pnpm test` on main after merge | PASS — 388 tests |

## Residual risks

- `template:check` cannot detect an id+slug+folder change made in one commit (removed + new).
- Check alone does not enforce current uniqueness; CI must run validate too.
- Folder names must equal the slug; this is now an explicit project invariant.
- `template:preview` is unresolvable until P-103, by plan.
