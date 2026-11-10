# ADR-202 — Deliver Slices 2+3 in one final iteration with a split fallback

- Status: proposed
- Date: 2026-11-10
- Deciders: PM, TECH_LEAD, human release owner
- Related: R-201–R-218, A-201–A-206

## Context

The remaining specification covers production rendering, PDF/A, all channels, role modes, render
regression, capacity, operations and the first cloud verification. The estimate is ~420k build
tokens plus reviews, under the 600k stop but above the 250k warning. Cloud verification depends on
operator AWS/remote inputs.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| One final iteration, Slices 2+3 (chosen) | ~480k–500k | Medium/High | High | One closure, full spec |
| Split now: Slice 2 then Slice 3 | ~260k + ~160k | Medium | High | Smaller reviews, two closures |
| Split Slice 3 at G4 only if needed | Same | Medium | High | Keeps momentum with a safety valve |

## Decision

Plan Slices 2+3 as one final iteration with ~12 prompts and 5 waves. At G4, split Slice 3 into a
follow-up if the cost approaches the stop threshold, cloud prerequisites are unavailable, or the
plan cannot keep write scopes/waves reviewable. The human may also choose the split now at G3.

## Consequences

- One closure/handover if the plan stays within budget.
- The G4 gate is the explicit safety valve; no silent overrun.
- If Slice 3 is split, the remaining requirements stay in the follow-up PRD/TRD.

## Rejected options

- Unbounded single iteration: budget/feedback risk.
- Mandatory split now: extra overhead when the full scope is feasible.

## Risk acceptance

Budget/cloud risk is accepted with the G4 split check.
