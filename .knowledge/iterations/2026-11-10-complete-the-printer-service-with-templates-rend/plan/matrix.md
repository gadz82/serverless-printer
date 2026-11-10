# Plan matrix — Slice 1: templates and network

| Prompt | Wave | Outcome | Depends on | Estimate | Status |
|---|---|---|---|---|---|
| P-101 — template engine | 1 | Handlebars modes, fixed helpers, AST placeholders, hashing and manifest package | — | L | pending |
| P-104 — network | 1 | `modules/network`, `vpc_mode` create/lookup, endpoints/NAT, worker VPC wiring | — | M | pending |
| P-102 — template CLI | 2 | `template:new`, `validate`, `check`, manifest commands and package scripts | P-101 | M | pending |
| P-103 — generic report + preview | 3 | Generic business template, local Chrome renderer, `template:preview` | P-101, P-102 | M | pending |
| P-105 — CI/docs | 4 | Template validation/check in CI and README updates | P-102, P-103, P-104 | S | pending |

## Waves

- **Wave 1:** P-101 (engine) and P-104 (network) are disjoint.
- **Wave 2:** P-102 consumes the engine.
- **Wave 3:** P-103 authors the real template and previews it through local Chrome.
- **Wave 4:** P-105 wires CI and docs.

## Critical path

P-101 → P-102 → P-103 → P-105.

## Notes

- Slice 1 deliberately excludes Chromium Lambda packaging, PDF/A, non-SQS channels, load tests,
  alarms, runbook and cloud verification. Those are Slices 2–3.
- `template:preview` uses the installed local Chrome; `--pdfa` is added in Slice 2.
- No feature branch; `main` is the integration target.
