# ADR-101 — Template engine is a shared package with a fixed Handlebars contract

- Status: proposed
- Date: 2026-11-10
- Deciders: TECH_LEAD, DEV, QE, human release owner
- Related: R-101, R-102, R-103, S-101–S-107

## Context

The worker, the CLI preview and the manifest must compile the same Handlebars templates, apply the
same three missing-field modes, use the same fixed helpers and extract the same placeholder tree.
Duplicating that logic in `scripts/` would drift from production rendering.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Shared `packages/template-engine` (chosen) | Medium | Low | High | One engine for worker, preview and manifest |
| Logic in `scripts/` only | Low now | High drift | Medium | Preview can disagree with production |
| Custom template engine | High | High | Low | Reimplements Handlebars semantics |

## Decision

Create `packages/template-engine` owning Handlebars compilation, the fixed helper set (`eq`,
`formatCurrency`, `formatDate`), the three modes, prototype-access-off settings, placeholder AST
extraction, content hashing and manifest construction. `scripts/template-*` and the worker call
this package. Templates cannot register helpers.

## Consequences

- Preview and production share one engine and one manifest.
- The package is framework-free and unit-testable without AWS or Chromium.
- The CLI stays thin; Phase 2 validation/check/preview are deterministic.
- A helper addition becomes a deliberate code change with tests.

## Rejected options

- Scripts-only: preview/production drift.
- Custom engine: unnecessary semantic and maintenance risk.

## Risk acceptance

None beyond normal package maintenance.
