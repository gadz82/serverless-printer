# Discovery consistency report

- Iteration: `2026-11-10-complete-the-printer-service-with-templates-rend`
- Requirements: 15 (`R-101`–`R-115`)
- Scenarios: 27 across seven feature files

## Result

No blocking inconsistency. Every requirement has at least one scenario; every scenario carries an
`@req` tag; terminology matches the glossary; the remaining scope stays inside the specification.

## Requirement-to-scenario traceability

| Requirement | Scenarios |
|---|---|
| R-101 | template-engine: lenient, strict, assume-objects, fixed helpers |
| R-102 | template-engine: placeholder shapes |
| R-103 | template-tooling: new, font warning, preview |
| R-104 | template-tooling: real template by id and slug |
| R-105 | template-engine: validation, check |
| R-106 | network: none, create, lookup |
| R-107 | rendering: JavaScript disabled, page settings |
| R-108 | pdfa: all levels, unsafe PDF fails |
| R-109 | delivery: HTTP, lambda/eventBridge/s3, SQS FIFO + ping |
| R-110 | delivery: allowlist and SSRF |
| R-111 | rendering: regression catches a visual change |
| R-112 | production: load test |
| R-113 | production: alarms and runbook |
| R-114 | production: plain + PDF/A smoke and first real template |
| R-115 | production: bootstrap, OIDC and rollback |

## Checks

| Check | Result | Evidence |
|---|---|---|
| Contradictions | None | The staged slices preserve the spec's Phase 2–4 order |
| Superseded decisions | None | Phase 1 decisions still apply; Phase 3 restores PDF/A levels |
| Breaking changes | None planned | Contracts already model PDF/A and all channels |
| Regressions | Guarded | Contract, render regression and smoke tests |
| Ambiguous terms | None after glossary | Template engine, modes, archiver, channels, network defined |
| Orphan requirements | None | Every R-### maps to a scenario |
| Scope drift | None | No API/UI/DB/environments/template upload |
| Secrets or PII in knowledge | None | No credentials or customer data |

## Deferred items

`Q-101` records the throughput target, AWS/VPC inputs, first template, alarm/allowlist targets and
the staged-split acceptance as assumptions `A-101`–`A-105`. None blocks G2; they are resolved in
assessment or by the operator before cloud verification.
