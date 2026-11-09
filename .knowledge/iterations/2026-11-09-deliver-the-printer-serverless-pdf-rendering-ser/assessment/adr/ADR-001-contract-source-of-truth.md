# ADR-001 — JSON Schema is the contract source of truth

- Status: proposed
- Date: 2026-11-09
- Deciders: TECH_LEAD, DEV, QE, human release owner
- Related: R-002, S-003, S-004

## Context

Callers and the worker need one unambiguous definition of the job and result payloads. The spec
requires JSON Schemas in `packages/contracts` and generated types. Hand-maintained TypeScript
types would drift from validation, and a validation library with its own schema dialect would
make the published contract less portable.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| JSON Schema 2020-12 + Ajv + `json-schema-to-typescript` | Low | Low | High | Portable, language-neutral contract |
| TypeBox/Zod as the single source | Low | Medium | Medium | Types first, JSON Schema generated; ties callers to a library |
| Hand-written schemas and types | Low initially | High drift | High | Cheapest now, most expensive later |

## Decision

Use JSON Schema draft 2020-12 files in `packages/contracts/schemas/` as the source of truth.
Validate at the worker boundary with Ajv 2020 in strict mode. Generate TypeScript types into
`packages/contracts/src/generated/` with `json-schema-to-typescript`, commit them, and fail CI
when regeneration produces a diff. Version the contract `1.0.0`; additive optional fields are
minor, breaking changes are major and require an ADR.

## Consequences

- Callers can validate with any JSON Schema implementation, not only TypeScript.
- The generated types are reviewable and compile-checked.
- Two generated artefacts must stay in sync; CI enforces it.
- Channel-specific conditional rules are expressed in the schema itself.

## Rejected options

- TypeBox/Zod: excellent developer experience but makes the public contract library-shaped.
- Hand-written types: drift and inconsistent validation are predictable.

## Risk acceptance

None beyond normal dependency maintenance.
