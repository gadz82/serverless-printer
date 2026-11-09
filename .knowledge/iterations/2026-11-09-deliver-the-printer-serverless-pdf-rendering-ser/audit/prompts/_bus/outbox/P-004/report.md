# P-004 implementation report

- Prompt: P-004 — Bundle the `_smoke` template and generate its content-hashed manifest
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-004`
- Status: complete

## Delivered

- `templates/_smoke/template.json` with UUID v4 `72803074-1601-4a08-a5a5-49db9feacd66`,
  reserved slug `_smoke`, name and description.
- Self-contained semantic `index.html` with `lang="en"`, inline CSS and `{{message}}`.
- `sample.json` with `{ "message": "Printer smoke" }`.
- `scripts/template-manifest.mjs` exporting `buildManifest(root, release)` and a guarded CLI;
  deterministic sorted SHA-256 content hashes, placeholders, release, duplicate/id/slug and
  reserved-slug validation.
- 10 Vitest tests using temporary directories.

## Acceptance

| Command | Result |
|---|---|
| `pnpm template:manifest` | PASS — 1 template for release `local` |
| `pnpm vitest run scripts/template-manifest.test.mjs` | PASS — 10 tests |
| `pnpm lint` | PASS |
| `pnpm exec prettier --check ...` | PASS |

Manifest content hash: `0471e548d4a26d54937f991e68b03756f5651215865176bbba3cf996db7ede51`;
manifest SHA-256 stable across repeated runs.

## Review

Independent reviewer verdict: LGTM, no blocking findings. Low notes: the `RELEASE`/`local`
branches are manually verified rather than unit-tested, and a missing `template.json` is
silently skipped. Both are acceptable for the transitional Phase 1 script; Phase 2
`template:validate` owns schema, UUID, sample and self-containment checks.

## Residual risks

- Placeholder extraction is regex-only (no Handlebars AST).
- Content hashing is template-relative and byte-exact; CRLF checkouts would change hashes.
- Slug/folder mismatch is not rejected until Phase 2 validation.
