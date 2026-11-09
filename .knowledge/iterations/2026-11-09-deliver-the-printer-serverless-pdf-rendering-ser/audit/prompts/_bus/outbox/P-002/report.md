# P-002 implementation report

- Prompt: P-002 — Publish versioned job and result schemas with validated generated types
- Branch: `orchid/2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser/P-002`
- Status: complete

## Delivered

- `@printer/contracts` with JSON Schema 2020-12 job and result schemas, contract version 1.0.0.
- Required/closed objects, refId oneOf, PDF/A enum, all five success channels, four failure
  channels, HTTPS/ARN/presigned-URL validation, printing/expiry pairing, nullable failure
  template, eight error codes with retryable mapping, hash/size/date constraints.
- Deterministic generated TypeScript types committed under `src/generated`.
- Ajv2020 strict validators, stable error formatter and named `ContractValidationError`.
- 174 tests across job, result, validation and metadata, including the reserved `_smoke` id.

## Acceptance

| Command | Result |
|---|---|
| `pnpm --filter @printer/contracts generate` | PASS |
| `git diff --exit-code packages/contracts/src/generated` | PASS |
| `pnpm --filter @printer/contracts test` | PASS — 174 tests |
| `pnpm --filter @printer/contracts typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm exec prettier --check packages/contracts` | PASS |

## Review

Independent reviewer verdict: LGTM, no blocking findings. Low findings left as residual risk:
RFC 3339 calendar strictness is shape-based, URL syntactic edge cases remain, and a few failure
branch matrix edges are covered indirectly. The callback allowlist/DNS check remains the security
boundary, and the worker emits canonical timestamps.

## Integration

- The lockfile was regenerated on `main` after the merge and `pnpm --filter @printer/contracts
  test` passes there.
- `git diff --exit-code packages/contracts/src/generated` is now meaningful because the generated
  files are tracked on `main`.
