# ADR-005 — Minimal `_smoke` template and manifest in Phase 1

- Status: proposed
- Date: 2026-11-09
- Deciders: TECH_LEAD, DEV, PM, human release owner
- Related: R-003, R-012, S-005, S-014

## Context

The worker resolves a template by id or slug and reports its content hash and release. The full
template engine, `template:*` tooling, placeholder extraction and release-asset publication are
Phase 2. Phase 1 still needs one real, stable identity for the post-deploy smoke path, otherwise
the smoke test cannot exercise template resolution and traceability.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Minimal `_smoke` folder + small manifest script (chosen) | Low | Low | High | Real resolution and traceability from day one |
| Hard-code the smoke identity in the worker | Low | Medium | Low | Less machinery, but no content hash or manifest path |
| Build the full template engine and tooling now | High | Medium | Medium | Expands Phase 1 into Phase 2 |

## Decision

Add `templates/_smoke/` with `template.json`, `index.html` and `sample.json`. Generate
`templates.manifest.json` with `scripts/template-manifest.mjs`: sorted files, SHA-256 content
hash, id, slug, name, bundle path, placeholders and release. The worker resolves the manifest
inside the bundle. The full `template:new|validate|check|preview|manifest` commands,
`packages/template-engine` and release-asset publication arrive in Phase 2; the script then moves
behind that package.

## Consequences

- The smoke test exercises the same resolution and traceability path as future templates.
- The manifest format is defined early; Phase 2 can extend it compatibly.
- The transitional script is intentionally small and must not grow into a second template engine.
- Placeholder extraction in Phase 1 is limited to the `_smoke` fixture.

## Rejected options

- Hard-coded identity: faster, but it would not prove manifest resolution or content hashing.
- Full tooling now: scope creep and a larger planning surface.

## Risk acceptance

The script's temporary status is accepted; Phase 2 owns its migration into the template engine.
