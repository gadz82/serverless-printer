# Negotiation — Complete the Printer service

## Recommendation

**GO for Slice 1 now**: template engine, tooling, the first real template and the optional network
module. Plan Slice 2 (Chromium, PDF/A, all channels) and Slice 3 (production readiness and cloud
verification) as follow-up iterations. This is the staged plan in the PRD/TRD.

## Why staged

- The remaining spec is roughly three phases and an estimated 19 prompts / ~600k build tokens
  before review overhead. One iteration would exceed the 600k stop and delay feedback.
- Slice 1 is a prerequisite for rendering: Chromium needs real templates, modes and placeholders.
- Network support is independent and can land with Slice 1, keeping `vpc_mode = none` safe.
- Each slice ends with a demonstrable outcome: a real template renders locally; all channels render
  real PDFs; the service is measured and proven in AWS.

## Options

### A — Staged slices (recommended)

- **Slice 1:** templates + network, ~180k–220k tokens.
- **Slice 2:** Chromium + PDF/A + channels, ~260k–320k.
- **Slice 3:** load/alarms/runbook/smoke/cloud, ~160k–220k.
- Risk: medium overall; each slice fits the budget and is reviewable.

### B — All remaining work in one iteration

- ~600k+ build tokens, at/above the stop threshold; likely forced split at G4 anyway.
- Delays the first real template and cloud feedback; higher coordination risk.

### C — Chromium first, templates later

- Rendering cannot be meaningfully tested without templates and modes; not recommended.

### D — Templates without network

- Network is independent; deferring it would leave R-106 and the Phase 2 exit incomplete.
- Keep it in Slice 1.

## Customer impact in plain language

Staged delivery gets a real business template rendering and validated sooner, then adds Chromium
and all callback channels, then proves operations and AWS. It avoids a long “all-or-nothing”
build where nothing is demoable until the end.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chromium packaging/version mismatch | Pin major, render regression, CI x86_64 |
| PDF/A best effort | Document limits, fail unsafe inputs, no validator claim |
| SSRF/allowlist bypass | DNS + link-local blocking, dedicated tests |
| VPC/NAT cost/complexity | Default none, plan review, optional NAT |
| Throughput target unknown | Confirm before Slice 3 load test |
| AWS/remote inputs absent | Operator supplies; Slice 3 gates on them |

## Scope acceptance for Slice 1

- R-101–R-106 and their scenarios S-101–S-114.
- Deferred to follow-up iterations: R-107–R-115.
- Assumptions A-101–A-105 remain recorded.

## Decision requested

Approve Slice 1 (templates and network) as this iteration and the staged plan for Slices 2–3, or
choose the single-iteration alternative with its budget risk.
