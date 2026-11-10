# Estimate

## Magnitude by slice

| Slice | Prompts (indicative) | Effort | Risk | Build tokens (est.) | Confidence |
|---|---|---|---|---|---|
| 1 — Templates and network | 6 | 4–5 days | 3/5 | 180k | High |
| 2 — Rendering and delivery | 8 | 6–8 days | 4/5 | 260k | Medium |
| 3 — Production readiness and cloud | 5 | 4–5 days | 3/5 | 160k | Medium |
| **Total** | **19** | **14–18 days** | | **600k** | |

The total is at or above the 600k per-iteration stop before review overhead. A single iteration
would be forced to split or run with `--force`.

## Recommendation

Deliver **Slice 1 in this iteration** (est. 180k–220k including reviews, below the 250k warning),
then plan Slice 2 and Slice 3 as follow-up iterations. This preserves the spec's Phase 2–4 order
and keeps each plan reviewable.

## Slice 1 work breakdown

| Wave | Outcome |
|---|---|
| 1 | `packages/template-engine` with modes, helpers, AST, hashing and manifest |
| 2 | `template:new`, `validate`, `check`, `preview` CLI |
| 3 | `generic-report` template and preview/integration tests |
| 4 | `modules/network` and printer VPC wiring |
| 5 | CI template validation/check integration and docs |

## Assumptions

- The throughput target is confirmed before Slice 3.
- Chromium packaging behaves as expected on Lambda Node 24/x86_64.
- PDF/A conformance is best effort.
- The operator supplies AWS/VPC/callback/alarm inputs before Slice 3 cloud verification.

## Budget

- Slice 1: ~180k–220k tokens; warning threshold 250k, stop 600k.
- Slice 2: ~260k–320k; separate iteration.
- Slice 3: ~160k–220k; separate iteration.
